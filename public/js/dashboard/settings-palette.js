'use strict';

// Settings change side effects and command-palette search/focus UI.

function handleSettingsChange({ settings, changed }) {
    graphSettings = settings;
    relationColors = window.SettingsApply.relationColors(settings.palette, settings.customPalette || {});

    const paletteTouched = changed.has('palette')
        || changed.has('customPalette.appBg')
        || changed.has('customPalette.panelBg')
        || changed.has('customPalette.accent');
    if (paletteTouched) rerenderEdgesForCurrentPositions();

    if (changed.has('liveRefresh')) {
        if (settings.liveRefresh) {
            if (ws && ws.readyState === WebSocket.OPEN && !liveRefreshTimer) startLiveRefresh();
        } else {
            stopLiveRefresh();
        }
    }

    if (changed.has('focusDepth') || changed.has('focusIntensity') || changed.has('edgeLabelMode')) {
        if (selectedKey) applyRadialFocusLayout(selectedKey);
        else applyFocusState();
    }

    if (changed.has('radialGapMultiplier') || changed.has('maxNodesPerRing')) {
        if (selectedKey) applyRadialFocusLayout(selectedKey);
        else applyFocusState();
    }

    if (changed.has('minImportance') || changed.has('relationFilters')) {
        // Filters are applied at render time via filteredGraph(); just re-render
        // from the current snapshot without hitting the network.
        renderGraph(currentEntries, currentEdges, { preserveSelection: true, preservePositions: true, fit: false });
    }

    if (changed.has('nodeScale') || changed.has('labelScale') || changed.has('edgeThickness')) {
        rerenderEdgesForCurrentPositions();
    }

    if (changed.has('layoutMode')) {
        renderGraph(currentEntries, currentEdges, { preserveSelection: true, preservePositions: false, fit: true });
    }
}

window.Settings.init({ onChange: handleSettingsChange });
fitFocusedBtn = document.getElementById('fit-focused-btn');
if (fitFocusedBtn) fitFocusedBtn.addEventListener('click', fitFocusedNeighborhood);
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (!paletteEl.hidden) {
            closePalette();
            return;
        }
        toggleSettingsPanel(false);
        closeIdentityPanel();
        closeImportPanel();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        openPalette();
    }
});

const paletteEl = document.getElementById('palette');
const paletteInput = document.getElementById('palette-input');
const paletteResults = document.getElementById('palette-results');
let paletteActiveIndex = 0;
let paletteCurrentKeys = [];

function openPalette() {
    if (!paletteEl) return;
    paletteEl.hidden = false;
    paletteInput.value = '';
    renderPaletteResults('');
    paletteInput.focus();
}

function closePalette() {
    if (!paletteEl) return;
    paletteEl.hidden = true;
}

function renderPaletteResults(query) {
    const q = query.trim().toLowerCase();
    const all = Object.keys(currentEntries).map((k) => ({
        key: k,
        entry: currentEntries[k],
        importance: (currentEntries[k] && currentEntries[k].importance) || 0,
    }));

    const matches = q.length === 0
        ? all
        : all.filter(({ key, entry }) => {
            if (key.toLowerCase().includes(q)) return true;
            const sum = String((entry && entry.summary) || '').toLowerCase();
            return sum.includes(q);
        });

    matches.sort((a, b) => {
        if (a.importance !== b.importance) return b.importance - a.importance;
        return a.key.localeCompare(b.key);
    });

    const top = matches.slice(0, 20);
    paletteCurrentKeys = top.map((m) => m.key);
    paletteActiveIndex = 0;

    paletteResults.innerHTML = '';
    top.forEach((m, i) => {
        const li = document.createElement('li');
        if (i === 0) li.classList.add('active');
        const keyEl = document.createElement('span');
        keyEl.className = 'palette-key';
        keyEl.textContent = m.key;
        const sumEl = document.createElement('span');
        sumEl.className = 'palette-summary';
        sumEl.textContent = (m.entry && m.entry.summary) || '';
        li.appendChild(keyEl);
        li.appendChild(sumEl);
        li.addEventListener('mouseenter', () => {
            paletteActiveIndex = i;
            updatePaletteActive();
        });
        li.addEventListener('click', () => paletteSelect(m.key));
        paletteResults.appendChild(li);
    });
}

function updatePaletteActive() {
    Array.from(paletteResults.children).forEach((node, i) => {
        node.classList.toggle('active', i === paletteActiveIndex);
        if (i === paletteActiveIndex && node.scrollIntoView) {
            node.scrollIntoView({ block: 'nearest' });
        }
    });
}

function paletteSelect(key) {
    if (!key) return;
    closePalette();
    const entry = currentEntries[key];
    if (entry) openDetail(key, entry);
}

if (paletteEl && paletteInput) {
    paletteInput.addEventListener('input', (e) => renderPaletteResults(e.target.value));
    paletteInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (paletteActiveIndex < paletteCurrentKeys.length - 1) paletteActiveIndex++;
            updatePaletteActive();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (paletteActiveIndex > 0) paletteActiveIndex--;
            updatePaletteActive();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            paletteSelect(paletteCurrentKeys[paletteActiveIndex]);
        }
    });
    paletteEl.addEventListener('mousedown', (e) => {
        if (e.target === paletteEl) closePalette();
    });
}
document.addEventListener('mousedown', e => {
    if (settingsPanel.classList.contains('visible')) {
        if (!settingsPanel.contains(e.target) && !settingsBtn.contains(e.target)) {
            toggleSettingsPanel(false);
        }
    }

    if (identityPanel.classList.contains('visible')) {
        if (!identityPanel.contains(e.target) && !identityBtn.contains(e.target)) {
            closeIdentityPanel();
        }
    }

    if (importPanel.classList.contains('visible')) {
        if (!importPanel.contains(e.target) && !importBtn.contains(e.target)) {
            closeImportPanel();
        }
    }
});
document.getElementById('fullscreen-btn').addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => { });
    else document.exitFullscreen().catch(() => { });
});
document.addEventListener('fullscreenchange', () => {
    document.getElementById('fullscreen-btn').textContent = document.fullscreenElement ? '[]' : '[ ]';
    setTimeout(() => fitView(nodePositions), 80);
});

// ── WebSocket ──────────────────────────────────────────────────────────
