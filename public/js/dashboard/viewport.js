'use strict';

// ── Pan / zoom ─────────────────────────────────────────────────────────
function applyTransform() {
    scene.style.transform = `translate(${panX}px,${panY}px) scale(${scale})`;
    viewport.style.backgroundSize = `${32 * scale}px ${32 * scale}px`;
    viewport.style.backgroundPosition = `${panX}px ${panY}px`;
}

function zoomAt(viewportX, viewportY, nextScale) {
    const newScale = clampScale(nextScale);
    const sx = (viewportX - panX) / scale;
    const sy = (viewportY - panY) / scale;
    scale = newScale;
    panX = viewportX - sx * scale;
    panY = viewportY - sy * scale;
    applyTransform();
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
        moved: false,
    };
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
    pos.x = nodeDrag.startX + clientDx / scale;
    pos.y = nodeDrag.startY + clientDy / scale;
    applyNodePlacement(nodeDrag.nodeEl, nodeDrag.key);
    rerenderEdgesForCurrentPositions();
    e.preventDefault();
}

function endNodeDrag(e) {
    if (!nodeDrag) return false;

    const wasMoved = nodeDrag.moved;
    try {
        nodeDrag.nodeEl.releasePointerCapture(nodeDrag.pointerId);
    } catch { }
    nodeDrag.nodeEl.classList.remove('dragging');
    if (wasMoved) suppressClickKey = nodeDrag.key;
    nodeDrag = null;

    if (wasMoved) {
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
