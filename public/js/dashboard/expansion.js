'use strict';

// ── Visibility State ───────────────────────────────────────────────────

const visibleNodeIds = new Set();
const visibleEdgeIds = new Set();
const expandedNodeIds = new Set();

// ── Category Colors ────────────────────────────────────────────────────

const CATEGORY_COLORS = {
    project:      '#6366f1',
    session:      '#22c55e',
    decision:     '#f59e0b',
    arch:         '#0ea5e9',
    architecture: '#0ea5e9',
    policy:       '#a855f7',
    workflow:     '#f97316',
    file:         '#14b8a6',
    source:       '#84cc16',
    change:       '#ef4444',
    plan:         '#8b5cf6',
    insight:      '#ec4899',
    feature:      '#06b6d4',
    task:         '#eab308',
    blocker:      '#dc2626',
    reference:    '#64748b',
    agent:        '#10b981',
    preference:   '#7c3aed',
    data:         '#0891b2',
    api:          '#d946ef',
    setup:        '#4ade80',
};

function isMainNode(key) {
    const k = String(key || '');
    return k.startsWith('project.') || k.startsWith('session.');
}

function getNodeCategory(key) {
    return String(key || '').split('.')[0] || 'unknown';
}

function getCategoryColor(key) {
    return CATEGORY_COLORS[getNodeCategory(key)] || '#475569';
}

function getStableNodeColor(key) {
    const hue = stableHash(String(key)) % 360;
    return `hsl(${hue}, 65%, 55%)`;
}

// Returns width/height scale multiplier for this node relative to base card.
// Project: 2.0–2.4×, session: 1.3–1.6×, child: 0.60×  (strong visual hierarchy)
function getNodeWidthScale(key) {
    const k = String(key || '');
    const isProject = k.startsWith('project.');
    const isSession = k.startsWith('session.');
    const connections = (currentEdges || []).filter(
        (e) => e.from === key || e.to === key
    ).length;
    if (isProject) return Math.min(2.0 + connections * 0.04, 2.4);
    if (isSession) return Math.min(1.3 + connections * 0.03, 1.6);
    return 0.60;
}

// ── Edge / Neighbor Helpers ────────────────────────────────────────────

function getNeighborKeys(key) {
    const neighbors = new Set();
    for (const edge of currentEdges || []) {
        if (edge.from === key && currentEntries[edge.to])  neighbors.add(edge.to);
        if (edge.to   === key && currentEntries[edge.from]) neighbors.add(edge.from);
    }
    return neighbors;
}

// ── Visibility Sync ────────────────────────────────────────────────────

// Show an edge only when BOTH endpoints are visible AND at least one is a
// main node or an expanded node — prevents cross-child edge explosion.
function recomputeVisibleEdges() {
    visibleEdgeIds.clear();
    for (const edge of currentEdges || []) {
        if (!visibleNodeIds.has(edge.from) || !visibleNodeIds.has(edge.to)) continue;
        const srcAnchor = isMainNode(edge.from) || expandedNodeIds.has(edge.from);
        const tgtAnchor = isMainNode(edge.to)   || expandedNodeIds.has(edge.to);
        if (srcAnchor || tgtAnchor) visibleEdgeIds.add(edgeKey(edge));
    }
}

function initVisibility() {
    visibleNodeIds.clear();
    visibleEdgeIds.clear();
    expandedNodeIds.clear();
    for (const key of Object.keys(currentEntries || {})) {
        if (isMainNode(key)) visibleNodeIds.add(key);
    }
    recomputeVisibleEdges();
}

// Call after live updates — ensures new main nodes appear, deleted nodes vanish.
function syncMainNodeVisibility() {
    let changed = false;
    for (const key of Object.keys(currentEntries || {})) {
        if (isMainNode(key) && !visibleNodeIds.has(key)) {
            visibleNodeIds.add(key);
            changed = true;
        }
    }
    for (const key of Array.from(visibleNodeIds)) {
        if (!currentEntries[key]) {
            visibleNodeIds.delete(key);
            expandedNodeIds.delete(key);
            changed = true;
        }
    }
    if (changed) recomputeVisibleEdges();
    return changed;
}

// ── Expand ─────────────────────────────────────────────────────────────

function expandNode(key) {
    if (!currentEntries[key]) return [];
    expandedNodeIds.add(key);

    // Prefer child_of children if any exist — keeps hierarchy expansion shallow
    const childOfKeys = (currentEdges || [])
        .filter((e) => e.from === key && e.relation === 'child_of')
        .map((e) => e.to)
        .filter((k) => currentEntries[k]);

    const keysToReveal = childOfKeys.length > 0 ? childOfKeys : getNeighborKeys(key);
    const newKeys = [];
    for (const neighborKey of keysToReveal) {
        if (!visibleNodeIds.has(neighborKey)) {
            visibleNodeIds.add(neighborKey);
            newKeys.push(neighborKey);
        }
    }
    recomputeVisibleEdges();
    return newKeys;
}

// ── Collapse ───────────────────────────────────────────────────────────

function collapseNode(key) {
    expandedNodeIds.delete(key);

    // Build kept set: main nodes + children of still-expanded nodes
    const keptSet = new Set();
    for (const k of Object.keys(currentEntries || {})) {
        if (isMainNode(k)) keptSet.add(k);
    }
    for (const expKey of expandedNodeIds) {
        if (!currentEntries[expKey]) continue;
        keptSet.add(expKey);
        for (const n of getNeighborKeys(expKey)) keptSet.add(n);
    }

    const removed = new Set();
    for (const neighborKey of getNeighborKeys(key)) {
        if (!keptSet.has(neighborKey)) {
            if (expandedNodeIds.has(neighborKey)) collapseNode(neighborKey);
            visibleNodeIds.delete(neighborKey);
            removed.add(neighborKey);
        }
    }
    recomputeVisibleEdges();
    return removed;
}

// ── Toggle ─────────────────────────────────────────────────────────────

function toggleNodeExpansion(key) {
    if (expandedNodeIds.has(key)) {
        return { action: 'collapse', removed: collapseNode(key) };
    }
    const newKeys = expandNode(key);
    return { action: 'expand', newKeys };
}

// ── Bulk Ops ───────────────────────────────────────────────────────────

function expandAllVisible() {
    const snapshot = Array.from(visibleNodeIds);
    for (const key of snapshot) expandNode(key);
}

function collapseAll() {
    initVisibility();
}

// ── Search Reveal ──────────────────────────────────────────────────────

function revealPathToNode(targetKey) {
    if (!currentEntries[targetKey] || visibleNodeIds.has(targetKey)) return;

    // BFS from all currently-visible main nodes
    const visited = new Map(); // key → parent key
    const queue = [];
    for (const key of visibleNodeIds) {
        if (isMainNode(key)) { queue.push(key); visited.set(key, null); }
    }

    let found = false;
    outer: while (queue.length > 0) {
        const current = queue.shift();
        for (const n of getNeighborKeys(current)) {
            if (!visited.has(n)) {
                visited.set(n, current);
                if (n === targetKey) { found = true; break outer; }
                queue.push(n);
            }
        }
    }

    if (!found) return;

    let curr = targetKey;
    while (curr != null) {
        visibleNodeIds.add(curr);
        const par = visited.get(curr);
        if (par != null) expandedNodeIds.add(par);
        curr = par;
    }
    recomputeVisibleEdges();
}
