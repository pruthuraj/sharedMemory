'use strict';

// ── Layout Constants ───────────────────────────────────────────────────

const DEFAULT_LAYOUT_MODE = 'radial';

const HIERARCHICAL_LAYOUT_OPTIONS = {
    rankdir: 'LR',
    ranksep: 90,
    nodesep: 20,
    marginx: 60,
    marginy: 60,
};

const RADIAL_MIN_RADIUS = 320;
const RADIAL_RADIUS_PER_NODE = 38;

const FORCE_MIN_SPREAD = 380;
const FORCE_SPREAD_PER_NODE = 55;
const FORCE_ITERATIONS = 300;
const FORCE_REPULSION = 9000;
const FORCE_SPRING_K = 0.05;
const FORCE_SPRING_LEN = 260;
const FORCE_CENTER_K = 0.007;
const FORCE_DAMPING = 0.82;

const SCENE_PADDING = 80;

// ── Layout Performance Optimization ───────────────────────────────────

const FORCE_LAYOUT_MAX_NODES = 100;
const FORCE_LAYOUT_LARGE_GRAPH_NODES = 60;
const FORCE_LAYOUT_MEDIUM_GRAPH_NODES = 35;
const FORCE_LAYOUT_LARGE_ITERATIONS = 120;
const FORCE_LAYOUT_MEDIUM_ITERATIONS = 180;

let cachedLayoutKey = null;
let cachedPositions = null;

// ── Layout Selection ───────────────────────────────────────────────────

function getLayoutMode() {
    return graphSettings?.layoutMode || DEFAULT_LAYOUT_MODE;
}

function buildLayoutCacheKey(entries, edges) {
    const entrySignature = Object.keys(entries || {})
        .sort()
        .map((key) => {
            const entry = entries[key] || {};
            const tags = Array.isArray(entry.tags) ? entry.tags.length : 0;
            const importance = Number(entry.importance) || 0;

            return `${key}:${nodeHeight(entry)}:${importance}:${tags}`;
        })
        .join('|');

    const edgeSignature = (edges || [])
        .filter((edge) => isUsableEdge(edge, entries))
        .map(getEdgeIdentity)
        .sort()
        .join('|');

    return JSON.stringify({
        layoutMode: getLayoutMode(),
        entrySignature,
        edgeSignature,
    });
}

function clonePositions(positions = {}) {
    const clone = {};

    for (const [key, position] of Object.entries(positions)) {
        clone[key] = { ...position };
    }

    return clone;
}

function computeLayout(entries, edges) {
    const mode = getLayoutMode();
    const nodeCount = Object.keys(entries || {}).length;

    // Check cache first
    const cacheKey = buildLayoutCacheKey(entries, edges);
    if (cacheKey === cachedLayoutKey && cachedPositions) {
        return clonePositions(cachedPositions);
    }

    // Force layout can be O(n²); switch to radial if too many nodes
    let effectiveMode = mode;
    if (mode === 'force' && nodeCount > FORCE_LAYOUT_MAX_NODES) {
        effectiveMode = 'radial';
    }

    let result;
    switch (effectiveMode) {
        case 'force':
            result = computeForceLayout(entries, edges);
            break;

        case 'hierarchical':
            result = computeHierarchicalLayout(entries, edges);
            break;

        case 'radial':
        default:
            result = computeRadialLayout(entries, edges);
            break;
    }

    cachedLayoutKey = cacheKey;
    cachedPositions = clonePositions(result);

    return result;
}

// ── Shared Helpers ─────────────────────────────────────────────────────

function getEntryKeys(entries) {
    return Object.keys(entries || {});
}

function hasEntry(entries, key) {
    return Boolean(entries && key && entries[key]);
}

function getNodeSize(entry) {
    return {
        w: NODE_W,
        h: nodeHeight(entry),
    };
}

function createPosition(x, y, entry) {
    const { w, h } = getNodeSize(entry);

    return {
        x: x - w / 2,
        y: y - h / 2,
        w,
        h,
    };
}

function isUsableEdge(edge, entries) {
    return Boolean(
        edge &&
        edge.from &&
        edge.to &&
        hasEntry(entries, edge.from) &&
        hasEntry(entries, edge.to)
    );
}

