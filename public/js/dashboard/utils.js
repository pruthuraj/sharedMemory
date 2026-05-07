'use strict';

// ── Text / DOM Helpers ─────────────────────────────────────────────────

function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getById(id) {
    return document.getElementById(id);
}

function setText(el, value) {
    if (!el) return;

    el.textContent = value;
}

// Settings persistence and palette/edge-label application now live in
// js/settings/. The onChange subscriber installed in initSettings() runs the
// graph-side effects when any setting changes.

// ── Settings-Derived Helpers ───────────────────────────────────────────

function dimmedNodeOpacity() {
    const intensity = Number(graphSettings?.focusIntensity) || 0;

    return Math.max(0.08, 0.3 - intensity * 0.11);
}

function dimmedEdgeOpacity() {
    const intensity = Number(graphSettings?.focusIntensity) || 0;

    return Math.max(0.06, 0.2 - intensity * 0.07);
}

function zoomButtonFactor() {
    const zoomSpeed = Number(graphSettings?.zoomSpeed) || 1;

    return 1 + (DEFAULT_BUTTON_ZOOM_STEP - 1) * zoomSpeed;
}

// ── Time / Age Helpers ─────────────────────────────────────────────────

function timeSince(timestamp) {
    const time = Number(timestamp);

    if (!Number.isFinite(time)) return Infinity;

    return Math.max(0, Date.now() - time);
}

function ageColor(timestamp) {
    const ms = timeSince(timestamp);

    if (ms < 3_600_000) return '#10b981';
    if (ms < 86_400_000) return '#6366f1';

    return '#475569';
}

function ageLabel(timestamp) {
    const ms = timeSince(timestamp);

    if (!Number.isFinite(ms)) return '-';
    if (ms < 60_000) return 'just now';
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;

    return `${Math.floor(ms / 86_400_000)}d ago`;
}

// ── Color / Hash Helpers ───────────────────────────────────────────────

function stableHash(value) {
    const text = String(value ?? '');

    let hash = 0;

    for (let i = 0; i < text.length; i += 1) {
        hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }

    return Math.abs(hash);
}

function nodeIdentityColor(key) {
    const hue = stableHash(String(key)) % 360;

    return `hsl(${hue} 78% 58%)`;
}

// ── Status Helpers ─────────────────────────────────────────────────────

function setStatus(message, cls = '') {
    if (!statusText) return;

    statusText.textContent = message;
    statusText.className = cls;
}

function updateStatusCount() {
    const nodeCount = Object.keys(currentEntries || {}).length;
    const edgeCount = (currentEdges || []).length;

    setStatus(
        `${nodeCount} ${nodeCount === 1 ? 'node' : 'nodes'} - ${edgeCount} ${edgeCount === 1 ? 'edge' : 'edges'}`,
        'ok'
    );
}

function updateLegend() {
    const nodeCount = Object.keys(currentEntries || {}).length;
    const edgeCount = (currentEdges || []).length;

    const nodesEl = getById('ld-nodes')?.querySelector('span:last-child');
    const edgesEl = getById('ld-edges')?.querySelector('span:last-child');

    setText(nodesEl, `${nodeCount} ${nodeCount === 1 ? 'node' : 'nodes'}`);
    setText(edgesEl, `${edgeCount} ${edgeCount === 1 ? 'edge' : 'edges'}`);
}

// ── Node Size / Geometry Helpers ───────────────────────────────────────

function nodeHeight(entry = {}) {
    let height = 62;

    if (entry.tags && entry.tags.length) {
        height += 22;
    }

    if (Number(entry.importance) > 0) {
        height += 18;
    }

    return height;
}

function nodeDegree(key) {
    let degree = 0;

    for (const edge of currentEdges || []) {
        if (edgeTouches(edge, key)) {
            degree += 1;
        }
    }

    return degree;
}

function collapsedNodeSize(key) {
    const degree = nodeDegree(key);
    const nodeScale = Number(graphSettings?.nodeScale) || 1;

    const rawSize = (
        NODE_ROUND_MIN +
        Math.sqrt(degree) * NODE_ROUND_GROWTH
    ) * nodeScale;

    const maxSize = NODE_ROUND_MAX * nodeScale;

    return Math.round(Math.min(maxSize, rawSize));
}

function nodeVisualBox(key, pos, entry = currentEntries?.[key]) {
    const slotHeight = nodeHeight(entry || {});
    const isExpanded = expandedNodes.has(key);
    const roundSize = collapsedNodeSize(key);

    const width = isExpanded ? NODE_W : roundSize;
    const height = isExpanded ? slotHeight : roundSize;

    return {
        x: pos.x + (NODE_W - width) / 2,
        y: pos.y + (slotHeight - height) / 2,
        w: width,
        h: height,
    };
}

