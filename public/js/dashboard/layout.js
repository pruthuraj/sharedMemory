'use strict';

// ── Layout Constants ───────────────────────────────────────────────────

const DEFAULT_LAYOUT_MODE = 'force';
const SCENE_PADDING = 60;
const NODE_CARD_W = 168;
const NODE_CARD_H = 78;
const COLLISION_GAP = 34;
const COLLISION_HOVER_MARGIN = 14;
const COLLISION_NUDGE = 2;
const COLLISION_MAX_ITERATIONS = 80;

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

// Layout boxes include hover growth so focus animations do not immediately cover neighbors.
function nodeLayoutSize(node) {
    const width = Number(node.width()) || cardW();
    const height = Number(node.height()) || cardH();

    return {
        width: width + COLLISION_GAP + COLLISION_HOVER_MARGIN,
        height: height + COLLISION_GAP + COLLISION_HOVER_MARGIN,
    };
}

function layoutBoxForNode(node) {
    const pos = node.position();
    const size = nodeLayoutSize(node);

    return {
        key: node.id(),
        left: pos.x - size.width / 2,
        right: pos.x + size.width / 2,
        top: pos.y - size.height / 2,
        bottom: pos.y + size.height / 2,
        width: size.width,
        height: size.height,
        x: pos.x,
        y: pos.y,
    };
}

function layoutBoxForKey(key) {
    if (!cy || !key) return null;

    const node = cy.$id(key);
    if (!node.length) return null;

    return layoutBoxForNode(node[0]);
}

function boxesOverlap(a, b) {
    return (
        a.left < b.right &&
        a.right > b.left &&
        a.top < b.bottom &&
        a.bottom > b.top
    );
}

function sortedCyNodes() {
    const nodes = [];

    cy.nodes().forEach((node) => nodes.push(node));
    nodes.sort((a, b) => a.id().localeCompare(b.id()));

    return nodes;
}

function moveNodeBy(node, dx, dy) {
    const pos = node.position();

    node.position({
        x: pos.x + dx,
        y: pos.y + dy,
    });
}

function separateOverlappingNodes(a, b, pinnedKeys) {
    const aBox = layoutBoxForNode(a);
    const bBox = layoutBoxForNode(b);

    if (!boxesOverlap(aBox, bBox)) return false;

    const aPinned = pinnedKeys.has(a.id());
    const bPinned = pinnedKeys.has(b.id());

    if (aPinned && bPinned) return false;

    const overlapX = Math.min(aBox.right, bBox.right) - Math.max(aBox.left, bBox.left);
    const overlapY = Math.min(aBox.bottom, bBox.bottom) - Math.max(aBox.top, bBox.top);

    if (overlapX <= 0 || overlapY <= 0) return false;

    const separateOnX = overlapX <= overlapY;
    const aFirst = a.id().localeCompare(b.id()) <= 0;
    const direction = separateOnX
        ? (aBox.x === bBox.x ? (aFirst ? 1 : -1) : (aBox.x < bBox.x ? 1 : -1))
        : (aBox.y === bBox.y ? (aFirst ? 1 : -1) : (aBox.y < bBox.y ? 1 : -1));
    const amount = (separateOnX ? overlapX : overlapY) + COLLISION_NUDGE;

    if (aPinned) {
        moveNodeBy(b, separateOnX ? direction * amount : 0, separateOnX ? 0 : direction * amount);
        return true;
    }

    if (bPinned) {
        moveNodeBy(a, separateOnX ? -direction * amount : 0, separateOnX ? 0 : -direction * amount);
        return true;
    }

    const half = amount / 2;
    moveNodeBy(a, separateOnX ? -direction * half : 0, separateOnX ? 0 : -direction * half);
    moveNodeBy(b, separateOnX ? direction * half : 0, separateOnX ? 0 : direction * half);

    return true;
}

function resolveNodeCollisions(options = {}) {
    if (!cy) return;

    const nodes = sortedCyNodes();
    if (nodes.length < 2) return;

    const pinnedKeys = options.pinnedKeys || new Set();

    for (let iteration = 0; iteration < COLLISION_MAX_ITERATIONS; iteration += 1) {
        let moved = false;

        for (let i = 0; i < nodes.length - 1; i += 1) {
            for (let j = i + 1; j < nodes.length; j += 1) {
                if (separateOverlappingNodes(nodes[i], nodes[j], pinnedKeys)) {
                    moved = true;
                }
            }
        }

        if (!moved) break;
    }
}

