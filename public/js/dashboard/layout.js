'use strict';

// Graph layout engines: hierarchical, radial, force-directed, and position normalization.

function computeLayout(entries, edges) {
    const mode = (graphSettings && graphSettings.layoutMode) || 'radial';
    if (mode === 'force') return computeForceLayout(entries, edges);
    if (mode === 'radial') return computeRadialLayout(entries, edges);
    return computeHierarchicalLayout(entries, edges);
}

function computeHierarchicalLayout(entries, edges) {
    // If dagre is unavailable, fallback to radial layout to avoid throwing.
    if (typeof dagre === 'undefined' || !dagre || !dagre.layout) return computeRadialLayout(entries, edges);
    const g = new dagre.graphlib.Graph({ multigraph: true, compound: true });
    const gapMultiplier = (graphSettings && Number(graphSettings.radialGapMultiplier)) || 1;
    const baseRankSep = Math.round(90 * gapMultiplier);
    const baseNodeSep = Math.round(20 * gapMultiplier);
    const baseMargin = Math.round(60 * gapMultiplier);
    g.setGraph({ rankdir: 'LR', ranksep: baseRankSep, nodesep: baseNodeSep, marginx: baseMargin, marginy: baseMargin });
    g.setDefaultEdgeLabel(() => ({}));

    const clusters = new Set();
    for (const [key, entry] of Object.entries(entries)) {
        g.setNode(key, { width: NODE_W, height: nodeHeight(entry) });
        const ns = String(key).split('.')[0] || 'misc';
        const clusterId = `__ns__${ns}`;
        if (!clusters.has(clusterId)) {
            g.setNode(clusterId, {});
            clusters.add(clusterId);
        }
        g.setParent(key, clusterId);
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
        if (key.startsWith('__ns__')) continue;
        const n = g.node(key);
        if (n) positions[key] = { x: n.x - n.width / 2, y: n.y - n.height / 2, w: n.width, h: n.height };
    }
    return positions;
}

function computeRadialLayout(entries, edges) {
    // Each namespace gets an angular sector around the origin. Within a sector,
    // higher-importance nodes sit closer to the centre.
    const keys = Object.keys(entries);
    const clusters = new Map();
    for (const key of keys) {
        const ns = String(key).split('.')[0] || 'misc';
        if (!clusters.has(ns)) clusters.set(ns, []);
        clusters.get(ns).push(key);
    }
    const nsList = Array.from(clusters.keys()).sort();
    const sectorCount = nsList.length;
    const baseRadius = 220;
    const radiusStep = 90;
    const positions = {};

    nsList.forEach((ns, sectorIdx) => {
        const items = clusters.get(ns).slice().sort((a, b) => {
            const ia = entries[a].importance || 0;
            const ib = entries[b].importance || 0;
            return ib - ia;
        });
        const sectorAngle = (sectorIdx / sectorCount) * Math.PI * 2;
        const sectorWidth = (Math.PI * 2) / sectorCount;
        items.forEach((key, idx) => {
            const entry = entries[key];
            const importance = Number(entry.importance) || 0;
            const ring = Math.floor(idx / Math.max(1, Math.ceil(Math.sqrt(items.length))));
            const radius = baseRadius + ring * radiusStep + (10 - importance) * 6;
            const angleJitter = ((idx % Math.max(1, Math.ceil(Math.sqrt(items.length)))) / Math.max(1, items.length)) * sectorWidth;
            const angle = sectorAngle + angleJitter * 0.9 + sectorWidth * 0.05;
            const cx = Math.cos(angle) * radius;
            const cy = Math.sin(angle) * radius;
            const w = NODE_W;
            const h = nodeHeight(entry);
            positions[key] = { x: cx - w / 2, y: cy - h / 2, w, h };
        });
    });

    return shiftPositionsToPositive(positions);
}

function computeForceLayout(entries, edges) {
    const keys = Object.keys(entries);
    const n = keys.length;
    if (!n) return {};

    // Deterministic seed from a circle so the simulation starts from a reproducible state.
    const ns = keys.map((k) => String(k).split('.')[0] || 'misc');
    const nsList = Array.from(new Set(ns));
    const nsCenters = {};
    nsList.forEach((name, i) => {
        const a = (i / nsList.length) * Math.PI * 2;
        nsCenters[name] = { x: Math.cos(a) * 280, y: Math.sin(a) * 280 };
    });

    const nodes = keys.map((k, i) => {
        const a = (i / n) * Math.PI * 2;
        return {
            id: k,
            namespace: ns[i],
            x: Math.cos(a) * 320 + (stableHash(k) % 40 - 20),
            y: Math.sin(a) * 320 + (stableHash(k + 'y') % 40 - 20),
        };
    });

    const links = [];
    const idSet = new Set(keys);
    for (const e of edges) {
        if (!idSet.has(e.from) || !idSet.has(e.to)) continue;
        links.push({ source: e.from, target: e.to });
    }

    // Custom force pulling each node toward its namespace centroid (replaces the
    // CLUSTER_PULL term in the old custom simulation).
    function clusterForce(strength) {
        let cachedNodes;
        function force(alpha) {
            for (const node of cachedNodes) {
                const c = nsCenters[node.namespace];
                if (!c) continue;
                node.vx = (node.vx || 0) + (c.x - node.x) * strength * alpha;
                node.vy = (node.vy || 0) + (c.y - node.y) * strength * alpha;
            }
        }
        force.initialize = (n) => { cachedNodes = n; };
        return force;
    }

    if (typeof window === 'undefined' || !window.d3 || !window.d3.forceSimulation) {
        // Fallback: skip force pass and use seeded positions if d3 failed to load.
        const positions = {};
        for (const node of nodes) {
            const entry = entries[node.id];
            positions[node.id] = { x: node.x - NODE_W / 2, y: node.y - nodeHeight(entry) / 2, w: NODE_W, h: nodeHeight(entry) };
        }
        return shiftPositionsToPositive(positions);
    }

    const d3 = window.d3;
    const sim = d3.forceSimulation(nodes)
        .force('charge', d3.forceManyBody().strength(-450).distanceMax(900))
        .force('link', d3.forceLink(links).id((d) => d.id).distance(140).strength(0.5))
        .force('cluster', clusterForce(0.18))
        .force('center', d3.forceCenter(0, 0))
        .force('collide', d3.forceCollide(70))
        .stop();

    // Run synchronously but reduce ticks to avoid blocking UI. Scale ticks with node count.
    const ITERS = Math.min(200, Math.max(30, 30 + Math.floor(n * 2)));
    for (let i = 0; i < ITERS; i++) sim.tick();

    const positions = {};
    for (const node of nodes) {
        const entry = entries[node.id];
        const w = NODE_W;
        const h = nodeHeight(entry);
        positions[node.id] = { x: node.x - w / 2, y: node.y - h / 2, w, h };
    }
    return shiftPositionsToPositive(positions);
}

function shiftPositionsToPositive(positions) {
    let minX = Infinity, minY = Infinity;
    for (const p of Object.values(positions)) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
    }
    const PAD = 80;
    const dx = -minX + PAD;
    const dy = -minY + PAD;
    for (const p of Object.values(positions)) {
        p.x += dx;
        p.y += dy;
    }
    return positions;
}