function nodeCenter(box) {
    return {
        x: box.x + box.w / 2,
        y: box.y + box.h / 2,
    };
}

function edgeAnchor(box, toward, isRound) {
    const center = nodeCenter(box);
    const dx = toward.x - center.x;
    const dy = toward.y - center.y;
    const length = Math.hypot(dx, dy) || 1;

    if (isRound) {
        const radius = Math.min(box.w, box.h) / 2;

        return {
            x: center.x + (dx / length) * radius,
            y: center.y + (dy / length) * radius,
        };
    }

    const halfWidth = box.w / 2;
    const halfHeight = box.h / 2;

    const scale = 1 / Math.max(
        Math.abs(dx) / halfWidth,
        Math.abs(dy) / halfHeight,
        1
    );

    return {
        x: center.x + dx * scale,
        y: center.y + dy * scale,
    };
}

function applyNodePlacement(nodeEl, key) {
    const pos = nodePositions?.[key];
    const entry = currentEntries?.[key];

    if (!nodeEl || !pos || !entry) return;

    const box = nodeVisualBox(key, pos, entry);

    nodeEl.style.left = `${box.x}px`;
    nodeEl.style.top = `${box.y}px`;
    nodeEl.style.setProperty('--node-w', `${box.w}px`);
    nodeEl.style.setProperty('--node-h', `${box.h}px`);
    nodeEl.style.setProperty('--node-degree', String(nodeDegree(key)));
}

function setSlotCenter(key, centerX, centerY) {
    const pos = nodePositions?.[key];
    const entry = currentEntries?.[key];

    if (!pos || !entry) return;

    pos.x = centerX - NODE_W / 2;
    pos.y = centerY - nodeHeight(entry) / 2;
}

// ── SVG / Request Helpers ──────────────────────────────────────────────

