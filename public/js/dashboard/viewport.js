'use strict';

// Pan, zoom, node dragging, fit-view, fullscreen, settings panel toggle, and viewport event binding.

function applyTransform(keepZoomActive = false) {
    // Use requestAnimationFrame to batch DOM updates and prefer GPU compositing
    if (!window._applyTransformRaf) {
        window._applyTransformRaf = null;
    }
    if (window._applyTransformRaf) cancelAnimationFrame(window._applyTransformRaf);
    window._applyTransformRaf = requestAnimationFrame(() => {
        scene.style.transform = `translate3d(${panX}px,${panY}px,0) scale3d(${scale},${scale},1)`;
        viewport.style.backgroundSize = `${32 * scale}px ${32 * scale}px`;
        viewport.style.backgroundPosition = `${panX}px ${panY}px`;
        // Keep the scene-scale var in sync for fit/layout-driven scale changes too.
        if (lastSceneScale !== scale) {
            viewport.style.setProperty('--scene-scale', scale);
            lastSceneScale = scale;
        }
        updateZoomUiState(keepZoomActive);
    });
}

function zoomAt(viewportX, viewportY, nextScale) {
    const newScale = clampScale(nextScale);
    const sx = (viewportX - panX) / scale;
    const sy = (viewportY - panY) / scale;
    scale = newScale;
    panX = viewportX - sx * scale;
    panY = viewportY - sy * scale;
    // Add a temporary 'zooming' class to reduce expensive paint during continuous zoom
    document.body.classList.add('zooming');
    updateZoomUiState(true);
    if (window._zoomingTimer) clearTimeout(window._zoomingTimer);
    applyTransform(true);
    // After a short pause, remove the zooming class and update the --scene-scale CSS var
    window._zoomingTimer = setTimeout(() => {
        document.body.classList.remove('zooming');
        if (lastSceneScale !== scale) {
            viewport.style.setProperty('--scene-scale', scale);
            lastSceneScale = scale;
        }
        updateZoomUiState(false);
    }, 140);
}

function zoomAtCenter(nextScale) {
    zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, nextScale);
}

function beginNodeDrag(e, key, nodeEl) {
    if (e.button !== 0 || !nodePositions[key]) return;
    e.stopPropagation();

    const pos = nodePositions[key];
    nodeDrag = {
        key,
        nodeEl,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: pos.x,
        startY: pos.y,
        clusterKeys: null,
        moved: false,
    };

    const shouldDragCluster = detailPanel.classList.contains('visible') && (selectedKey || focusedKey);
    if (shouldDragCluster) {
        const rootKey = (selectedKey && key === selectedKey) ? selectedKey : key;
        nodeDrag.clusterKeys = connectedComponentKeys(rootKey);
    }
    nodeEl.setPointerCapture(e.pointerId);
}

function moveDraggedNode(e) {
    if (!nodeDrag) return;

    const clientDx = e.clientX - nodeDrag.startClientX;
    const clientDy = e.clientY - nodeDrag.startClientY;
    const movedEnough = Math.hypot(clientDx, clientDy) >= DRAG_THRESHOLD_PX;
    if (!nodeDrag.moved && !movedEnough) return;

    nodeDrag.moved = true;
    nodeDrag.nodeEl.classList.add('dragging');
    const pos = nodePositions[nodeDrag.key];

    const nextX = nodeDrag.startX + clientDx / scale;
    const nextY = nodeDrag.startY + clientDy / scale;
    const deltaX = nextX - pos.x;
    const deltaY = nextY - pos.y;

    // Keep focused neighborhoods intact: dragging the selected root should
    // translate related nodes together instead of stretching edges across canvas.
    if (nodeDrag.clusterKeys && nodeDrag.clusterKeys.size > 1) {
        for (const clusterKey of nodeDrag.clusterKeys) {
            if (clusterKey === nodeDrag.key) continue;
            const clusterPos = nodePositions[clusterKey];
            if (!clusterPos) continue;
            clusterPos.x += deltaX;
            clusterPos.y += deltaY;
            const clusterNode = scene.querySelector(`[data-key="${CSS.escape(clusterKey)}"]`);
            if (clusterNode) applyNodePlacement(clusterNode, clusterKey);
        }
    }

    pos.x = nextX;
    pos.y = nextY;
    applyNodePlacement(nodeDrag.nodeEl, nodeDrag.key);
    scheduleRerenderEdges();
    e.preventDefault();
}

function endNodeDrag(e) {
    if (!nodeDrag) return false;

    const wasMoved = nodeDrag.moved;
    const draggedKey = nodeDrag.key;
    try {
        nodeDrag.nodeEl.releasePointerCapture(nodeDrag.pointerId);
    } catch { }
    nodeDrag.nodeEl.classList.remove('dragging');
    if (wasMoved) suppressClickKey = nodeDrag.key;
    nodeDrag = null;

    if (wasMoved) {
        // Stabilize focused layout after drag to prevent torn edge geometry.
        if (selectedKey && detailPanel.classList.contains('visible') && nodePositions[selectedKey] && currentEntries[selectedKey]) {
            const selectedBox = nodeVisualBox(selectedKey, nodePositions[selectedKey], currentEntries[selectedKey]);
            const selectedCenter = nodeCenter(selectedBox);
            applyRadialFocusLayout(selectedKey, { center: selectedCenter });
        } else if (draggedKey && nodePositions[draggedKey]) {
            rerenderEdgesForCurrentPositions();
        }
        e.preventDefault();
        e.stopPropagation();
    }
    return wasMoved;
}

function fitView(positions) {
    const keys = Object.keys(positions);
    if (!keys.length) return;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [key, p] of Object.entries(positions)) {
        const box = nodeVisualBox(key, p);
        minX = Math.min(minX, box.x); minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.w); maxY = Math.max(maxY, box.y + box.h);
    }

    const pad = 60;
    scale = Math.max(ZOOM_MIN, Math.min(1.2,
        Math.min((vw - pad * 2) / (maxX - minX), (vh - pad * 2) / (maxY - minY))
    ));
    panX = (vw - (maxX - minX) * scale) / 2 - minX * scale;
    panY = (vh - (maxY - minY) * scale) / 2 - minY * scale;
    applyTransform();
}

function fitFocusedNeighborhood() {
    const root = focusedKey || selectedKey || lastFocusedKey;
    if (!root || !nodePositions[root]) {
        fitView(nodePositions);
        return;
    }

    const distances = focusDistances(root);
    const focusedPositions = {};
    for (const key of distances.keys()) {
        if (nodePositions[key]) focusedPositions[key] = nodePositions[key];
    }
    fitView(Object.keys(focusedPositions).length ? focusedPositions : nodePositions);
}

function toggleSettingsPanel(force) {
    const nextVisible = force ?? !settingsPanel.classList.contains('visible');
    settingsPanel.classList.toggle('visible', nextVisible);
    settingsPanel.setAttribute('aria-hidden', nextVisible ? 'false' : 'true');
    settingsBtn.setAttribute('aria-expanded', nextVisible ? 'true' : 'false');
}

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

// Apply graph-side effects whenever a setting changes. The panel writes back
// through window.Settings.set, which runs apply.js (CSS vars + body classes)
// and then calls every subscriber registered here.
