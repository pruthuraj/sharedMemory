'use strict';

// ── Edge Rendering Constants ───────────────────────────────────────────

const EDGE_DEFAULT_COLOR = '#6366f1';
const EDGE_LABEL_MIN_WIDTH = 72;
const EDGE_LABEL_CHAR_WIDTH = 6;
const EDGE_LABEL_HORIZONTAL_PADDING = 18;
const EDGE_LABEL_HEIGHT = 18;
const EDGE_LABEL_RADIUS = 5;

const EDGE_MIN_BEND = 18;
const EDGE_MAX_BEND = 80;
const EDGE_BEND_FACTOR = 0.09;

// ── SVG Helpers ────────────────────────────────────────────────────────

function clearEdgesSvg() {
    for (const group of edgesSvg.querySelectorAll('.edge-group')) {
        group.remove();
    }
}

function setSvgAttrs(el, attrs) {
    for (const [key, value] of Object.entries(attrs)) {
        el.setAttribute(key, String(value));
    }

    return el;
}

// ── Marker Rendering ───────────────────────────────────────────────────

function getMarkerId(relation) {
    return `arr-${relation}`;
}

function createArrowMarker(relation, color) {
    const marker = svgEl('marker');

    setSvgAttrs(marker, {
        id: getMarkerId(relation),
        markerWidth: 8,
        markerHeight: 6,
        refX: 7,
        refY: 3,
        orient: 'auto',
    });

    const polygon = svgEl('polygon');

    setSvgAttrs(polygon, {
        points: '0 0, 8 3, 0 6',
        fill: color,
        opacity: 0.75,
    });

    marker.appendChild(polygon);

    return marker;
}

function markerColorEntries(edges = []) {
    const colors = new Map(Object.entries(relationColors || {}));

    for (const edge of edges) {
        const relation = edge?.relation || 'related_to';

        if (!colors.has(relation)) {
            colors.set(relation, getRelationColor(relation));
        }
    }

    return colors;
}

function ensureMarkerDefs() {
    let defs = edgesSvg.querySelector('#edge-marker-defs');

    if (!defs) {
        defs = svgEl('defs');
        defs.id = 'edge-marker-defs';
        edgesSvg.prepend(defs);
    }

    while (defs.firstChild) {
        defs.removeChild(defs.firstChild);
    }

    return defs;
}

function renderArrowMarkers(edges = []) {
    const defs = ensureMarkerDefs();

    for (const [relation, color] of markerColorEntries(edges)) {
        defs.appendChild(createArrowMarker(relation, color));
    }
}

// ── Edge Data Helpers ──────────────────────────────────────────────────

function getRelationColor(relation) {
    return (
        relationColors?.[relation] ||
        relationColors?.related_to ||
        EDGE_DEFAULT_COLOR
    );
}

function getEdgeStrokeWidth(edge) {
    const edgeScale = Number(graphSettings?.edgeThickness) || 1;
    const weight = Number(edge?.weight) || 0;

    return ((1.5 + weight * 2.5) * edgeScale).toFixed(2);
}

function getEdgeLabel(edge) {
    return String(edge?.relation || 'related_to').replace(/_/g, ' ');
}

function isRenderableEdge(edge, positions, entries) {
    return Boolean(
        edge &&
        edge.from &&
        edge.to &&
        positions?.[edge.from] &&
        positions?.[edge.to] &&
        entries?.[edge.from] &&
        entries?.[edge.to]
    );
}

// ── Edge Geometry ──────────────────────────────────────────────────────

function getEdgeBoxes(edge, positions, entries) {
    const sourceSlot = positions[edge.from];
    const targetSlot = positions[edge.to];

    return {
        sourceBox: nodeVisualBox(edge.from, sourceSlot, entries[edge.from]),
        targetBox: nodeVisualBox(edge.to, targetSlot, entries[edge.to]),
    };
}

function getEdgeAnchors(edge, sourceBox, targetBox) {
    const sourceCenter = nodeCenter(sourceBox);
    const targetCenter = nodeCenter(targetBox);

    return {
        sourceAnchor: edgeAnchor(
            sourceBox,
            targetCenter,
            !expandedNodes.has(edge.from)
        ),
        targetAnchor: edgeAnchor(
            targetBox,
            sourceCenter,
            !expandedNodes.has(edge.to)
        ),
    };
}

function getBendDirection(edge) {
    return stableHash(edgeKey(edge)) % 2 === 0 ? 1 : -1;
}

