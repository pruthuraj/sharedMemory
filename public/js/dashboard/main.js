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

// ── Zoom / Fit Controls ────────────────────────────────────────────────

function zoomStep() {
    return 1 + 0.1 * (Number(graphSettings?.zoomSpeed) || 1);
}

function bindZoomControls() {
    on(getEl('zoom-in-btn'), 'click', () => {
        if (!cy) return;

        const center = { x: cy.width() / 2, y: cy.height() / 2 };
        cy.zoom({ level: cy.zoom() * (1 + zoomStep() * 0.2), renderedPosition: center });
    });

    on(getEl('zoom-out-btn'), 'click', () => {
        if (!cy) return;

        const center = { x: cy.width() / 2, y: cy.height() / 2 };
        cy.zoom({ level: cy.zoom() / (1 + zoomStep() * 0.2), renderedPosition: center });
    });

    on(getEl('fit-btn'), 'click', () => {
        fitView();
    });
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
    on(identityPanel, 'keydown', handleIdentityKeydown);
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
        fitView();
    }, 80);
}

function bindFullscreenControls() {
    on(getFullscreenButton(), 'click', toggleFullscreen);
    on(document, 'fullscreenchange', handleFullscreenChange);
}

// ── Graph Expansion Controls ───────────────────────────────────────────

function bindExpansionControls() {
    on(getEl('main-nodes-btn'), 'click', () => {
        if (typeof showMainNodesOnly === 'function') showMainNodesOnly();
    });

    on(getEl('expand-all-btn'), 'click', () => {
        if (typeof expandAllVisible !== 'function' || !cy) return;
        expandAllVisible();
        renderGraph(currentEntries, currentEdges, { preserveSelection: true, preservePositions: true, fit: false });
        if (typeof refreshSlideshow === 'function') refreshSlideshow();
        updateStatusCount();
    });

    on(getEl('collapse-all-btn'), 'click', () => {
        if (typeof showMainNodesOnly === 'function') showMainNodesOnly();
    });
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

// ── Main Init ──────────────────────────────────────────────────────────

function initAppBindings() {
    bindZoomControls();
    bindIdentityControls();
    bindImportControls();
    bindExportControls();
    bindSettingsControls();
    bindGlobalCloseHandlers();
    bindFullscreenControls();
    bindConnectionControls();
    bindExpansionControls();
    if (typeof initSlideshowBindings === 'function') initSlideshowBindings();
}

function startGraphApp() {
    if (window.__memoryGraphAppInitialized) return;

    window.__memoryGraphAppInitialized = true;
    initAppBindings();
}

startGraphApp();
