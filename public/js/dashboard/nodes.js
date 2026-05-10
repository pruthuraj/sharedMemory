'use strict';

// ── Node Rendering Constants ───────────────────────────────────────────

const NODE_DEFAULT_LINK_LABEL = 'links';
const NODE_VISIBLE_TAG_LIMIT = 2;
const PEEK_VISIBLE_TAG_LIMIT = 4;

// ── Node Query Helpers ─────────────────────────────────────────────────

function getNodeElement(key) {
    if (!key || !scene) return null;

    return scene.querySelector(`[data-key="${CSS.escape(key)}"]`);
}

function getRenderedNodes() {
    return scene ? scene.querySelectorAll('.mem-node') : [];
}

function getEntry(key, fallbackEntry = null) {
    return currentEntries?.[key] || fallbackEntry;
}

// ── Node Expansion / Selection ─────────────────────────────────────────

function collapseOtherNodes(activeKey) {
    for (const key of Array.from(expandedNodes)) {
        if (key === activeKey) continue;

        expandedNodes.delete(key);

        const nodeEl = getNodeElement(key);

        if (nodeEl) {
            setNodePresentation(key, nodeEl);
        }
    }
}

function resetToComputedLayout() {
    if (!Object.keys(currentEntries || {}).length) return;

    nodePositions = computeLayout(currentEntries, currentEdges);

    for (const nodeEl of getRenderedNodes()) {
        applyNodePlacement(nodeEl, nodeEl.dataset.key);
    }

    sizeSceneToPositions(nodePositions);
    renderEdges(currentEdges, nodePositions, currentEntries);
    applyFocusState();
}

function clearActiveSelection(options = {}) {
    selectedKey = null;
    focusedKey = null;
    hoverKey = null;
    lastFocusedKey = null;

    detailPanel.classList.remove('visible');
    document.body.classList.remove('inspector-open');

    renderIdentityPanel();

    if (options.resetLayout) {
        resetToComputedLayout();
    } else {
        applyFocusState();
    }
}

function toggleNodeAndSelection(key, nodeEl, fallbackEntry = null) {
    const wasExpanded = expandedNodes.has(key);

    toggleNodeExpanded(key, nodeEl);

    if (wasExpanded) {
        clearActiveSelection({ resetLayout: true });
        return;
    }

    openDetail(key, getEntry(key, fallbackEntry));
}

// ── Radial Focus Layout ────────────────────────────────────────────────

function getLargestVisualDimension(keys) {
    return keys.reduce((largest, key) => {
        const position = nodePositions[key];

        if (!position) return largest;

        const box = nodeVisualBox(key, position);

        return Math.max(largest, box.w, box.h);
    }, 0);
}

function radialRingRadius(distance, keys) {
    const maxSize = getLargestVisualDimension(keys);
    const minSpacing = Math.max(maxSize + 96, 180);
    const circumferenceRadius = (keys.length * minSpacing) / (Math.PI * 2);
    const distanceRadius = RADIAL_RING_GAP * distance;
    const extraGap = RADIAL_RING_GAP * (distance - 1) * 0.35;

    return Math.max(distanceRadius, circumferenceRadius + extraGap);
}

function groupFocusNodesByDistance(rootKey, distances, layoutDepth) {
    const groups = new Map();

    for (const key of Object.keys(currentEntries || {}).sort()) {
        if (!distances.has(key)) continue;

        const distance = key === rootKey ? 0 : distances.get(key);

        if (distance > layoutDepth) continue;

        if (!groups.has(distance)) {
            groups.set(distance, []);
        }

        groups.get(distance).push(key);
    }

    return groups;
}

function placeFocusRing(keys, distance, centerX, centerY) {
    if (!keys.length) return;

    const radius = radialRingRadius(distance, keys);
    const stagger = distance % 2 === 0 && keys.length > 1
        ? Math.PI / keys.length
        : 0;

    const offset = -Math.PI / 2 + stagger;

    keys.forEach((key, index) => {
        const angle = offset + (Math.PI * 2 * index) / keys.length;

        setSlotCenter(
            key,
            centerX + Math.cos(angle) * radius,
            centerY + Math.sin(angle) * radius
        );
    });
}