function getEdgeIdentity(edge) {
    return `${edge.from}||${edge.relation || ''}||${edge.to}`;
}

// ── Hierarchical Layout ────────────────────────────────────────────────

function computeHierarchicalLayout(entries, edges) {
    const g = new dagre.graphlib.Graph({ multigraph: true });

    g.setGraph(HIERARCHICAL_LAYOUT_OPTIONS);
    g.setDefaultEdgeLabel(() => ({}));

    for (const [key, entry] of Object.entries(entries)) {
        const { w, h } = getNodeSize(entry);

        g.setNode(key, {
            width: w,
            height: h,
        });
    }

    const seenEdges = new Set();

    for (const edge of edges) {
        if (!isUsableEdge(edge, entries)) continue;

        const id = getEdgeIdentity(edge);

        if (seenEdges.has(id)) continue;

        seenEdges.add(id);
        g.setEdge(edge.from, edge.to, {}, id);
    }

    dagre.layout(g);

    const positions = {};

    for (const key of g.nodes()) {
        const node = g.node(key);

        if (!node) continue;

        positions[key] = {
            x: node.x - node.width / 2,
            y: node.y - node.height / 2,
            w: node.width,
            h: node.height,
        };
    }

    return positions;
}

// ── Radial Layout ──────────────────────────────────────────────────────

function getNamespace(key) {
    return String(key).split('.')[0] || 'default';
}

function groupKeysByNamespace(keys) {
    const groups = {};

    for (const key of keys) {
        const namespace = getNamespace(key);

        if (!groups[namespace]) {
            groups[namespace] = [];
        }

        groups[namespace].push(key);
    }

    return groups;
}

function sortNamespacesBySize(namespaceGroups) {
    return Object.keys(namespaceGroups).sort((a, b) => {
        return namespaceGroups[b].length - namespaceGroups[a].length;
    });
}

function sortKeysByImportance(keys, entries) {
    return [...keys].sort((a, b) => {
        return (entries[b]?.importance || 0) - (entries[a]?.importance || 0);
    });
}

function computeRadialLayout(entries, edges) {
    const keys = getEntryKeys(entries);

    if (!keys.length) return {};

    const namespaceGroups = groupKeysByNamespace(keys);
    const namespaces = sortNamespacesBySize(namespaceGroups);

    const totalNodes = keys.length;
    const baseRadius = Math.max(
        RADIAL_MIN_RADIUS,
        totalNodes * RADIAL_RADIUS_PER_NODE
    );

    const positions = {};
    let angleStart = -Math.PI / 2;

    for (const namespace of namespaces) {
        const namespaceKeys = sortKeysByImportance(
            namespaceGroups[namespace],
            entries
        );

        const sectorAngle = (namespaceKeys.length / totalNodes) * Math.PI * 2;
        const ringCapacity = Math.max(1, Math.ceil(Math.sqrt(namespaceKeys.length)));
        const totalRings = Math.ceil(namespaceKeys.length / ringCapacity);

        namespaceKeys.forEach((key, index) => {
            const ringIndex = Math.floor(index / ringCapacity);
            const indexInRing = index % ringCapacity;
            const remainingInRing = namespaceKeys.length - ringIndex * ringCapacity;
            const nodesInRing = Math.min(ringCapacity, remainingInRing);

            const radiusFraction = totalRings <= 1
                ? 0.6
                : 0.35 + 0.65 * (ringIndex / (totalRings - 1));

            const radius = baseRadius * radiusFraction;
            const angle = angleStart + ((indexInRing + 0.5) / nodesInRing) * sectorAngle;

            positions[key] = createPosition(
                Math.cos(angle) * radius,
                Math.sin(angle) * radius,
                entries[key]
            );
        });

        angleStart += sectorAngle;
    }

    return positions;
}

// ── Force Layout ───────────────────────────────────────────────────────

function createInitialForceState(keys) {
    const count = keys.length;
    const spread = Math.max(FORCE_MIN_SPREAD, count * FORCE_SPREAD_PER_NODE);

    const positions = {};
    const velocities = {};

    keys.forEach((key, index) => {
        const angle = (index / count) * Math.PI * 2;

        positions[key] = {
            x: Math.cos(angle) * spread * 0.45,
            y: Math.sin(angle) * spread * 0.45,
        };

        velocities[key] = {
            x: 0,
            y: 0,
        };
    });

    return { positions, velocities };
}

