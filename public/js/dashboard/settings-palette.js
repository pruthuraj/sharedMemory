'use strict';

// Apply graph-side effects whenever a setting changes. The panel writes back
// through window.Settings.set, which runs apply.js (CSS vars + body classes)
// and then calls every subscriber registered here.
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

    if (changed.has('layoutMode')) {
        renderGraph(currentEntries, currentEdges, { preserveSelection: false, preservePositions: false, fit: true });
    }

    if (changed.has('minImportance') || changed.has('relationFilters')) {
        // Filters are applied at render time via filteredGraph(); just re-render
        // from the current snapshot without hitting the network.
        renderGraph(currentEntries, currentEdges, { preserveSelection: true, preservePositions: true, fit: false });
    }

    if (changed.has('nodeScale') || changed.has('labelScale') || changed.has('edgeThickness')) {
        rerenderEdgesForCurrentPositions();
    }
}

window.Settings.init({ onChange: handleSettingsChange });
fitFocusedBtn = document.getElementById('fit-focused-btn');
if (fitFocusedBtn) fitFocusedBtn.addEventListener('click', fitFocusedNeighborhood);