function savedPositionBounds(savedPositions) {
    const values = Object.values(savedPositions);

    if (values.length === 0) return null;

    const xs = values.map((pos) => pos.x);
    const ys = values.map((pos) => pos.y);

    return {
        left: Math.min(...xs),
        right: Math.max(...xs),
        top: Math.min(...ys),
        bottom: Math.max(...ys),
    };
}

function neighborPositionCenter(node, savedPositions) {
    const positions = [];

    node.connectedEdges().connectedNodes().forEach((neighbor) => {
        const pos = savedPositions[neighbor.id()];
        if (pos) positions.push(pos);
    });

    if (positions.length === 0) return null;

    return {
        x: positions.reduce((sum, pos) => sum + pos.x, 0) / positions.length,
        y: positions.reduce((sum, pos) => sum + pos.y, 0) / positions.length,
    };
}

function fallbackPositionForMissing(index, savedPositions) {
    const bounds = savedPositionBounds(savedPositions);

    if (!bounds) {
        const spacing = Math.max(cardW(), cardH()) + COLLISION_GAP;
        return { x: index * spacing, y: 0 };
    }

    return {
        x: bounds.right + cardW() + COLLISION_GAP,
        y: bounds.top + index * (cardH() + COLLISION_GAP),
    };
}

function placeMissingNode(node, index, savedPositions) {
    const center = neighborPositionCenter(node, savedPositions) || fallbackPositionForMissing(index, savedPositions);
    const angle = (stableHash(node.id()) % 360) * Math.PI / 180;
    const radius = Math.max(cardW(), cardH()) * 1.7 + (index % 4) * 28;

    node.position({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
    });
}

function restoreSavedPositions(savedPositions) {
    const pinnedKeys = new Set();
    const missingNodes = [];

    cy.nodes().forEach((node) => {
        const pos = savedPositions[node.id()];

        if (pos) {
            node.position(pos);
            pinnedKeys.add(node.id());
        } else {
            missingNodes.push(node);
        }
    });

    missingNodes
        .sort((a, b) => a.id().localeCompare(b.id()))
        .forEach((node, index) => placeMissingNode(node, index, savedPositions));

    resolveNodeCollisions({ pinnedKeys });
}

// ── Expand/Collapse Badge ──────────────────────────────────────────────