function buildAdjacencyList(edges, positions) {
    const adjacency = {};

    for (const edge of edges) {
        if (!positions[edge.from] || !positions[edge.to]) continue;

        if (!adjacency[edge.from]) adjacency[edge.from] = new Set();
        if (!adjacency[edge.to]) adjacency[edge.to] = new Set();

        adjacency[edge.from].add(edge.to);
        adjacency[edge.to].add(edge.from);
    }

    return adjacency;
}

function createForceMap(keys) {
    const forces = {};

    for (const key of keys) {
        forces[key] = {
            x: 0,
            y: 0,
        };
    }

    return forces;
}

function applyRepulsionForces(keys, positions, forces) {
    for (let i = 0; i < keys.length; i += 1) {
        for (let j = i + 1; j < keys.length; j += 1) {
            const a = keys[i];
            const b = keys[j];

            const dx = positions[b].x - positions[a].x;
            const dy = positions[b].y - positions[a].y;
            const distance = Math.sqrt(dx * dx + dy * dy) || 1;

            const force = FORCE_REPULSION / (distance * distance);
            const ux = dx / distance;
            const uy = dy / distance;

            forces[a].x -= ux * force;
            forces[a].y -= uy * force;

            forces[b].x += ux * force;
            forces[b].y += uy * force;
        }
    }
}

function applySpringForces(adjacency, positions, forces) {
    for (const [from, targets] of Object.entries(adjacency)) {
        for (const to of targets) {
            const dx = positions[to].x - positions[from].x;
            const dy = positions[to].y - positions[from].y;
            const distance = Math.sqrt(dx * dx + dy * dy) || 1;

            const force = FORCE_SPRING_K * (distance - FORCE_SPRING_LEN);

            forces[from].x += (dx / distance) * force;
            forces[from].y += (dy / distance) * force;
        }
    }
}

function applyCenterGravity(keys, positions, forces) {
    for (const key of keys) {
        forces[key].x -= positions[key].x * FORCE_CENTER_K;
        forces[key].y -= positions[key].y * FORCE_CENTER_K;
    }
}

function integrateForces(keys, positions, velocities, forces) {
    for (const key of keys) {
        velocities[key].x = (velocities[key].x + forces[key].x) * FORCE_DAMPING;
        velocities[key].y = (velocities[key].y + forces[key].y) * FORCE_DAMPING;

        positions[key].x += velocities[key].x;
        positions[key].y += velocities[key].y;
    }
}

function forceIterationCount(nodeCount) {
    if (nodeCount >= FORCE_LAYOUT_LARGE_GRAPH_NODES) {
        return FORCE_LAYOUT_LARGE_ITERATIONS;
    }

    if (nodeCount >= FORCE_LAYOUT_MEDIUM_GRAPH_NODES) {
        return FORCE_LAYOUT_MEDIUM_ITERATIONS;
    }

    return FORCE_ITERATIONS;
}

function computeForceLayout(entries, edges) {
    const keys = getEntryKeys(entries);

    if (!keys.length) return {};

    const { positions, velocities } = createInitialForceState(keys);
    const adjacency = buildAdjacencyList(edges, positions);

    const iterations = forceIterationCount(keys.length);

    for (let iteration = 0; iteration < iterations; iteration += 1) {
        const forces = createForceMap(keys);

        applyRepulsionForces(keys, positions, forces);
        applySpringForces(adjacency, positions, forces);
        applyCenterGravity(keys, positions, forces);
        integrateForces(keys, positions, velocities, forces);
    }

    const result = {};

    for (const key of keys) {
        result[key] = createPosition(
            positions[key].x,
            positions[key].y,
            entries[key]
        );
    }

    return result;
}

// ── Node Presentation ──────────────────────────────────────────────────

function setNodePresentation(key, nodeEl) {
    if (!nodeEl) return;

    const isExpanded = expandedNodes.has(key);

    nodeEl.classList.toggle('expanded', isExpanded);
    nodeEl.classList.toggle('round', !isExpanded);
    nodeEl.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    nodeEl.setAttribute('aria-pressed', isExpanded ? 'true' : 'false');

    applyNodePlacement(nodeEl, key);
}

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

