'use strict';

// ── Application bootstrapping and event bindings ───────────────────────
viewport.addEventListener('mousedown', e => {
    if (e.target.closest('.mem-node')) return;
    if (nodeDrag) return;
    isPanning = true;
    panStartX = e.clientX; panStartY = e.clientY;
    panStartPanX = panX; panStartPanY = panY;
    viewport.classList.add('grabbing');
    e.preventDefault();
});
document.addEventListener('mousemove', e => {
    if (nodeDrag) return;
    if (!isPanning) return;
    panX = panStartPanX + (e.clientX - panStartX);
    panY = panStartPanY + (e.clientY - panStartY);
    applyTransform();
});
document.addEventListener('mouseup', () => {
    if (isPanning) { isPanning = false; viewport.classList.remove('grabbing'); }
});
document.addEventListener('pointermove', moveDraggedNode);
document.addEventListener('pointerup', endNodeDrag);
document.addEventListener('pointercancel', endNodeDrag);
viewport.addEventListener('wheel', e => {
    e.preventDefault();
    const cappedDelta = Math.max(-120, Math.min(120, e.deltaY));
    const factor = Math.exp(-cappedDelta * DEFAULT_WHEEL_ZOOM_INTENSITY * graphSettings.zoomSpeed);
    const rect = viewport.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    zoomAt(mx, my, scale * factor);
}, { passive: false });

document.getElementById('zoom-in-btn').addEventListener('click', () => {
    zoomAtCenter(scale * zoomButtonFactor());
});
document.getElementById('zoom-out-btn').addEventListener('click', () => {
    zoomAtCenter(scale / zoomButtonFactor());
});
document.getElementById('fit-btn').addEventListener('click', () => fitView(nodePositions));
// fit-focused-btn is bound after Settings.init() once the panel renders it.
identityBtn.addEventListener('click', toggleIdentityPanel);
identityClose.addEventListener('click', closeIdentityPanel);
identitySearch.addEventListener('input', renderIdentityPanel);
identityList.addEventListener('click', (event) => {
    const item = event.target.closest('.identity-item');
    if (!item) return;
    focusIdentityNode(item.dataset.key);
});
importBtn.addEventListener('click', openImportPanel);
importClose.addEventListener('click', closeImportPanel);
importCancelBtn.addEventListener('click', () => {
    resetImportPanel();
    closeImportPanel();
});
importFile.addEventListener('change', () => handleImportFile(importFile.files?.[0]));
importConfirmBtn.addEventListener('click', importValidatedSnapshot);
settingsBtn.addEventListener('click', () => toggleSettingsPanel());
settingsClose.addEventListener('click', () => toggleSettingsPanel(false));

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        toggleSettingsPanel(false);
        closeIdentityPanel();
        closeImportPanel();
    }
});
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

connectBtn.addEventListener('click', connect);
refreshBtn.addEventListener('click', loadGraph);
tokenInput.addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });

// Initial palette/edge-label/CSS-vars apply happens inside Settings.init().
// Run focus-state once the snapshot is in hand so the radial layout matches.
if (selectedKey) applyRadialFocusLayout(selectedKey);
else applyFocusState();
applyTransform();
