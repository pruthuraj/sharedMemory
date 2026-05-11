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

// ── Settings-Derived Helpers ───────────────────────────────────────────

function dimmedNodeOpacity() {
    const intensity = Number(graphSettings?.focusIntensity) || 0;

    return Math.max(0.08, 0.3 - intensity * 0.11);
}

function dimmedEdgeOpacity() {
    const intensity = Number(graphSettings?.focusIntensity) || 0;

    return Math.max(0.06, 0.2 - intensity * 0.07);
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

// ── Node Degree Helper ─────────────────────────────────────────────────

function nodeDegree(key) {
    let degree = 0;

    for (const edge of currentEdges || []) {
        if (edgeTouches(edge, key)) degree += 1;
    }

    return degree;
}

// ── RPC Helpers ────────────────────────────────────────────────────────

function makeRequestId(prefix = 'rpc') {
    nextRpcId += 1;

    return `__${prefix}_${Date.now()}_${nextRpcId}__`;
}

// ── Edge / Graph Helpers ───────────────────────────────────────────────

function edgeKey(edge) {
    return `${edge.from}${edge.relation}${edge.to}`;
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

// ── Focus Helpers ──────────────────────────────────────────────────────

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

// ── Compare Helpers ────────────────────────────────────────────────────

function sameJson(a, b) {
    if (a === b) return true;

    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return false;
    }
}
