'use strict';

// ── Pan / Zoom Constants ───────────────────────────────────────────────

const VIEWPORT_GRID_SIZE = 32;
const FIT_VIEW_PADDING = 60;
const FIT_VIEW_MAX_SCALE = 1.2;

// ── Transform Helpers ─────────────────────────────────────────────────

function applyTransform() {
    if (!scene || !viewport) return;

    scene.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;

    viewport.style.backgroundSize = `${VIEWPORT_GRID_SIZE * scale}px ${VIEWPORT_GRID_SIZE * scale}px`;
    viewport.style.backgroundPosition = `${panX}px ${panY}px`;
}

function getViewportCenter() {
    return {
        x: viewport.clientWidth / 2,
        y: viewport.clientHeight / 2,
    };
}

function zoomAt(viewportX, viewportY, nextScale) {
    const newScale = clampScale(nextScale);

    const sceneX = (viewportX - panX) / scale;
    const sceneY = (viewportY - panY) / scale;

    scale = newScale;

    panX = viewportX - sceneX * scale;
    panY = viewportY - sceneY * scale;

    applyTransform();
}

function zoomAtCenter(nextScale) {
    const center = getViewportCenter();

    zoomAt(center.x, center.y, nextScale);
}

// ── Node Drag Helpers ─────────────────────────────────────────────────

function canStartNodeDrag(event, key) {
    return Boolean(
        event.button === 0 &&
        key &&
        nodePositions?.[key]
    );
}

function beginNodeDrag(event, key, nodeEl) {
    if (!canStartNodeDrag(event, key)) return;

    event.stopPropagation();

    const position = nodePositions[key];

    nodeDrag = {
        key,
        nodeEl,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: position.x,
        startY: position.y,
        moved: false,
    };

    try {
        nodeEl.setPointerCapture(event.pointerId);
    } catch {
        // Pointer capture can fail if the pointer is already released.
    }
}

function hasDraggedPastThreshold(clientDx, clientDy) {
    return Math.hypot(clientDx, clientDy) >= DRAG_THRESHOLD_PX;
}

function updateDraggedNodePosition(clientDx, clientDy) {
    const position = nodePositions[nodeDrag.key];

    if (!position) return;

    position.x = nodeDrag.startX + clientDx / scale;
    position.y = nodeDrag.startY + clientDy / scale;
}

function moveDraggedNode(event) {
    if (!nodeDrag) return;

    const clientDx = event.clientX - nodeDrag.startClientX;
    const clientDy = event.clientY - nodeDrag.startClientY;

    if (!nodeDrag.moved && !hasDraggedPastThreshold(clientDx, clientDy)) {
        return;
    }

    nodeDrag.moved = true;
    nodeDrag.nodeEl.classList.add('dragging');

    updateDraggedNodePosition(clientDx, clientDy);
    applyNodePlacement(nodeDrag.nodeEl, nodeDrag.key);
    rerenderEdgesForCurrentPositions();

    event.preventDefault();
}

function releaseNodePointerCapture(event) {
    if (!nodeDrag?.nodeEl) return;

    try {
        nodeDrag.nodeEl.releasePointerCapture(nodeDrag.pointerId);
    } catch {
        // Ignore release errors.
    }
}

function endNodeDrag(event) {
    if (!nodeDrag) return false;

    const wasMoved = nodeDrag.moved;
    const draggedKey = nodeDrag.key;
    const draggedNodeEl = nodeDrag.nodeEl;

    releaseNodePointerCapture(event);

    if (draggedNodeEl) {
        draggedNodeEl.classList.remove('dragging');
    }

    if (wasMoved) {
        suppressClickKey = draggedKey;
    }

    nodeDrag = null;

    if (wasMoved && event) {
        event.preventDefault();
        event.stopPropagation();
    }

    return wasMoved;
}

// ── Fit View Helpers ──────────────────────────────────────────────────

function getPositionKeys(positions) {
    return Object.keys(positions || {});
}

function getBoundsForPositions(positions) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const [key, position] of Object.entries(positions || {})) {
        if (!position) continue;

        const box = nodeVisualBox(key, position);

        minX = Math.min(minX, box.x);
        minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.w);
        maxY = Math.max(maxY, box.y + box.h);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
        return null;
    }

    return {
        minX,
        minY,
        maxX,
        maxY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
    };
}

function calculateFitScale(bounds) {
    const viewportWidth = viewport.clientWidth;
    const viewportHeight = viewport.clientHeight;

    const availableWidth = Math.max(1, viewportWidth - FIT_VIEW_PADDING * 2);
    const availableHeight = Math.max(1, viewportHeight - FIT_VIEW_PADDING * 2);

    return Math.max(
        ZOOM_MIN,
        Math.min(
            FIT_VIEW_MAX_SCALE,
            availableWidth / bounds.width,
            availableHeight / bounds.height
        )
    );
}

function applyFitTransform(bounds, nextScale) {
    const viewportWidth = viewport.clientWidth;
    const viewportHeight = viewport.clientHeight;

    scale = nextScale;

    panX = (viewportWidth - bounds.width * scale) / 2 - bounds.minX * scale;
    panY = (viewportHeight - bounds.height * scale) / 2 - bounds.minY * scale;

    applyTransform();
}

function fitView(positions) {
    const keys = getPositionKeys(positions);

    if (!keys.length) return;

    const bounds = getBoundsForPositions(positions);

    if (!bounds) return;

    const nextScale = calculateFitScale(bounds);

    applyFitTransform(bounds, nextScale);
}

// ── Focused Fit ───────────────────────────────────────────────────────

function getFocusedRootKey() {
    return focusedKey || selectedKey || lastFocusedKey;
}

function getFocusedPositions(rootKey) {
    const distances = focusDistances(rootKey);
    const focusedPositions = {};

    for (const key of distances.keys()) {
        if (nodePositions[key]) {
            focusedPositions[key] = nodePositions[key];
        }
    }

    return focusedPositions;
}

function fitFocusedNeighborhood() {
    const rootKey = getFocusedRootKey();

    if (!rootKey || !nodePositions[rootKey]) {
        fitView(nodePositions);
        return;
    }

    const focusedPositions = getFocusedPositions(rootKey);
    const hasFocusedPositions = Object.keys(focusedPositions).length > 0;

    fitView(hasFocusedPositions ? focusedPositions : nodePositions);
}

// ── Settings Panel Visibility ─────────────────────────────────────────

function toggleSettingsPanel(force) {
    if (!settingsPanel || !settingsBtn) return;

    const nextVisible = force ?? !settingsPanel.classList.contains('visible');

    settingsPanel.classList.toggle('visible', nextVisible);
    settingsPanel.setAttribute('aria-hidden', nextVisible ? 'false' : 'true');

    settingsBtn.setAttribute('aria-expanded', nextVisible ? 'true' : 'false');
}