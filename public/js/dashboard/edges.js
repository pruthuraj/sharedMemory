'use strict';

// ── Edge rendering ─────────────────────────────────────────────────────
function renderEdges(edges, positions, entries) {
    while (edgesSvg.firstChild) edgesSvg.removeChild(edgesSvg.firstChild);

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
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', sw);
        path.setAttribute('stroke-opacity', '0.6');
        path.setAttribute('marker-end', `url(#arr-${edge.relation})`);
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