function getNodeExpandBadge(key) {
    if (typeof expandedNodeIds === 'undefined' || typeof visibleNodeIds === 'undefined') return null;
    if (expandedNodeIds.has(key)) return { text: '−', color: '#22c55e' };
    if (typeof getNeighborKeys === 'function') {
        for (const n of getNeighborKeys(key)) {
            if (!visibleNodeIds.has(n)) return { text: '+', color: '#f59e0b' };
        }
    }
    return null;
}

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

    const catColor = typeof getCategoryColor === 'function' ? getCategoryColor(key) : '#475569';
    const badge = typeof getNodeExpandBadge === 'function' ? getNodeExpandBadge(key) : null;

    const impDots = importance > 0
        ? Array.from({ length: 5 }, (_, i) => {
              const filled = i < Math.round(importance / 2);
              return `<circle cx="${W - 38 + i * 8}" cy="${H - 9}" r="2.8" fill="${filled ? color + 'cc' : '#1e2235'}"/>`;
          }).join('')
        : '';

    const badgeSvg = badge
        ? `<circle cx="10" cy="${H - 11}" r="7" fill="${x(badge.color)}33" stroke="${x(badge.color)}88" stroke-width="1"/>` +
          `<text x="10" y="${H - 7}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" font-weight="900" fill="${x(badge.color)}">${badge.text}</text>`
        : '';

    const lines = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`,
        `<rect width="${W}" height="${H}" rx="8" fill="#0d0d1a"/>`,
        `<rect width="4" height="${H}" rx="2" fill="${x(color)}"/>`,
        `<rect x="4" y="${H - 3}" width="${W - 4}" height="3" fill="${x(catColor)}55"/>`,
        `<circle cx="${W - 10}" cy="10" r="4" fill="${x(catColor)}99"/>`,
        nsText ? `<text x="12" y="16" font-family="system-ui,sans-serif" font-size="10" fill="#64748b">${x(nsText)}</text>` : '',
        `<text x="12" y="${subkeyY}" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="#f1f5f9" letter-spacing="0.3">${x(subkeyText)}</text>`,
        summaryText ? `<text x="12" y="${summaryY}" font-family="system-ui,sans-serif" font-size="10" fill="#4b5a6f">${x(summaryText)}</text>` : '',
        impDots,
        badgeSvg,
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
                'width': (node) => {
                    const scale = typeof getNodeWidthScale === 'function' ? getNodeWidthScale(node.id()) : 1;
                    return cardW() * scale;
                },
                'height': (node) => {
                    const scale = typeof getNodeWidthScale === 'function' ? getNodeWidthScale(node.id()) : 1;
                    return cardH() * scale;
                },
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
            selector: 'node.slideshow-active',
            style: {
                'border-width': 3,
                'border-color': (node) => typeof getCategoryColor === 'function'
                    ? getCategoryColor(node.id()) : nodeIdentityColor(node.id()),
                'shadow-blur': 36,
                'shadow-color': (node) => typeof getCategoryColor === 'function'
                    ? getCategoryColor(node.id()) : nodeIdentityColor(node.id()),
                'shadow-opacity': 0.88,
                'shadow-offset-x': 0,
                'shadow-offset-y': 0,
                'z-index': 20,
            },
        },
        {
            selector: 'node.hover-main',
            style: {
                'width': (node) => {
                    const scale = typeof getNodeWidthScale === 'function' ? getNodeWidthScale(node.id()) : 1;
                    return cardW() * scale * 1.12;
                },
                'height': (node) => {
                    const scale = typeof getNodeWidthScale === 'function' ? getNodeWidthScale(node.id()) : 1;
                    return cardH() * scale * 1.12;
                },
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
                    return (0.9 + weight * 1.4) * scale;
                },
                'opacity': 0.22,
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
            selector: 'edge[relation = "child_of"]',
            style: {
                'line-style': 'dashed',
                'line-dash-pattern': [6, 4],
                'opacity': 0.35,
                'width': 1,
                'target-arrow-shape': 'none',
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
                'opacity': 0.80,
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

    cy.on('dbltap', 'node', (event) => {
        const key = event.target.id();
        hideNodeTooltip();
        if (typeof toggleExpansionAnimated === 'function') toggleExpansionAnimated(key);
    });

    cy.on('tap', (event) => {
        if (event.target === cy) {
            closeActiveDetail();
            hideNodeTooltip();
        }
    });

    cy.on('free', 'node', (event) => {
        resolveNodeCollisions({
            pinnedKeys: new Set([event.target.id()]),
        });
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
    resolveNodeCollisions();
}

// ── Filtering ──────────────────────────────────────────────────────────

function filteredGraph(entries, edges) {
    const minImportance = Number(graphSettings?.minImportance) || 0;
    const relationFilters = graphSettings?.relationFilters || {};

    const visibleEntries = {};

    for (const [key, entry] of Object.entries(entries || {})) {
        if ((entry?.importance ?? 0) < minImportance) continue;
        if (visibleNodeIds.size > 0 && !visibleNodeIds.has(key)) continue;

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
        restoreSavedPositions(savedPositions);
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

// ── Progressive Expand / Collapse Animations ───────────────────────────

let _revealVersion = 0; // incremented on each expand to cancel stale callbacks

function toggleExpansionAnimated(key) {
    if (!currentEntries[key]) return;

    const { action, newKeys, removed } = toggleNodeExpansion(key);

    if (action === 'expand' && newKeys && newKeys.length > 0) {
        _addNodesToGraphProgressive(key, newKeys);
        // refreshSlideshow/updateStatus called at end of progressive animation
    } else {
        if (action === 'collapse' && removed && removed.size > 0) {
            _removeNodesFromGraph(removed);
        }
        cy.style().update(); // refresh SVG badges (+/−)
        if (typeof refreshSlideshow === 'function') refreshSlideshow();
        updateStatusCount();
        updateLegend();
    }
}

function _addNodesToGraphProgressive(parentKey, newKeys) {
    if (!cy || !newKeys.length) return;

    const token = ++_revealVersion; // cancel stale runs if user clicks again

    const parentNode = cy.$id(parentKey);
    const parentPos  = parentNode.length
        ? parentNode.position()
        : { x: cy.width() / 2, y: cy.height() / 2 };

    const n = newKeys.length;
    // Spread radius — wider for more children, min 380px
    const radius = Math.max(380, 220 + n * 52);

    // Pre-compute radial positions (arc spread, not full circle for small counts)
    const positions = newKeys.map((_, i) => {
        const spreadAngle = n <= 3 ? Math.PI * 0.6 : n <= 6 ? Math.PI * 1.2 : Math.PI * 2;
        const startAngle  = -Math.PI / 2 - spreadAngle / 2;
        const angle = n > 1 ? startAngle + (spreadAngle * i) / (n - 1) : -Math.PI / 2;
        return {
            x: parentPos.x + Math.cos(angle) * radius,
            y: parentPos.y + Math.sin(angle) * radius,
        };
    });

    // Track which edges have been added to avoid duplicates
    const addedEdgeIds = new Set();
    cy.edges().forEach((e) => addedEdgeIds.add(e.id()));

    const CHILD_STEP_MS = 130; // delay between each child reveal

    function revealChild(index) {
        if (token !== _revealVersion) return; // cancelled by a newer expand/collapse
        if (index >= newKeys.length) {
            // All done — update styles and UI
            cy.style().update();
            renderIdentityPanel();
            if (typeof refreshSlideshow === 'function') refreshSlideshow();
            updateStatusCount();
            updateLegend();
            return;
        }

        const childKey = newKeys[index];
        const pos      = positions[index];
        const entry    = currentEntries[childKey] || {};

        // Add node (might already exist if it's a shared neighbor)
        if (!cy.$id(childKey).length) {
            const nodeEl = cy.add({
                group: 'nodes',
                data: { id: childKey, importance: entry.importance || 0 },
                position: pos,
            });
            nodeEl.style('opacity', 0);
            nodeEl.animate({ style: { opacity: 1 } }, { duration: 280, easing: 'ease-out' });
        }

        // Add direct edges: parentKey ↔ childKey only
        window.setTimeout(() => {
            if (token !== _revealVersion) return;

            for (const edge of currentEdges || []) {
                if (!visibleEdgeIds.has(edgeKey(edge))) continue;
                const connects =
                    (edge.from === parentKey && edge.to === childKey) ||
                    (edge.to   === parentKey && edge.from === childKey);
                if (!connects) continue;

                const eid = edgeKey(edge);
                if (addedEdgeIds.has(eid)) continue;
                addedEdgeIds.add(eid);

                const edgeEl = cy.add({
                    group: 'edges',
                    data: {
                        id:       eid,
                        source:   edge.from,
                        target:   edge.to,
                        relation: edge.relation || 'related_to',
                        weight:   Number(edge.weight) || 0,
                    },
                });
                edgeEl.style('opacity', 0);
                edgeEl.animate({ style: { opacity: 0.28 } }, { duration: 240 });
            }

            // Reveal next child after a short gap
            window.setTimeout(() => revealChild(index + 1), 55);
        }, 95);
    }

    revealChild(0);
}

function _removeNodesFromGraph(removedSet) {
    if (!cy) return;

    const toRemove = cy.collection();
    for (const k of removedSet) {
        const node = cy.$id(k);
        if (node.length) {
            toRemove.merge(node);
            node.connectedEdges().forEach((e) => {
                if (removedSet.has(e.source().id()) || removedSet.has(e.target().id())) {
                    toRemove.merge(e);
                }
            });
        }
    }

    if (!toRemove.length) return;

    toRemove.animate({ style: { opacity: 0 } }, {
        duration: 220,
        easing: 'ease-in',
        complete: () => {
            cy.remove(toRemove);
            cy.style().update();
            renderIdentityPanel();
            updateLegend();
        },
    });
}

// ── Show Main Nodes Only ───────────────────────────────────────────────

function showMainNodesOnly() {
    collapseAll();
    renderGraph(currentEntries, currentEdges, { preserveSelection: false, fit: true });
    if (typeof refreshSlideshow === 'function') refreshSlideshow();
}
