'use strict';

// SVG edge rendering, label placement, scene sizing, and edge rerender scheduling.

function renderEdges(edges, positions, entries) {
    while (edgesSvg.firstChild) edgesSvg.removeChild(edgesSvg.firstChild);

    // Cluster hulls — one translucent region per namespace, drawn first so they sit beneath edges and nodes.
    const HULL_PAD = 28;
    const clusterBoxes = {};
    for (const [key, pos] of Object.entries(positions)) {
        if (!entries[key]) continue;
        const ns = String(key).split('.')[0] || 'misc';
        const box = nodeVisualBox(key, pos, entries[key]);
        const cur = clusterBoxes[ns];
        if (!cur) {
            clusterBoxes[ns] = { minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + box.h, count: 1 };
        } else {
            cur.minX = Math.min(cur.minX, box.x);
            cur.minY = Math.min(cur.minY, box.y);
            cur.maxX = Math.max(cur.maxX, box.x + box.w);
            cur.maxY = Math.max(cur.maxY, box.y + box.h);
            cur.count += 1;
        }
    }
    for (const [ns, b] of Object.entries(clusterBoxes)) {
        if (b.count < 2) continue;
        const hue = stableHash(ns) % 360;
        const rect = svgEl('rect');
        rect.setAttribute('x', String(b.minX - HULL_PAD));
        rect.setAttribute('y', String(b.minY - HULL_PAD));
        rect.setAttribute('width', String(b.maxX - b.minX + HULL_PAD * 2));
        rect.setAttribute('height', String(b.maxY - b.minY + HULL_PAD * 2));
        rect.setAttribute('rx', '18');
        rect.setAttribute('ry', '18');
        rect.setAttribute('fill', `hsla(${hue}, 80%, 55%, 0.07)`);
        rect.setAttribute('stroke', `hsla(${hue}, 80%, 60%, 0.32)`);
        rect.setAttribute('stroke-width', '1');
        rect.setAttribute('stroke-dasharray', '4 4');
        rect.setAttribute('pointer-events', 'none');
        edgesSvg.appendChild(rect);

        const label = svgEl('text');
        label.setAttribute('x', String(b.minX - HULL_PAD + 12));
        label.setAttribute('y', String(b.minY - HULL_PAD + 18));
        label.setAttribute('fill', `hsla(${hue}, 90%, 70%, 0.65)`);
        label.setAttribute('font-size', '11');
        label.setAttribute('font-family', 'system-ui, sans-serif');
        label.setAttribute('font-weight', '600');
        label.setAttribute('letter-spacing', '0.5');
        label.setAttribute('pointer-events', 'none');
        label.textContent = ns.toUpperCase();
        edgesSvg.appendChild(label);
    }

    // Arrow markers
    const defs = svgEl('defs');
    for (const [rel, color] of Object.entries(relationColors)) {
        const m = svgEl('marker');
        m.setAttribute('id', `arr-${rel}`);
        m.setAttribute('markerWidth', '8');
        m.setAttribute('markerHeight', '6');
        m.setAttribute('refX', '7');
        m.setAttribute('refY', '3');
        m.setAttribute('orient', 'auto');
        const poly = svgEl('polygon');
        poly.setAttribute('points', '0 0, 8 3, 0 6');
        poly.setAttribute('fill', color);
        poly.setAttribute('opacity', '0.75');
        m.appendChild(poly);
        defs.appendChild(m);
    }
    edgesSvg.appendChild(defs);

    for (const edge of edges) {
        const sourceSlot = positions[edge.from];
        const targetSlot = positions[edge.to];
        if (!sourceSlot || !targetSlot) continue;

        const sp = nodeVisualBox(edge.from, sourceSlot, entries[edge.from]);
        const tp = nodeVisualBox(edge.to, targetSlot, entries[edge.to]);

        const color = relationColors[edge.relation] || relationColors.related_to || '#6366f1';
        const edgeScale = Number(graphSettings.edgeThickness) || 1;
        const sw = ((1.5 + (edge.weight || 0) * 2.5) * edgeScale).toFixed(2);

        const sourceCenter = nodeCenter(sp);
        const targetCenter = nodeCenter(tp);
        const sourceAnchor = edgeAnchor(sp, targetCenter, !expandedNodes.has(edge.from));
        const targetAnchor = edgeAnchor(tp, sourceCenter, !expandedNodes.has(edge.to));
        const sx = sourceAnchor.x;
        const sy = sourceAnchor.y;
        const tx = targetAnchor.x;
        const ty = targetAnchor.y;
        const edgeDx = tx - sx;
        const edgeDy = ty - sy;
        const span = Math.hypot(edgeDx, edgeDy) || 1;
        const normalX = -edgeDy / span;
        const normalY = edgeDx / span;
        const bendDirection = stableHash(edgeKey(edge)) % 2 === 0 ? 1 : -1;
        const bend = bendDirection * Math.min(80, Math.max(18, span * 0.09));
        const cx = (sx + tx) / 2 + normalX * bend;
        const cy = (sy + ty) / 2 + normalY * bend;
        const d = `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;

        const g = svgEl('g');
        g.classList.add('edge-group');
        g.dataset.from = edge.from;
        g.dataset.to = edge.to;
        g.dataset.relation = edge.relation;

        const path = svgEl('path');
        path.classList.add('edge-path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', sw);
        path.setAttribute('stroke-opacity', '0.6');
        path.setAttribute('marker-end', `url(#arr-${edge.relation})`);
        path.setAttribute('data-from-key', edge.from);
        path.setAttribute('data-to-key', edge.to);
        path.setAttribute('data-relation', edge.relation);
        g.appendChild(path);

        const mx = 0.25 * sx + 0.5 * cx + 0.25 * tx;
        const my = 0.25 * sy + 0.5 * cy + 0.25 * ty;

        const labelText = edge.relation.replace(/_/g, ' ');
        const labelWidth = Math.max(72, labelText.length * 6 + 18);

        const bg = svgEl('rect');
        bg.classList.add('edge-label-bg');
        bg.setAttribute('x', String(mx - labelWidth / 2));
        bg.setAttribute('y', String(my - 10));
        bg.setAttribute('width', String(labelWidth));
        bg.setAttribute('height', '18');
        bg.setAttribute('rx', '5');
        bg.setAttribute('fill', '#05050e');
        bg.setAttribute('opacity', '0.94');
        g.appendChild(bg);

        const lbl = svgEl('text');
        lbl.classList.add('edge-label-text');
        lbl.setAttribute('x', String(mx));
        lbl.setAttribute('y', String(my + 1));
        lbl.setAttribute('text-anchor', 'middle');
        lbl.setAttribute('dominant-baseline', 'middle');
        lbl.setAttribute('font-size', '10');
        lbl.setAttribute('fill', color);
        lbl.setAttribute('font-family', 'system-ui, sans-serif');
        lbl.setAttribute('font-weight', '700');
        lbl.setAttribute('opacity', '0.9');
        lbl.textContent = labelText;
        g.appendChild(lbl);

        edgesSvg.appendChild(g);
    }
}

// ── Graph render ───────────────────────────────────────────────────────
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

// RAF-batched replacer to avoid rebuilding SVG on high-frequency events
let _pendingEdgeRerender = false;
function scheduleRerenderEdges() {
    if (_pendingEdgeRerender) return;
    _pendingEdgeRerender = true;
    requestAnimationFrame(() => {
        _pendingEdgeRerender = false;
        rerenderEdgesForCurrentPositions();
    });
}

