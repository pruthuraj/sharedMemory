'use strict';

// ── Layout Constants ───────────────────────────────────────────────────

const DEFAULT_LAYOUT_MODE = 'force';
const SCENE_PADDING = 60;
const NODE_CARD_W = 168;
const NODE_CARD_H = 78;

// ── Relation Color ─────────────────────────────────────────────────────

function getRelationColor(relation) {
    return (
        relationColors?.[relation] ||
        relationColors?.related_to ||
        '#6366f1'
    );
}

// ── Node Card Dimensions ───────────────────────────────────────────────

function cardScale() { return Number(graphSettings?.nodeScale) || 1; }
function cardW() { return NODE_CARD_W * cardScale(); }
function cardH() { return NODE_CARD_H * cardScale(); }

// ── Node SVG Card ──────────────────────────────────────────────────────

function buildNodeSvg(key) {
    const entry = currentEntries?.[key] || {};
    const color = nodeIdentityColor(key);
    const importance = Math.max(0, Math.min(10, Number(entry.importance) || 0));
    const summary = entry.summary || '';

    const dotIdx = key.indexOf('.');
    const ns = dotIdx >= 0 ? key.slice(0, dotIdx) : '';
    const subkey = dotIdx >= 0 ? key.slice(dotIdx + 1) : key;

    const W = NODE_CARD_W, H = NODE_CARD_H;
    const trunc = (s, max) => s.length > max ? s.slice(0, max - 1) + '…' : s;
    const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const nsText = ns ? trunc(ns, 20) : '';
    const subkeyText = trunc(subkey, 17);
    const summaryText = summary ? trunc(summary, 32) : '';

    const subkeyY = nsText ? 36 : 30;
    const summaryY = nsText ? 53 : 47;

    const impDots = importance > 0
        ? Array.from({ length: 5 }, (_, i) => {
              const filled = i < Math.round(importance / 2);
              return `<circle cx="${W - 38 + i * 8}" cy="${H - 9}" r="2.8" fill="${filled ? color + 'cc' : '#1e2235'}"/>`;
          }).join('')
        : '';

    const lines = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`,
        `<rect width="${W}" height="${H}" rx="8" fill="#0d0d1a"/>`,
        `<rect width="4" height="${H}" rx="2" fill="${x(color)}"/>`,
        nsText ? `<text x="12" y="16" font-family="system-ui,sans-serif" font-size="10" fill="#64748b">${x(nsText)}</text>` : '',
        `<text x="12" y="${subkeyY}" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="#f1f5f9" letter-spacing="0.3">${x(subkeyText)}</text>`,
        summaryText ? `<text x="12" y="${summaryY}" font-family="system-ui,sans-serif" font-size="10" fill="#4b5a6f">${x(summaryText)}</text>` : '',
        impDots,
        '</svg>',
    ];

    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(lines.join(''));
}

// ── Cytoscape Style ────────────────────────────────────────────────────

function buildCyStyle() {
    return [
        {
            selector: 'node',
            style: {
                'shape': 'round-rectangle',
                'corner-radius': 8,
                'width': () => cardW(),
                'height': () => cardH(),
                'background-color': '#0d0d1a',
                'background-image': (node) => buildNodeSvg(node.id()),
                'background-fit': 'cover',
                'background-clip': 'node',
                'label': '',
                'border-width': 1.5,
                'border-color': (node) => `${nodeIdentityColor(node.id())}44`,
                'shadow-blur': 0,
                'shadow-opacity': 0,
                'shadow-offset-x': 0,
                'shadow-offset-y': 0,
                'transition-property': 'width height border-color border-width shadow-blur shadow-opacity opacity',
                'transition-duration': '140ms',
                'transition-timing-function': 'ease-out',
            },
        },
        {
            selector: 'node.selected',
            style: {
                'border-width': 2.5,
                'border-color': (node) => nodeIdentityColor(node.id()),
                'shadow-blur': 20,
                'shadow-color': (node) => nodeIdentityColor(node.id()),
                'shadow-opacity': 0.55,
                'shadow-offset-x': 0,
                'shadow-offset-y': 0,
            },
        },
        {
            selector: 'node.hover-main',
            style: {
                'width': () => cardW() * 1.12,
                'height': () => cardH() * 1.12,
                'border-width': 2,
                'border-color': (node) => nodeIdentityColor(node.id()),
                'shadow-blur': 24,
                'shadow-color': (node) => nodeIdentityColor(node.id()),
                'shadow-opacity': 0.65,
                'shadow-offset-x': 0,
                'shadow-offset-y': 0,
                'z-index': 10,
            },
        },
        {
            selector: 'node.related',
            style: {
                'border-color': (node) => `${nodeIdentityColor(node.id())}99`,
                'border-width': 1.5,
                'shadow-blur': 6,
                'shadow-color': (node) => nodeIdentityColor(node.id()),
                'shadow-opacity': 0.2,
                'shadow-offset-x': 0,
                'shadow-offset-y': 0,
            },
        },
        {
            selector: 'node.dimmed',
            style: {
                'opacity': () => dimmedNodeOpacity(),
                'shadow-blur': 0,
                'shadow-opacity': 0,
            },
        },
        {
            selector: 'node.updating',
            style: {
                'border-color': '#10b981',
                'border-width': 2.5,
                'shadow-blur': 14,
                'shadow-color': '#10b981',
                'shadow-opacity': 0.6,
            },
        },
        {
            selector: 'edge',
            style: {
                'line-color': (edge) => getRelationColor(edge.data('relation')),
                'target-arrow-color': (edge) => getRelationColor(edge.data('relation')),
                'target-arrow-shape': 'triangle',
                'curve-style': 'bezier',
                'width': (edge) => {
                    const weight = Number(edge.data('weight')) || 0;
                    const scale = Number(graphSettings?.edgeThickness) || 1;
                    return (1.5 + weight * 2.5) * scale;
                },
                'opacity': 0.5,
                'label': (edge) => {
                    const mode = graphSettings?.edgeLabelMode;
                    if (mode === 'off' || mode === 'none') return '';
                    return String(edge.data('relation') || 'related_to').replace(/_/g, ' ');
                },
                'font-size': 10,
                'color': (edge) => getRelationColor(edge.data('relation')),
                'text-background-color': '#05050e',
                'text-background-opacity': (edge) => {
                    const mode = graphSettings?.edgeLabelMode;
                    if (mode === 'off' || mode === 'none') return 0;
                    if (mode === 'always') return 0.9;
                    return 0;
                },
                'text-background-padding': '3px',
                'font-family': 'system-ui, sans-serif',
                'font-weight': 700,
                'transition-property': 'opacity width',
                'transition-duration': '140ms',
                'transition-timing-function': 'ease-out',
            },
        },
        {
            selector: 'edge.dimmed',
            style: {
                'opacity': () => dimmedEdgeOpacity(),
            },
        },
        {
            selector: 'edge.highlight',
            style: {
                'opacity': 0.95,
                'width': (edge) => {
                    const weight = Number(edge.data('weight')) || 0;
                    const scale = Number(graphSettings?.edgeThickness) || 1;
                    return (1.5 + weight * 2.5) * scale * 1.6;
                },
                'text-background-opacity': (edge) => {
                    const mode = graphSettings?.edgeLabelMode;
                    if (mode === 'off' || mode === 'none') return 0;
                    return 0.9;
                },
            },
        },
    ];
}

// ── Cytoscape Initialization ───────────────────────────────────────────

function initCytoscape() {
    const container = document.getElementById('cy');

    if (!container) {
        console.warn('Missing #cy container');
        return;
    }

    if (typeof cytoscape === 'undefined') {
        console.warn('Cytoscape not loaded');
        return;
    }

    if (typeof cytoscapeDagre !== 'undefined') {
        cytoscape.use(cytoscapeDagre);
    }

    cy = cytoscape({
        container,
        elements: [],
        style: buildCyStyle(),
        userZoomingEnabled: true,
        userPanningEnabled: true,
        boxSelectionEnabled: false,
        minZoom: 0.05,
        maxZoom: 4,
    });

    cy.on('tap', 'node', (event) => {
        const key = event.target.id();
        const entry = currentEntries[key];

        hideNodeTooltip();

        if (entry) openDetail(key, entry);
    });

    cy.on('tap', (event) => {
        if (event.target === cy) {
            closeActiveDetail();
            hideNodeTooltip();
        }
    });

    cy.on('mouseover', 'node', (event) => {
        const key = event.target.id();
        const entry = currentEntries[key];

        hoverKey = key;
        focusedKey = key;
        lastFocusedKey = key;

        updatePeekStrip(key);
        applyFocusState();

        if (entry) {
            const pos = event.renderedPosition || event.position;
            showNodeTooltip(key, entry, pos.x, pos.y);
        }
    });

    cy.on('mouseout', 'node', () => {
        hoverKey = null;
        focusedKey = selectedKey;

        updatePeekStrip(selectedKey);
        applyFocusState();
        hideNodeTooltip();
    });

    cy.on('mousemove', (event) => {
        if (!hoverKey) return;

        const pos = event.renderedPosition || event.position;
        moveNodeTooltip(pos.x, pos.y);
    });
}

// ── Layout ─────────────────────────────────────────────────────────────

function getLayoutMode() {
    const mode = graphSettings?.layoutMode || DEFAULT_LAYOUT_MODE;
    return mode === 'radial' ? 'force' : mode;
}

function runCyLayout() {
    if (!cy) return;

    const mode = getLayoutMode();
    let config;

    if (mode === 'hierarchical') {
        config = {
            name: 'dagre',
            rankDir: 'LR',
            nodeSep: 24,
            rankSep: 120,
            animate: false,
            padding: SCENE_PADDING,
        };
    } else {
        config = {
            name: 'cose',
            animate: false,
            randomize: true,
            componentSpacing: 80,
            nodeRepulsion: () => 9000,
            idealEdgeLength: () => 200,
            gravity: 1,
            padding: SCENE_PADDING,
            numIter: 1000,
        };
    }

    cy.layout(config).run();
}

// ── Filtering ──────────────────────────────────────────────────────────

function filteredGraph(entries, edges) {
    const minImportance = Number(graphSettings?.minImportance) || 0;
    const relationFilters = graphSettings?.relationFilters || {};

    const visibleEntries = {};

    for (const [key, entry] of Object.entries(entries || {})) {
        if ((entry?.importance ?? 0) < minImportance) continue;

        visibleEntries[key] = entry;
    }

    const visibleEdges = (edges || []).filter((edge) => {
        if (!edge?.from || !edge?.to) return false;
        if (!visibleEntries[edge.from] || !visibleEntries[edge.to]) return false;

        return relationFilters[edge.relation] !== false;
    });

    return { entries: visibleEntries, edges: visibleEdges };
}

// ── Element Building ───────────────────────────────────────────────────

function buildCyElements(entries, edges) {
    const elements = [];

    for (const [key, entry] of Object.entries(entries)) {
        elements.push({
            group: 'nodes',
            data: {
                id: key,
                importance: entry.importance || 0,
            },
        });
    }

    const seenEdges = new Set();

    for (const edge of edges) {
        const id = edgeKey(edge);

        if (seenEdges.has(id)) continue;
        seenEdges.add(id);

        elements.push({
            group: 'edges',
            data: {
                id,
                source: edge.from,
                target: edge.to,
                relation: edge.relation || 'related_to',
                weight: Number(edge.weight) || 0,
                reason: edge.reason || '',
            },
        });
    }

    return elements;
}

// ── Graph UI State ─────────────────────────────────────────────────────

function resetGraphUiState() {
    selectedKey = null;
    focusedKey = null;
    lastFocusedKey = null;
    hoverKey = null;

    detailPanel.classList.remove('visible');
    document.body.classList.remove('inspector-open');
}

// ── Graph Render ───────────────────────────────────────────────────────

function renderGraph(rawEntries, rawEdges, options = {}) {
    const { entries, edges } = filteredGraph(rawEntries, rawEdges);
    const keys = Object.keys(entries);

    emptyState.classList.toggle('visible', keys.length === 0);
    updateLegend();
    renderIdentityPanel();

    if (!cy) initCytoscape();
    if (!cy) return;

    const previousSelected = options.preserveSelection ? selectedKey : null;

    if (!options.preserveSelection) {
        resetGraphUiState();
    }

    // Save positions before rebuild so preservePositions works
    const savedPositions = {};
    if (options.preservePositions) {
        cy.nodes().forEach((node) => {
            savedPositions[node.id()] = { ...node.position() };
        });
    }

    cy.elements().remove();
    cy.add(buildCyElements(entries, edges));

    if (options.preservePositions && Object.keys(savedPositions).length > 0) {
        cy.nodes().forEach((node) => {
            const pos = savedPositions[node.id()];
            if (pos) node.position(pos);
        });
        cy.style().update();
    } else {
        runCyLayout();

        if (options.fit !== false) {
            cy.fit(undefined, SCENE_PADDING);
        }
    }

    if (previousSelected && entries[previousSelected]) {
        openDetail(previousSelected, entries[previousSelected]);
    } else {
        applyFocusState();
    }
}