function applyNodePlacementsFromPositions() {
    for (const nodeEl of getRenderedNodes()) {
        applyNodePlacement(nodeEl, nodeEl.dataset.key);
    }
}

function applyRadialFocusLayout(rootKey, options = {}) {
    if (!rootKey || !nodePositions[rootKey] || !currentEntries[rootKey]) return;

    const rootBox = nodeVisualBox(rootKey, nodePositions[rootKey]);
    const rootCenter = options.center || nodeCenter(rootBox);
    const centerX = rootCenter.x;
    const centerY = rootCenter.y;

    const distances = focusDistances(rootKey);
    const layoutDepth = Math.min(
        graphSettings.focusDepth,
        RADIAL_LAYOUT_MAX_DEPTH
    );

    const groups = groupFocusNodesByDistance(rootKey, distances, layoutDepth);

    setSlotCenter(rootKey, centerX, centerY);

    const sortedGroups = Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);

    for (const [distance, keys] of sortedGroups) {
        if (distance === 0) continue;

        placeFocusRing(keys, distance, centerX, centerY);
    }

    nodePositions = resolveNodeCollisions(nodePositions, currentEntries, {
        pinnedKey: rootKey,
    });

    applyNodePlacementsFromPositions();
    rerenderEdgesForCurrentPositions();
}

// ── Node HTML Builders ─────────────────────────────────────────────────

function buildTagHtml(tags = [], className = 'node-tag') {
    return tags.map((tag) => `<span class="${className}">${esc(tag)}</span>`).join('');
}

function buildNodeTagsHtml(entry) {
    const tags = entry.tags || [];

    if (!tags.length) return '';

    return `<div class="node-tags">${buildTagHtml(tags, 'node-tag')}</div>`;
}

function buildNodeImportanceHtml(entry) {
    const importance = Number(entry.importance) || 0;

    if (importance <= 0) return '';

    return `
<div class="node-imp">
  importance <span>${importance}</span>/10
</div>`;
}

function buildNodeMiniHtml(key, entry, color) {
    const tags = (entry.tags || []).slice(0, NODE_VISIBLE_TAG_LIMIT);

    return `
<div class="node-mini">
  <span class="node-dot node-mini-dot" style="background:${color};box-shadow:0 0 8px ${color}"></span>
  <div class="node-mini-title">${esc(key)}</div>
  <div class="node-mini-degree">${nodeDegree(key)} ${NODE_DEFAULT_LINK_LABEL}</div>
  <div class="node-mini-summary">${esc(entry.summary || '')}</div>
  <div class="node-mini-tags">${buildTagHtml(tags, '')}</div>
  <div class="node-mini-relation"></div>
</div>`;
}

function buildNodeCardHtml(key, entry, color, recencyColor) {
    return `
<div class="node-card">
  <div class="node-header">
    <div class="node-key-row">
      <span class="node-dot" style="background:${color};box-shadow:0 0 6px ${color}"></span>
      <div class="node-key">${esc(key)}</div>
    </div>
    <div class="node-age" style="color:${recencyColor}">${ageLabel(entry.updatedAt)}</div>
  </div>
  <div class="node-summary">${esc(entry.summary || '')}</div>
  ${buildNodeTagsHtml(entry)}
  ${buildNodeImportanceHtml(entry)}
</div>`;
}

function buildNodeHtml(key, entry, color, recencyColor) {
    return `
${buildNodeMiniHtml(key, entry, color)}
${buildNodeCardHtml(key, entry, color, recencyColor)}`;
}

// ── Node Element Creation ──────────────────────────────────────────────