function calculateEdgeGeometry(edge, positions, entries) {
    const { sourceBox, targetBox } = getEdgeBoxes(edge, positions, entries);
    const { sourceAnchor, targetAnchor } = getEdgeAnchors(edge, sourceBox, targetBox);

    const sx = sourceAnchor.x;
    const sy = sourceAnchor.y;
    const tx = targetAnchor.x;
    const ty = targetAnchor.y;

    const dx = tx - sx;
    const dy = ty - sy;
    const span = Math.hypot(dx, dy) || 1;

    const normalX = -dy / span;
    const normalY = dx / span;

    const bend = getBendDirection(edge) * Math.min(
        EDGE_MAX_BEND,
        Math.max(EDGE_MIN_BEND, span * EDGE_BEND_FACTOR)
    );

    const cx = (sx + tx) / 2 + normalX * bend;
    const cy = (sy + ty) / 2 + normalY * bend;

    return {
        sx,
        sy,
        tx,
        ty,
        cx,
        cy,
        path: `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`,
        labelX: 0.25 * sx + 0.5 * cx + 0.25 * tx,
        labelY: 0.25 * sy + 0.5 * cy + 0.25 * ty,
    };
}

// ── Edge Element Builders ──────────────────────────────────────────────

function createEdgeGroup(edge) {
    const group = svgEl('g');

    group.classList.add('edge-group');
    group.dataset.from = edge.from;
    group.dataset.to = edge.to;
    group.dataset.relation = edge.relation || 'related_to';

    return group;
}

function appendEdgeTooltip(group, edge) {
    const title = svgEl('title');
    const label = getEdgeLabel(edge);
    const reason = edge?.reason ? ` - ${edge.reason}` : '';

    title.textContent = `${edge.from} ${label} ${edge.to}${reason}`;
    group.appendChild(title);
}

function createEdgePath(edge, geometry, color) {
    const path = svgEl('path');

    setSvgAttrs(path, {
        d: geometry.path,
        fill: 'none',
        stroke: color,
        'stroke-width': getEdgeStrokeWidth(edge),
        'stroke-opacity': 0.6,
        'marker-end': `url(#${getMarkerId(edge.relation || 'related_to')})`,
    });

    return path;
}

function getEdgeLabelWidth(labelText) {
    return Math.max(
        EDGE_LABEL_MIN_WIDTH,
        labelText.length * EDGE_LABEL_CHAR_WIDTH + EDGE_LABEL_HORIZONTAL_PADDING
    );
}

function createEdgeLabelBackground(x, y, width) {
    const rect = svgEl('rect');

    rect.classList.add('edge-label-bg');

    setSvgAttrs(rect, {
        x: x - width / 2,
        y: y - 10,
        width,
        height: EDGE_LABEL_HEIGHT,
        rx: EDGE_LABEL_RADIUS,
        fill: '#05050e',
        opacity: 0.94,
    });

    return rect;
}

function createEdgeLabelText(x, y, labelText, color) {
    const text = svgEl('text');

    text.classList.add('edge-label-text');

    setSvgAttrs(text, {
        x,
        y: y + 1,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        'font-size': 10,
        fill: color,
        'font-family': 'system-ui, sans-serif',
        'font-weight': 700,
        opacity: 0.9,
    });

    text.textContent = labelText;

    return text;
}

function appendEdgeLabel(group, edge, geometry, color) {
    const mode = graphSettings?.edgeLabelMode;

    if (mode === 'off' || mode === 'none' || mode === false) {
        return;
    }

    const labelText = getEdgeLabel(edge);
    const labelWidth = getEdgeLabelWidth(labelText);

    group.appendChild(
        createEdgeLabelBackground(geometry.labelX, geometry.labelY, labelWidth)
    );

    group.appendChild(
        createEdgeLabelText(geometry.labelX, geometry.labelY, labelText, color)
    );
}

function createEdgeElement(edge, positions, entries) {
    const color = getRelationColor(edge.relation);
    const geometry = calculateEdgeGeometry(edge, positions, entries);
    const group = createEdgeGroup(edge);

    appendEdgeTooltip(group, edge);
    group.appendChild(createEdgePath(edge, geometry, color));
    appendEdgeLabel(group, edge, geometry, color);

    return group;
}

// ── Public Renderer ────────────────────────────────────────────────────

function renderEdges(edges, positions, entries) {
    clearEdgesSvg();
    renderArrowMarkers(edges);

    for (const edge of edges || []) {
        if (!isRenderableEdge(edge, positions, entries)) continue;

        edgesSvg.appendChild(
            createEdgeElement(edge, positions, entries)
        );
    }
}
