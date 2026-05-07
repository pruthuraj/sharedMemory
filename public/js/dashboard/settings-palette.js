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

function handlePaletteChange(changed) {
    if (!didPaletteChange(changed)) return;

    rerenderEdgesForCurrentPositions();
}

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

function handleFocusChange(changed) {
    if (!didFocusChange(changed)) return;

    if (selectedKey) {
        applyRadialFocusLayout(selectedKey);
    } else {
        applyFocusState();
    }
}

function handleLayoutModeChange(changed) {
    if (!changed.has('layoutMode')) return;

    renderGraph(currentEntries, currentEdges, {
        preserveSelection: false,
        preservePositions: false,
        fit: true,
    });
}

function handleFilterChange(changed) {
    if (!didFilterChange(changed)) return;

    // Filters are applied at render time via filteredGraph().
    // Re-render from the current snapshot without hitting the network.
    renderGraph(currentEntries, currentEdges, {
        preserveSelection: true,
        preservePositions: true,
        fit: false,
    });
}

function handleVisualScaleChange(changed) {
    if (!didVisualScaleChange(changed)) return;

    rerenderEdgesForCurrentPositions();
}

// ── Main Settings Subscriber ───────────────────────────────────────────

function handleSettingsChange({ settings, changed }) {
    if (!settings || !changed) return;

    graphSettings = settings;

    refreshRelationColors(settings);

    handlePaletteChange(changed);
    handleLiveRefreshChange(settings, changed);
    handleFocusChange(changed);
    handleLayoutModeChange(changed);
    handleFilterChange(changed);
    handleVisualScaleChange(changed);
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