// ── Graph Render Helpers ───────────────────────────────────────────────

function mergePreservedPositions(nextPositions, previousPositions = {}) {
    const merged = {};

    for (const [key, position] of Object.entries(nextPositions)) {
        const previous = previousPositions[key];

        merged[key] = previous
            ? {
                ...position,
                x: previous.x,
                y: previous.y,
            }
            : position;
    }

    return merged;
}

function sizeSceneToPositions(positions) {
    let maxX = 0;
    let maxY = 0;

    for (const [key, position] of Object.entries(positions)) {
        const box = nodeVisualBox(key, position);

        maxX = Math.max(maxX, box.x + box.w);
        maxY = Math.max(maxY, box.y + box.h);
    }

    edgesSvg.setAttribute('width', maxX + SCENE_PADDING);
    edgesSvg.setAttribute('height', maxY + SCENE_PADDING);
}

function rerenderEdgesForCurrentPositions() {
    sizeSceneToPositions(nodePositions);
    renderEdges(currentEdges, nodePositions, currentEntries);
    applyFocusState();
}

function removeRenderedNodes() {
    for (const nodeEl of scene.querySelectorAll('.mem-node')) {
        nodeEl.remove();
    }
}

function resetGraphUiState() {
    selectedKey = null;
    focusedKey = null;
    lastFocusedKey = null;

    detailPanel.classList.remove('visible');
    document.body.classList.remove('inspector-open');
}

function pruneExpandedNodes(entries) {
    for (const key of Array.from(expandedNodes)) {
        if (!entries[key]) {
            expandedNodes.delete(key);
        }
    }
}

// ── Filtering ──────────────────────────────────────────────────────────

function passesImportanceFilter(entry, minImportance) {
    return (entry?.importance ?? 0) >= minImportance;
}

function passesRelationFilter(edge, relationFilters) {
    return relationFilters[edge.relation] !== false;
}

function filteredGraph(entries, edges) {
    const minImportance = Number(graphSettings?.minImportance) || 0;
    const relationFilters = graphSettings?.relationFilters || {};

    const visibleEntries = {};

    for (const [key, entry] of Object.entries(entries || {})) {
        if (!passesImportanceFilter(entry, minImportance)) continue;

        visibleEntries[key] = entry;
    }

    const visibleEdges = (edges || []).filter((edge) => {
        return (
            isUsableEdge(edge, visibleEntries) &&
            passesRelationFilter(edge, relationFilters)
        );
    });

    return {
        entries: visibleEntries,
        edges: visibleEdges,
    };
}

// ── Graph Render Orchestration ─────────────────────────────────────────

function renderEmptyGraph() {
    nodePositions = {};
    renderEdges([], {}, {});
}

function renderGraphNodes(entries, positions) {
    for (const [key, entry] of Object.entries(entries)) {
        const position = positions[key];

        if (!position) continue;

        scene.appendChild(buildNodeEl(key, entry, position));
    }
}

function restoreSelectionIfPossible(previousSelected, entries) {
    if (previousSelected && entries[previousSelected]) {
        openDetail(previousSelected, entries[previousSelected]);
    } else {
        applyFocusState();
    }
}

function renderGraph(rawEntries, rawEdges, options = {}) {
    const { entries, edges } = filteredGraph(rawEntries, rawEdges);

    const previousSelected = options.preserveSelection ? selectedKey : null;
    const previousPositions = options.preservePositions ? nodePositions : {};

    removeRenderedNodes();
    resetGraphUiState();

    const keys = getEntryKeys(entries);

    pruneExpandedNodes(entries);

    emptyState.classList.toggle('visible', keys.length === 0);

    updateLegend();
    renderIdentityPanel();

    if (!keys.length) {
        renderEmptyGraph();
        return;
    }

    const computedPositions = computeLayout(entries, edges);

    const positions = options.preservePositions
        ? mergePreservedPositions(computedPositions, previousPositions)
        : computedPositions;

    nodePositions = positions;

    sizeSceneToPositions(positions);
    renderEdges(edges, positions, entries);
    renderGraphNodes(entries, positions);

    if (options.fit !== false) {
        fitView(positions);
    } else {
        applyTransform();
    }

    restoreSelectionIfPossible(previousSelected, entries);
}
