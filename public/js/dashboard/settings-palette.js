'use strict';

// ── Settings / Palette Side Effects ────────────────────────────────────

function hasAnyChanged(changed, keys) {
    return keys.some((key) => changed.has(key));
}

function isSocketOpen() {
    return ws && ws.readyState === WebSocket.OPEN;
}

function refreshRelationColors(settings) {
    relationColors = window.SettingsApply.relationColors(
        settings.palette,
        settings.customPalette || {}
    );
}

let pendingSettings = null;
let pendingChanged = new Set();
let pendingSettingsFrame = null;

function mergeChangedKeys(changed) {
    for (const key of changed || []) {
        pendingChanged.add(key);
    }
}

function scheduleSettingsFlush() {
    if (pendingSettingsFrame) return;

    const scheduler = window.requestAnimationFrame || ((fn) => window.setTimeout(fn, 0));

    pendingSettingsFrame = scheduler(flushSettingsEffects);
}

// ── Change Detection ───────────────────────────────────────────────────

function didPaletteChange(changed) {
    return hasAnyChanged(changed, [
        'palette',
        'customPalette.appBg',
        'customPalette.panelBg',
        'customPalette.accent',
    ]);
}

function didFocusChange(changed) {
    return hasAnyChanged(changed, [
        'focusDepth',
        'focusIntensity',
        'edgeLabelMode',
    ]);
}

function didFilterChange(changed) {
    return hasAnyChanged(changed, [
        'minImportance',
        'relationFilters',
    ]);
}

function didVisualScaleChange(changed) {
    return hasAnyChanged(changed, [
        'nodeScale',
        'labelScale',
        'edgeThickness',
    ]);
}

// ── Effect Handlers ────────────────────────────────────────────────────

function handleLiveRefreshChange(settings, changed) {
    if (!changed.has('liveRefresh')) return;

    if (settings.liveRefresh) {
        if (isSocketOpen() && !liveRefreshTimer) {
            startLiveRefresh();
        }

        return;
    }

    stopLiveRefresh();
}

function applyFocusSettingsEffect() {
    applyFocusState();
}

function applyLayoutSettingsEffect() {
    renderGraph(currentEntries, currentEdges, {
        preserveSelection: false,
        preservePositions: false,
        fit: true,
    });
}

function applyFilterSettingsEffect() {
    // Filters are applied at render time via filteredGraph().
    // Re-render from the current snapshot without hitting the network.
    renderGraph(currentEntries, currentEdges, {
        preserveSelection: true,
        preservePositions: true,
        fit: false,
    });
}

function flushSettingsEffects() {
    const changed = pendingChanged;

    pendingSettingsFrame = null;
    pendingChanged = new Set();

    if (!pendingSettings || !changed.size) return;

    if (changed.has('layoutMode')) {
        applyLayoutSettingsEffect();
        return;
    }

    if (didFilterChange(changed)) {
        applyFilterSettingsEffect();
        return;
    }

    if (didFocusChange(changed)) {
        applyFocusSettingsEffect();
        return;
    }

    if (didPaletteChange(changed) || didVisualScaleChange(changed)) {
        if (cy) cy.style().update();
    }
}

function queueSettingsEffects(settings, changed) {
    pendingSettings = settings;
    mergeChangedKeys(changed);
    scheduleSettingsFlush();
}

// ── Main Settings Subscriber ───────────────────────────────────────────

function handleSettingsChange({ settings, changed }) {
    if (!settings || !changed) return;

    graphSettings = settings;

    refreshRelationColors(settings);
    handleLiveRefreshChange(settings, changed);
    queueSettingsEffects(settings, changed);
}

// ── Init ───────────────────────────────────────────────────────────────

function initSettingsPaletteBridge() {
    if (!window.Settings || typeof window.Settings.init !== 'function') {
        console.warn('Settings module is not available.');
        return;
    }

    window.Settings.init({
        onChange: handleSettingsChange,
    });

    fitFocusedBtn = document.getElementById('fit-focused-btn');

    if (fitFocusedBtn) {
        fitFocusedBtn.addEventListener('click', fitFocusedNeighborhood);
    }
}

initSettingsPaletteBridge();
