'use strict';

// ── Helpers ────────────────────────────────────────────────────────────
function esc(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Settings persistence and palette/edge-label application now live in
// js/settings/. The onChange subscriber installed in initSettings() runs the
// graph-side effects (relationColors refresh, edge re-render, focus rerun,
// live-refresh timer, filtered reload) when any setting changes.

function dimmedNodeOpacity() {
    return Math.max(0.08, 0.3 - graphSettings.focusIntensity * 0.11);
}

function dimmedEdgeOpacity() {
    return Math.max(0.06, 0.2 - graphSettings.focusIntensity * 0.07);
}

function zoomButtonFactor() {
    return 1 + (DEFAULT_BUTTON_ZOOM_STEP - 1) * graphSettings.zoomSpeed;
}

function ageColor(ts) {
    const ms = Date.now() - ts;
    if (ms < 3_600_000) return '#10b981';
    if (ms < 86_400_000) return '#6366f1';
    return '#475569';
}

function nodeIdentityColor(key) {
    const hue = stableHash(String(key)) % 360;
    return `hsl(${hue} 78% 58%)`;
}

function ageLabel(ts) {
    const ms = Date.now() - ts;
    if (ms < 60_000) return 'just now';
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
}

function setStatus(msg, cls = '') {
    statusText.textContent = msg;
    statusText.className = cls;
}

function nodeHeight(entry) {
    let h = 62;
    if (entry.tags && entry.tags.length) h += 22;
    if (entry.importance > 0) h += 18;
    return h;
}

function nodeDegree(key) {
    let degree = 0;
    for (const edge of currentEdges) {
        if (edge.from === key || edge.to === key) degree += 1;
    }
    return degree;
}

function collapsedNodeSize(key) {
    const degree = nodeDegree(key);
    const scale = Number(graphSettings && graphSettings.nodeScale) || 1;
    const size = (NODE_ROUND_MIN + Math.sqrt(degree) * NODE_ROUND_GROWTH) * scale;
    return Math.round(Math.min(NODE_ROUND_MAX * scale, size));
}

function nodeVisualBox(key, pos, entry = currentEntries[key]) {
    const slotHeight = nodeHeight(entry || {});
    const expanded = expandedNodes.has(key);
    const roundSize = collapsedNodeSize(key);
    const w = expanded ? NODE_W : roundSize;
    const h = expanded ? slotHeight : roundSize;
    return {
        x: pos.x + (NODE_W - w) / 2,
        y: pos.y + (slotHeight - h) / 2,
        w,
        h,
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

    const halfW = box.w / 2;
    const halfH = box.h / 2;
    const scale = 1 / Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH, 1);
    return {
        x: center.x + dx * scale,
        y: center.y + dy * scale,
    };
}

function applyNodePlacement(nodeEl, key) {
    const pos = nodePositions[key];
    const entry = currentEntries[key];
    if (!pos || !entry) return;

    const box = nodeVisualBox(key, pos, entry);
    nodeEl.style.left = `${box.x}px`;
    nodeEl.style.top = `${box.y}px`;
    nodeEl.style.setProperty('--node-w', `${box.w}px`);
    nodeEl.style.setProperty('--node-h', `${box.h}px`);
    nodeEl.style.setProperty('--node-degree', String(nodeDegree(key)));
}

function setSlotCenter(key, centerX, centerY) {
    const pos = nodePositions[key];
    const entry = currentEntries[key];
    if (!pos || !entry) return;

    pos.x = centerX - NODE_W / 2;
    pos.y = centerY - nodeHeight(entry) / 2;
}

function svgEl(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

function makeRequestId(prefix) {
    nextRpcId += 1;
    return `__${prefix}_${Date.now()}_${nextRpcId}__`;
}

function edgeKey(edge) {
    return `${edge.from}\u001f${edge.relation}\u001f${edge.to}`;
}

function edgeTouches(edge, key) {
    return edge.from === key || edge.to === key;
}

function directNeighbors(key) {
    const neighbors = new Set();
    if (!key) return neighbors;

    for (const edge of currentEdges) {
        if (edge.from === key && currentEntries[edge.to]) neighbors.add(edge.to);
        if (edge.to === key && currentEntries[edge.from]) neighbors.add(edge.from);
    }

    return neighbors;
}

function focusStyle(distance) {
    return FOCUS_SCALE[Math.min(distance, FOCUS_SCALE.length - 1)];
}

function focusDistances(rootKey) {
    const distances = new Map();
    if (!rootKey || !currentEntries[rootKey]) return distances;

    const adjacency = new Map();
    for (const key of Object.keys(currentEntries)) adjacency.set(key, new Set());

    for (const edge of currentEdges) {
        if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
        adjacency.get(edge.from).add(edge.to);
        adjacency.get(edge.to).add(edge.from);
    }

    distances.set(rootKey, 0);
    const queue = [rootKey];
    for (let i = 0; i < queue.length; i += 1) {
        const current = queue[i];
        const distance = distances.get(current);
        if (distance >= graphSettings.focusDepth) continue;

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
    if (fromDistance === undefined || toDistance === undefined) return null;
    const maxDistance = Math.max(fromDistance, toDistance);

    if (!selectedMode) {
        return edgeTouches(edge, rootKey) ? maxDistance : null;
    }

    if (maxDistance > RADIAL_LAYOUT_MAX_DEPTH) return null;
    if (edgeTouches(edge, rootKey)) return maxDistance;
    if (Math.abs(fromDistance - toDistance) === 1) return maxDistance;
    return null;
}

function stableHash(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

function relationLabelBetween(sourceKey, targetKey) {
    const edge = currentEdges.find(candidate =>
        (candidate.from === sourceKey && candidate.to === targetKey) ||
        (candidate.from === targetKey && candidate.to === sourceKey)
    );
    return edge ? edge.relation.replace(/_/g, ' ') : '';
}

function applyMiniDetail(node, distance, rootKey) {
    node.classList.remove('focus-root', 'near-detail', 'mid-detail', 'far-detail', 'unrelated-detail');
    const relationEl = node.querySelector('.node-mini-relation');
    if (relationEl) relationEl.textContent = '';

    if (!rootKey) return;

    if (distance === undefined) {
        node.classList.add('unrelated-detail');
    } else if (distance === 0) {
        node.classList.add('focus-root');
    } else if (distance === 1) {
        node.classList.add('near-detail');
    } else if (distance === 2) {
        node.classList.add('mid-detail');
    } else {
        node.classList.add('far-detail');
    }

    if (relationEl) {
        relationEl.textContent = distance === 1 ? relationLabelBetween(node.dataset.key, rootKey) : '';
    }
}

function resetNodeChrome(node, key) {
    const color = nodeIdentityColor(key);
    node.style.opacity = '';
    node.style.borderColor = `${color}44`;
    node.style.boxShadow = '0 2px 14px #00000055';
}

function applyNodeFocusChrome(node, distance) {
    const style = focusStyle(distance);
    const intensity = graphSettings.focusIntensity;
    const opacity = distance === 0
        ? 1
        : Math.max(0.2, Math.min(1, style.opacity + (1 - intensity) * 0.12));
    const ring = Math.max(1, style.ring * intensity);
    const glow = Math.max(4, style.glow * intensity);
    node.style.opacity = String(opacity);
    node.style.borderColor = `${style.color}bb`;
    node.style.boxShadow =
        `0 0 0 ${ring}px ${style.color}44, 0 0 ${glow}px ${style.color}33, 0 4px 24px #00000088`;
}

function resetEdgeChrome(group) {
    group.style.opacity = '';
    group.style.filter = '';
    for (const path of group.querySelectorAll('path')) path.setAttribute('stroke-opacity', '0.42');
    for (const text of group.querySelectorAll('text')) text.setAttribute('opacity', '0.85');
    for (const rect of group.querySelectorAll('rect')) rect.setAttribute('opacity', '0.84');
}

function applyEdgeFocusChrome(group, distance) {
    const style = focusStyle(distance);
    const intensity = graphSettings.focusIntensity;
    const edgeOpacity = Math.max(0.18, Math.min(0.98, style.edgeOpacity + (1 - intensity) * 0.1));
    group.style.opacity = String(edgeOpacity);
    group.style.filter = `drop-shadow(0 0 ${Math.max(4, (style.glow * intensity) / 3)}px ${style.color}99)`;
    for (const path of group.querySelectorAll('path')) path.setAttribute('stroke-opacity', String(edgeOpacity));
    for (const text of group.querySelectorAll('text')) text.setAttribute('opacity', String(Math.min(0.95, edgeOpacity + 0.16)));
    for (const rect of group.querySelectorAll('rect')) rect.setAttribute('opacity', String(Math.min(0.9, edgeOpacity + 0.2)));
}

function sameJson(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function updateLegend() {
    const keys = Object.keys(currentEntries);
    document.getElementById('ld-nodes').querySelector('span:last-child').textContent =
        `${keys.length} ${keys.length === 1 ? 'node' : 'nodes'}`;
    document.getElementById('ld-edges').querySelector('span:last-child').textContent =
        `${currentEdges.length} ${currentEdges.length === 1 ? 'edge' : 'edges'}`;
}

function updateStatusCount() {
    const nc = Object.keys(currentEntries).length;
    const ec = currentEdges.length;
    setStatus(`${nc} nodes - ${ec} edges`, 'ok');
}

function clampScale(value) {
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value));
}
