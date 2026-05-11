'use strict';

// ── Fit View ──────────────────────────────────────────────────────────

function fitView() {
    if (!cy) return;

    cy.fit(undefined, SCENE_PADDING);
}

// ── Focused Fit ───────────────────────────────────────────────────────

function getFocusedRootKey() {
    return focusedKey || selectedKey || lastFocusedKey;
}

function fitFocusedNeighborhood() {
    const rootKey = getFocusedRootKey();

    if (!rootKey || !cy) {
        fitView();
        return;
    }

    const distances = focusDistances(rootKey);
    const focusedNodes = cy.collection();

    for (const id of distances.keys()) {
        const node = cy.$id(id);

        if (node.length) focusedNodes.merge(node);
    }

    if (focusedNodes.length > 0) {
        cy.fit(focusedNodes, SCENE_PADDING);
    } else {
        fitView();
    }
}

// ── Settings Panel Visibility ─────────────────────────────────────────

function toggleSettingsPanel(force) {
    if (!settingsPanel || !settingsBtn) return;

    const nextVisible = force ?? !settingsPanel.classList.contains('visible');

    settingsPanel.classList.toggle('visible', nextVisible);
    settingsPanel.setAttribute('aria-hidden', nextVisible ? 'false' : 'true');

    settingsBtn.setAttribute('aria-expanded', nextVisible ? 'true' : 'false');
}