function svgEl(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

function makeRequestId(prefix = 'rpc') {
    nextRpcId += 1;

    return `__${prefix}_${Date.now()}_${nextRpcId}__`;
}

// ── Edge / Graph Helpers ───────────────────────────────────────────────

function edgeKey(edge) {
    return `${edge.from}\u001f${edge.relation}\u001f${edge.to}`;
}

function edgeTouches(edge, key) {
    return Boolean(edge && key && (edge.from === key || edge.to === key));
}

function directNeighbors(key) {
    const neighbors = new Set();

    if (!key) return neighbors;

    for (const edge of currentEdges || []) {
        if (edge.from === key && currentEntries?.[edge.to]) {
            neighbors.add(edge.to);
        }

        if (edge.to === key && currentEntries?.[edge.from]) {
            neighbors.add(edge.from);
        }
    }

    return neighbors;
}

function buildAdjacencyFromCurrentGraph() {
    const adjacency = new Map();

    for (const key of Object.keys(currentEntries || {})) {
        adjacency.set(key, new Set());
    }

    for (const edge of currentEdges || []) {
        if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;

        adjacency.get(edge.from).add(edge.to);
        adjacency.get(edge.to).add(edge.from);
    }

    return adjacency;
}

function relationLabelBetween(sourceKey, targetKey) {
    const edge = (currentEdges || []).find((candidate) => {
        return (
            (candidate.from === sourceKey && candidate.to === targetKey) ||
            (candidate.from === targetKey && candidate.to === sourceKey)
        );
    });

    return edge ? String(edge.relation || '').replace(/_/g, ' ') : '';
}

// ── Focus Helpers ──────────────────────────────────────────────────────

function focusStyle(distance) {
    return FOCUS_SCALE[Math.min(distance, FOCUS_SCALE.length - 1)];
}

function focusDistances(rootKey) {
    const distances = new Map();

    if (!rootKey || !currentEntries?.[rootKey]) {
        return distances;
    }

    const focusDepth = Number(graphSettings?.focusDepth) || DEFAULT_FOCUS_MAX_DEPTH;
    const adjacency = buildAdjacencyFromCurrentGraph();

    distances.set(rootKey, 0);

    const queue = [rootKey];

    for (let i = 0; i < queue.length; i += 1) {
        const current = queue[i];
        const distance = distances.get(current);

        if (distance >= focusDepth) continue;

        const neighbors = Array.from(adjacency.get(current) || []).sort();

        for (const neighbor of neighbors) {
            if (distances.has(neighbor)) continue;

            distances.set(neighbor, distance + 1);
            queue.push(neighbor);
        }
    }

    return distances;
}

function focusedEdgeDistance(edge, distances, rootKey, selectedMode) {
    const fromDistance = distances.get(edge.from);
    const toDistance = distances.get(edge.to);

    if (fromDistance === undefined || toDistance === undefined) {
        return null;
    }

    const maxDistance = Math.max(fromDistance, toDistance);

    if (!selectedMode) {
        return edgeTouches(edge, rootKey) ? maxDistance : null;
    }

    if (maxDistance > RADIAL_LAYOUT_MAX_DEPTH) return null;
    if (edgeTouches(edge, rootKey)) return maxDistance;
    if (Math.abs(fromDistance - toDistance) === 1) return maxDistance;

    return null;
}

// ── Mini Node Detail Helpers ───────────────────────────────────────────

function getMiniDetailClass(distance) {
    if (distance === undefined) return 'unrelated-detail';
    if (distance === 0) return 'focus-root';
    if (distance === 1) return 'near-detail';
    if (distance === 2) return 'mid-detail';

    return 'far-detail';
}

function clearMiniDetailClasses(nodeEl) {
    nodeEl.classList.remove(
        'focus-root',
        'near-detail',
        'mid-detail',
        'far-detail',
        'unrelated-detail'
    );
}

function applyMiniDetail(nodeEl, distance, rootKey) {
    if (!nodeEl) return;

    clearMiniDetailClasses(nodeEl);

    const relationEl = nodeEl.querySelector('.node-mini-relation');

    if (relationEl) {
        relationEl.textContent = '';
    }

    if (!rootKey) return;

    nodeEl.classList.add(getMiniDetailClass(distance));

    if (relationEl) {
        relationEl.textContent = distance === 1
            ? relationLabelBetween(nodeEl.dataset.key, rootKey)
            : '';
    }
}

// ── Node Chrome Helpers ────────────────────────────────────────────────

function resetNodeChrome(nodeEl, key) {
    if (!nodeEl) return;

    const color = nodeIdentityColor(key);

    nodeEl.style.opacity = '';
    nodeEl.style.borderColor = `${color}44`;
    nodeEl.style.boxShadow = '0 2px 14px #00000055';
}

function applyNodeFocusChrome(nodeEl, distance) {
    if (!nodeEl) return;

    const style = focusStyle(distance);
    const intensity = Number(graphSettings?.focusIntensity) || 1;

    const opacity = distance === 0
        ? 1
        : Math.max(0.2, Math.min(1, style.opacity + (1 - intensity) * 0.12));

    const ring = Math.max(1, style.ring * intensity);
    const glow = Math.max(4, style.glow * intensity);

    nodeEl.style.opacity = String(opacity);
    nodeEl.style.borderColor = `${style.color}bb`;
    nodeEl.style.boxShadow =
        `0 0 0 ${ring}px ${style.color}44, ` +
        `0 0 ${glow}px ${style.color}33, ` +
        '0 4px 24px #00000088';
}

// ── Edge Chrome Helpers ────────────────────────────────────────────────

function resetEdgeChrome(group) {
    if (!group) return;

    group.style.opacity = '';
    group.style.filter = '';

    for (const path of group.querySelectorAll('path')) {
        path.setAttribute('stroke-opacity', '0.42');
    }

    for (const text of group.querySelectorAll('text')) {
        text.setAttribute('opacity', '0.85');
    }

    for (const rect of group.querySelectorAll('rect')) {
        rect.setAttribute('opacity', '0.84');
    }
}

function applyEdgeFocusChrome(group, distance) {
    if (!group) return;

    const style = focusStyle(distance);
    const intensity = Number(graphSettings?.focusIntensity) || 1;

    const edgeOpacity = Math.max(
        0.18,
        Math.min(0.98, style.edgeOpacity + (1 - intensity) * 0.1)
    );

    group.style.opacity = String(edgeOpacity);
    group.style.filter =
        `drop-shadow(0 0 ${Math.max(4, (style.glow * intensity) / 3)}px ${style.color}99)`;

    for (const path of group.querySelectorAll('path')) {
        path.setAttribute('stroke-opacity', String(edgeOpacity));
    }

    for (const text of group.querySelectorAll('text')) {
        text.setAttribute('opacity', String(Math.min(0.95, edgeOpacity + 0.16)));
    }

    for (const rect of group.querySelectorAll('rect')) {
        rect.setAttribute('opacity', String(Math.min(0.9, edgeOpacity + 0.2)));
    }
}

// ── Compare / Zoom Helpers ─────────────────────────────────────────────

function sameJson(a, b) {
    if (a === b) return true;

    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return false;
    }
}

function clampScale(value) {
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(value) || 1));
}