function setNodeBaseAttributes(nodeEl, key, isExpanded) {
    nodeEl.className = `mem-node ${isExpanded ? 'expanded' : 'round'}`;
    nodeEl.dataset.key = key;

    nodeEl.setAttribute('role', 'button');
    nodeEl.setAttribute('tabindex', '0');
    nodeEl.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    nodeEl.setAttribute('aria-pressed', isExpanded ? 'true' : 'false');
    nodeEl.setAttribute('aria-selected', selectedKey === key ? 'true' : 'false');
    nodeEl.setAttribute('aria-label', `${key} memory node`);
}

function setNodeVisualStyle(nodeEl, color) {
    nodeEl.style.cssText = [
        `--node-color:${color}`,
        `border:1.5px solid ${color}66`,
        'box-shadow:0 2px 14px #00000055',
    ].join(';');
}

function handleNodeClick(event, key, nodeEl, entry) {
    event.stopPropagation();

    if (suppressClickKey === key) {
        suppressClickKey = null;
        return;
    }

    toggleNodeAndSelection(key, nodeEl, entry);
}

function handleNodeKeydown(event, key, nodeEl, entry) {
    if (event.key === 'Escape' && selectedKey === key) {
        event.preventDefault();

        if (typeof closeActiveDetail === 'function') {
            closeActiveDetail();
        } else {
            expandedNodes.delete(key);
            setNodePresentation(key, nodeEl);
            clearActiveSelection({ resetLayout: true });
        }

        return;
    }

    if (event.key !== 'Enter' && event.key !== ' ') return;

    event.preventDefault();

    toggleNodeAndSelection(key, nodeEl, entry);
}

function attachNodeEvents(nodeEl, key, entry) {
    nodeEl.addEventListener('pointerdown', (event) => {
        beginNodeDrag(event, key, nodeEl);
    });

    nodeEl.addEventListener('click', (event) => {
        handleNodeClick(event, key, nodeEl, entry);
    });

    nodeEl.addEventListener('keydown', (event) => {
        handleNodeKeydown(event, key, nodeEl, entry);
    });

    nodeEl.addEventListener('mouseenter', () => setFocusKey(key));
    nodeEl.addEventListener('mouseleave', () => clearFocusKey());
    nodeEl.addEventListener('focus', () => setFocusKey(key));
    nodeEl.addEventListener('blur', () => clearFocusKey());
}

function buildNodeEl(key, entry, pos) {
    const color = nodeIdentityColor(key);
    const recencyColor = ageColor(entry.updatedAt);
    const isExpanded = expandedNodes.has(key);

    const nodeEl = document.createElement('div');

    setNodeBaseAttributes(nodeEl, key, isExpanded);
    setNodeVisualStyle(nodeEl, color);

    nodeEl.innerHTML = buildNodeHtml(key, entry, color, recencyColor);

    applyNodePlacement(nodeEl, key);
    attachNodeEvents(nodeEl, key, entry);

    return nodeEl;
}

// ── Focus State ────────────────────────────────────────────────────────

function setFocusKey(key) {
    hoverKey = key;
    focusedKey = key;
    lastFocusedKey = key;

    updatePeekStrip(key);
    applyFocusState();
}

function clearFocusKey() {
    hoverKey = null;
    focusedKey = selectedKey;

    updatePeekStrip(selectedKey);
    applyFocusState();
}

// ── Peek Strip ─────────────────────────────────────────────────────────

function setPeekHidden(hidden) {
    if (!peekStrip) return;

    peekStrip.hidden = hidden;
}

function getPeekElement(selector) {
    return peekStrip ? peekStrip.querySelector(selector) : null;
}

function updatePeekStripTags(tags) {
    const tagsEl = getPeekElement('.peek-tags');

    if (!tagsEl) return;

    tagsEl.innerHTML = tags
        .map((tag) => `<span class="peek-tag">${esc(tag)}</span>`)
        .join('');
}

