'use strict';

// ── Layout ─────────────────────────────────────────────────────────────
function computeLayout(entries, edges) {
    const mode = (graphSettings && graphSettings.layoutMode) || 'radial';
    if (mode === 'force') return computeForceLayout(entries, edges);
    if (mode === 'hierarchical') return computeHierarchicalLayout(entries, edges);
    return computeRadialLayout(entries, edges);
}

function computeHierarchicalLayout(entries, edges) {
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setGraph({ rankdir: 'LR', ranksep: 90, nodesep: 20, marginx: 60, marginy: 60 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const [key, entry] of Object.entries(entries)) {
        g.setNode(key, { width: NODE_W, height: nodeHeight(entry) });
    }
    const seen = new Set();
    for (const edge of edges) {
        if (!entries[edge.from] || !entries[edge.to]) continue;
        const id = `${edge.from}||${edge.relation}||${edge.to}`;
        if (seen.has(id)) continue;
        seen.add(id);
        g.setEdge(edge.from, edge.to, {}, id);
    }
    dagre.layout(g);
    const positions = {};
    for (const key of g.nodes()) {
        const n = g.node(key);
        if (n) positions[key] = { x: n.x - n.width / 2, y: n.y - n.height / 2, w: n.width, h: n.height };
    }
    return positions;
}

function computeRadialLayout(entries, edges) {
    const keys = Object.keys(entries);
    if (!keys.length) return {};

    // Group by namespace (prefix before first '.')
    const nsMap = {};
    for (const key of keys) {
        const ns = key.split('.')[0];
        if (!nsMap[ns]) nsMap[ns] = [];
        nsMap[ns].push(key);
    }
    const namespaces = Object.keys(nsMap).sort((a, b) => nsMap[b].length - nsMap[a].length);
    const total = keys.length;
    const BASE_RADIUS = Math.max(320, total * 38);
    const positions = {};
    let angleStart = -Math.PI / 2;

    for (const ns of namespaces) {
        const nsKeys = nsMap[ns];
        // Higher importance → inner ring
        nsKeys.sort((a, b) => (entries[b].importance || 0) - (entries[a].importance || 0));
        const sectorAngle = (nsKeys.length / total) * Math.PI * 2;
        const rings = Math.max(1, Math.ceil(Math.sqrt(nsKeys.length)));
        nsKeys.forEach((key, i) => {
            const ring = Math.floor(i / rings);
            const posInRing = i % rings;
            const totalRings = Math.ceil(nsKeys.length / rings);
            const ringCount = Math.min(rings, nsKeys.length - ring * rings);
            const radiusFrac = totalRings <= 1 ? 0.6 : 0.35 + 0.65 * (ring / (totalRings - 1));
            const radius = BASE_RADIUS * radiusFrac;
            const angle = angleStart + (posInRing + 0.5) / ringCount * sectorAngle;
            const w = NODE_W;
            const h = nodeHeight(entries[key]);
            positions[key] = { x: Math.cos(angle) * radius - w / 2, y: Math.sin(angle) * radius - h / 2, w, h };
        });
        angleStart += sectorAngle;
    }
    return positions;
}

function computeForceLayout(entries, edges) {
    const keys = Object.keys(entries);
    if (!keys.length) return {};
    const n = keys.length;
    const spread = Math.max(380, n * 55);

    // Seed on a circle so the layout is deterministic
    const pos = {}, vel = {};
    keys.forEach((key, i) => {
        const angle = (i / n) * Math.PI * 2;
        pos[key] = { x: Math.cos(angle) * spread * 0.45, y: Math.sin(angle) * spread * 0.45 };
        vel[key] = { x: 0, y: 0 };
    });

    // Build adjacency list (undirected)
    const adj = {};
    for (const e of edges) {
        if (!pos[e.from] || !pos[e.to]) continue;
        (adj[e.from] = adj[e.from] || []).push(e.to);
        (adj[e.to] = adj[e.to] || []).push(e.from);
    }

    const REPULSION = 9000;
    const SPRING_K = 0.05;
    const SPRING_LEN = 260;
    const CENTER_K = 0.007;
    const DAMPING = 0.82;

    for (let iter = 0; iter < 300; iter++) {
        const force = {};
        for (const k of keys) force[k] = { x: 0, y: 0 };

        // O(n²) repulsion
        for (let i = 0; i < keys.length; i++) {
            for (let j = i + 1; j < keys.length; j++) {
                const a = keys[i], b = keys[j];
                const dx = pos[b].x - pos[a].x;
                const dy = pos[b].y - pos[a].y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const f = REPULSION / (dist * dist);
                const ux = dx / dist, uy = dy / dist;
                force[a].x -= ux * f; force[a].y -= uy * f;
                force[b].x += ux * f; force[b].y += uy * f;
            }
        }

        // Spring attraction along edges
        for (const [from, targets] of Object.entries(adj)) {
            for (const to of targets) {
                const dx = pos[to].x - pos[from].x;
                const dy = pos[to].y - pos[from].y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const f = SPRING_K * (dist - SPRING_LEN);
                force[from].x += (dx / dist) * f;
                force[from].y += (dy / dist) * f;
            }
        }

        // Weak center gravity
        for (const k of keys) {
            force[k].x -= pos[k].x * CENTER_K;
            force[k].y -= pos[k].y * CENTER_K;
        }

        // Integrate
        for (const k of keys) {
            vel[k].x = (vel[k].x + force[k].x) * DAMPING;
            vel[k].y = (vel[k].y + force[k].y) * DAMPING;
            pos[k].x += vel[k].x;
            pos[k].y += vel[k].y;
        }
    }

    const result = {};
    for (const key of keys) {
        const w = NODE_W;
        const h = nodeHeight(entries[key]);
        result[key] = { x: pos[key].x - w / 2, y: pos[key].y - h / 2, w, h };
    }
    return result;
}

function setNodePresentation(key, nodeEl) {
    const isExpanded = expandedNodes.has(key);
    nodeEl.classList.toggle('expanded', isExpanded);
    nodeEl.classList.toggle('round', !isExpanded);
    nodeEl.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    applyNodePlacement(nodeEl, key);
}

// Toggle node between round and expanded state with animation.
function toggleNodeExpanded(key, nodeEl) {
    if (expandedNodes.has(key)) {
        expandedNodes.delete(key);
    } else {
        expandedNodes.add(key);
    }

    setNodePresentation(key, nodeEl);
    rerenderEdgesForCurrentPositions();
    window.setTimeout(rerenderEdgesForCurrentPositions, NODE_TRANSITION_MS);
}

// ── Graph render orchestration ─────────────────────────────────────────
function mergePreservedPositions(nextPositions, previousPositions) {
    const merged = {};
    for (const [key, pos] of Object.entries(nextPositions)) {
        merged[key] = previousPositions[key]
            ? { ...pos, x: previousPositions[key].x, y: previousPositions[key].y }
            : pos;
    }
    return merged;
}

function sizeSceneToPositions(positions) {
    let maxX = 0, maxY = 0;
    for (const [key, p] of Object.entries(positions)) {
        const box = nodeVisualBox(key, p);
        maxX = Math.max(maxX, box.x + box.w);
        maxY = Math.max(maxY, box.y + box.h);
    }
    edgesSvg.setAttribute('width', maxX + 80);
    edgesSvg.setAttribute('height', maxY + 80);
}

function rerenderEdgesForCurrentPositions() {
    sizeSceneToPositions(nodePositions);
    renderEdges(currentEdges, nodePositions, currentEntries);
    applyFocusState();
}

// Apply settings-driven filters (min importance, relation-type toggles) to a
// raw entry/edge pair. Edges referencing filtered-out entries are dropped.
function filteredGraph(entries, edges) {
    const minImportance = Number(graphSettings.minImportance) || 0;
    const relFilters = graphSettings.relationFilters || {};
    const visibleEntries = {};
    for (const [key, entry] of Object.entries(entries)) {
        if ((entry.importance ?? 0) < minImportance) continue;
        visibleEntries[key] = entry;
    }
    const visibleEdges = edges.filter((e) => {
        if (relFilters[e.relation] === false) return false;
        return visibleEntries[e.from] && visibleEntries[e.to];
    });
    return { entries: visibleEntries, edges: visibleEdges };
}

function renderGraph(rawEntries, rawEdges, options = {}) {
    const filtered = filteredGraph(rawEntries, rawEdges);
    const entries = filtered.entries;
    const edges = filtered.edges;
    const previousSelected = options.preserveSelection ? selectedKey : null;
    const previousPositions = options.preservePositions ? nodePositions : {};
    for (const el of scene.querySelectorAll('.mem-node')) el.remove();
    selectedKey = null;
    focusedKey = null;
    lastFocusedKey = null;
    detailPanel.classList.remove('visible');
    document.body.classList.remove('inspector-open');

    const keys = Object.keys(entries);
    for (const key of Array.from(expandedNodes)) {
        if (!entries[key]) expandedNodes.delete(key);
    }
    emptyState.classList.toggle('visible', keys.length === 0);
    updateLegend();
    renderIdentityPanel();

    if (!keys.length) {
        nodePositions = {};
        renderEdges([], {}, {});
        return;
    }

    const computedPositions = computeLayout(entries, edges);
    const positions = options.preservePositions
        ? mergePreservedPositions(computedPositions, previousPositions)
        : computedPositions;
    nodePositions = positions;

    sizeSceneToPositions(positions);

    renderEdges(edges, positions, entries);

    for (const [key, entry] of Object.entries(entries)) {
        if (positions[key]) scene.appendChild(buildNodeEl(key, entry, positions[key]));
    }

    if (options.fit !== false) fitView(positions);
    else applyTransform();

    if (previousSelected && entries[previousSelected]) {
        openDetail(previousSelected, entries[previousSelected]);
    } else {
        applyFocusState();
    }
}
