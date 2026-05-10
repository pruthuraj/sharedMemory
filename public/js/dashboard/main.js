'use strict';

// ── Application Bootstrapping / Event Bindings ─────────────────────────

// ── DOM Helpers ────────────────────────────────────────────────────────

function getEl(id) {
    return document.getElementById(id);
}

function on(el, eventName, handler, options) {
    if (!el) return;

    el.addEventListener(eventName, handler, options);
}

function isPanelOpen(panelEl) {
    return Boolean(panelEl?.classList.contains('visible'));
}

function clickedOutsidePanel(event, panelEl, triggerEl) {
    return (
        panelEl &&
        triggerEl &&
        !panelEl.contains(event.target) &&
        !triggerEl.contains(event.target)
    );
}

// ── Viewport Pan / Drag / Zoom ─────────────────────────────────────────

function handleViewportMouseDown(event) {
    if (event.target.closest('.mem-node')) return;
    if (nodeDrag) return;

    isPanning = true;

    panStartX = event.clientX;
    panStartY = event.clientY;
    panStartPanX = panX;
    panStartPanY = panY;

    viewport.classList.add('grabbing');

    event.preventDefault();
}

function handleDocumentMouseMove(event) {
    if (nodeDrag) return;
    if (!isPanning) return;

    panX = panStartPanX + (event.clientX - panStartX);
    panY = panStartPanY + (event.clientY - panStartY);

    applyTransform();
}

function stopViewportPanning() {
    if (!isPanning) return;

    isPanning = false;
    viewport.classList.remove('grabbing');
}

function handleViewportWheel(event) {
    event.preventDefault();

    const cappedDelta = Math.max(-120, Math.min(120, event.deltaY));
    const factor = Math.exp(
        -cappedDelta * DEFAULT_WHEEL_ZOOM_INTENSITY * graphSettings.zoomSpeed
    );

    const rect = viewport.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    zoomAt(mouseX, mouseY, scale * factor);
}

function bindViewportControls() {
    on(viewport, 'mousedown', handleViewportMouseDown);

    on(document, 'mousemove', handleDocumentMouseMove);
    on(document, 'mouseup', stopViewportPanning);

    on(document, 'pointermove', moveDraggedNode);
    on(document, 'pointerup', endNodeDrag);
    on(document, 'pointercancel', endNodeDrag);

    on(viewport, 'wheel', handleViewportWheel, {
        passive: false,
    });
}

// ── Zoom / Fit Controls ────────────────────────────────────────────────

function bindZoomControls() {
    on(getEl('zoom-in-btn'), 'click', () => {
        zoomAtCenter(scale * zoomButtonFactor());
    });

    on(getEl('zoom-out-btn'), 'click', () => {
        zoomAtCenter(scale / zoomButtonFactor());
    });

    on(getEl('fit-btn'), 'click', () => {
        fitView(nodePositions);
    });

    // fit-focused-btn is bound after Settings.init()
    // once the settings panel renders it.
}

// ── Identity Panel Controls ────────────────────────────────────────────

function handleIdentityListClick(event) {
    const item = event.target.closest('.identity-item');

    if (!item) return;

    focusIdentityNode(item.dataset.key);
}

function bindIdentityControls() {
    on(identityBtn, 'click', toggleIdentityPanel);
    on(identityClose, 'click', closeIdentityPanel);
    on(identitySearch, 'input', renderIdentityPanel);
    on(identityList, 'click', handleIdentityListClick);
}

// ── Import Panel Controls ──────────────────────────────────────────────

function cancelImportPanel() {
    resetImportPanel();
    closeImportPanel();
}

function handleImportFileChange() {
    handleImportFile(importFile.files?.[0]);
}

function bindImportControls() {
    on(importBtn, 'click', openImportPanel);
    on(importClose, 'click', closeImportPanel);
    on(importCancelBtn, 'click', cancelImportPanel);
    on(importFile, 'change', handleImportFileChange);
    on(importConfirmBtn, 'click', importValidatedSnapshot);
}

// ── Export Panel Controls ──────────────────────────────────────────────

function bindExportControls() {
    on(exportBtn, 'click', exportSnapshot);
}

// ── Settings Panel Controls ────────────────────────────────────────────

function bindSettingsControls() {
    on(settingsBtn, 'click', () => {
        toggleSettingsPanel();
    });

    on(settingsClose, 'click', () => {
        toggleSettingsPanel(false);
    });
}

// ── Global Close Handlers ──────────────────────────────────────────────

function closeFloatingPanels() {
    toggleSettingsPanel(false);
    closeIdentityPanel();
    closeImportPanel();
}

function handleGlobalKeydown(event) {
    if (event.key !== 'Escape') return;

    closeFloatingPanels();
}

function handleGlobalMouseDown(event) {
    if (
        isPanelOpen(settingsPanel) &&
        clickedOutsidePanel(event, settingsPanel, settingsBtn)
    ) {
        toggleSettingsPanel(false);
    }

    if (
        isPanelOpen(identityPanel) &&
        clickedOutsidePanel(event, identityPanel, identityBtn)
    ) {
        closeIdentityPanel();
    }

    if (
        isPanelOpen(importPanel) &&
        clickedOutsidePanel(event, importPanel, importBtn)
    ) {
        closeImportPanel();
    }
}

function bindGlobalCloseHandlers() {
    on(document, 'keydown', handleGlobalKeydown);
    on(document, 'mousedown', handleGlobalMouseDown);
}

// ── Fullscreen Controls ────────────────────────────────────────────────

function getFullscreenButton() {
    return getEl('fullscreen-btn');
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => { });
        return;
    }

    document.exitFullscreen().catch(() => { });
}

function updateFullscreenButton() {
    const fullscreenBtn = getFullscreenButton();

    if (!fullscreenBtn) return;

    fullscreenBtn.textContent = document.fullscreenElement ? '[]' : '[ ]';
}

function handleFullscreenChange() {
    updateFullscreenButton();

    window.setTimeout(() => {
        fitView(nodePositions);
    }, 80);
}

function bindFullscreenControls() {
    on(getFullscreenButton(), 'click', toggleFullscreen);
    on(document, 'fullscreenchange', handleFullscreenChange);
}

// ── Connection Controls ────────────────────────────────────────────────

function handleTokenInputKeydown(event) {
    if (event.key === 'Enter') {
        connect();
    }
}

function bindConnectionControls() {
    on(connectBtn, 'click', connect);
    on(refreshBtn, 'click', loadGraph);
    on(tokenInput, 'keydown', handleTokenInputKeydown);
}

// ── Initial Graph State ────────────────────────────────────────────────

function applyInitialGraphState() {
    if (selectedKey) {
        applyRadialFocusLayout(selectedKey);
    } else {
        applyFocusState();
    }

    applyTransform();
}

// ── Main Init ──────────────────────────────────────────────────────────

function initAppBindings() {
    bindViewportControls();
    bindZoomControls();
    bindIdentityControls();
    bindImportControls();
    bindExportControls();
    bindSettingsControls();
    bindGlobalCloseHandlers();
    bindFullscreenControls();
    bindConnectionControls();

    applyInitialGraphState();
}

function startGraphApp() {
    if (window.__memoryGraphAppInitialized) return;

    window.__memoryGraphAppInitialized = true;
    initAppBindings();
}

startGraphApp();