function updatePeekStrip(key) {
    if (!peekStrip) return;

    const entry = key ? currentEntries[key] : null;

    if (!entry) {
        setPeekHidden(true);
        return;
    }

    const color = nodeIdentityColor(key);
    const importance = Math.max(0, Math.min(10, Number(entry.importance) || 0));
    const tags = (entry.tags || []).slice(0, PEEK_VISIBLE_TAG_LIMIT);

    setPeekHidden(false);

    peekStrip.style.setProperty('--peek-color', color);

    const dotEl = getPeekElement('.peek-dot');
    const keyEl = getPeekElement('.peek-key');
    const fillEl = getPeekElement('.peek-imp-fill');
    const impEl = getPeekElement('.peek-imp');
    const summaryEl = getPeekElement('.peek-summary');

    if (dotEl) dotEl.style.background = color;
    if (keyEl) keyEl.textContent = key;
    if (fillEl) fillEl.style.width = `${importance * 10}%`;
    if (impEl) impEl.setAttribute('title', `Importance ${importance}/10`);
    if (summaryEl) summaryEl.textContent = entry.summary || '';

    updatePeekStripTags(tags);
}

// ── Focus Chrome Application ───────────────────────────────────────────

function getNodeFocusDistance(nodeKey, key, distances, hoverActive, hoverNeighbors) {
    if (!key) return undefined;

    if (hoverActive) {
        if (nodeKey === hoverKey) return 0;
        if (hoverNeighbors.has(nodeKey)) return 1;
        return undefined;
    }

    return distances.get(nodeKey);
}

function applyNodeFocusState(nodeEl, key, distances, hoverActive, hoverNeighbors) {
    const nodeKey = nodeEl.dataset.key;
    const distance = getNodeFocusDistance(
        nodeKey,
        key,
        distances,
        hoverActive,
        hoverNeighbors
    );

    const inFocus = Boolean(key) && distance !== undefined;

    applyMiniDetail(nodeEl, Boolean(key) ? distance : undefined, key);

    nodeEl.classList.toggle('dimmed', Boolean(key) && !inFocus);
    nodeEl.classList.toggle('related', inFocus && distance > 0);
    nodeEl.classList.toggle('selected', selectedKey === nodeKey);
    nodeEl.setAttribute('aria-selected', selectedKey === nodeKey ? 'true' : 'false');
    nodeEl.classList.toggle('hover-main', hoverActive && nodeKey === hoverKey);
    nodeEl.classList.toggle('hover-neighbor', hoverActive && hoverNeighbors.has(nodeKey));
    nodeEl.classList.toggle('hover-blurred', hoverActive && !inFocus);

    if (inFocus) {
        applyNodeFocusChrome(nodeEl, distance);
        return;
    }

    resetNodeChrome(nodeEl, nodeKey);

    if (key) {
        nodeEl.style.opacity = String(dimmedNodeOpacity());
    }
}

function getFocusedEdgeDistance(edge, key, distances, selectedMode) {
    if (!key) return null;

    return focusedEdgeDistance(edge, distances, key, selectedMode);
}

function applyEdgeFocusState(group, key, distances, selectedMode) {
    resetEdgeChrome(group);

    const edge = {
        from: group.dataset.from,
        to: group.dataset.to,
    };

    const distance = getFocusedEdgeDistance(edge, key, distances, selectedMode);
    const inFocus = distance !== null;

    group.classList.toggle('dimmed', Boolean(key) && !inFocus);
    group.classList.toggle('highlight', inFocus);

    if (inFocus) {
        applyEdgeFocusChrome(group, distance);
    } else if (key) {
        group.style.opacity = String(dimmedEdgeOpacity());
    }
}

function applyFocusState() {
    const key = focusedKey;
    const distances = key ? focusDistances(key) : new Map();

    const hoverActive = Boolean(hoverKey && key === hoverKey);
    const hoverNeighbors = hoverActive ? directNeighbors(hoverKey) : new Set();
    const selectedMode = Boolean(key && selectedKey === key && !hoverActive);

    for (const nodeEl of getRenderedNodes()) {
        applyNodeFocusState(nodeEl, key, distances, hoverActive, hoverNeighbors);
    }

    for (const edgeGroup of edgesSvg.querySelectorAll('.edge-group')) {
        applyEdgeFocusState(edgeGroup, key, distances, selectedMode);
    }
}
