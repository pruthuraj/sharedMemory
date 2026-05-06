'use strict';

// Node rendering, node expansion/collapse, focus state, and radial focus layout.

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

// ── Node rendering ─────────────────────────────────────────────────────
function collapseOtherNodes(activeKey) {
    for (const key of Array.from(expandedNodes)) {
        if (key === activeKey) continue;
        expandedNodes.delete(key);
        const node = scene.querySelector(`[data-key="${CSS.escape(key)}"]`);
        if (node) setNodePresentation(key, node);
    }
}

function resetToComputedLayout() {
    if (!Object.keys(currentEntries).length) return;
    nodePositions = computeLayout(currentEntries, currentEdges);
    for (const node of scene.querySelectorAll('.mem-node')) {
        applyNodePlacement(node, node.dataset.key);
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
    if (options.resetLayout) resetToComputedLayout();
    else applyFocusState();
}

function radialRingRadius(distance, keys) {
    const maxDiameter = keys.reduce((largest, key) => {
        const pos = nodePositions[key];
        if (!pos || !currentEntries[key]) return largest;
        const box = nodeVisualBox(key, pos, currentEntries[key]);
        return Math.max(largest, Math.max(box.w, box.h));
    }, 0);
    const minSpacing = Math.max(maxDiameter + 42, 150);
    const circumferenceRadius = (keys.length * minSpacing) / (Math.PI * 2);
    const gapMultiplier = (graphSettings && Number(graphSettings.radialGapMultiplier)) || 1;
    const baseGap = RADIAL_RING_GAP * gapMultiplier;
    return Math.max(baseGap * distance, circumferenceRadius + baseGap * (distance - 1) * 0.35);
}

function keyAngleAroundCenter(key, centerX, centerY) {
    const pos = nodePositions[key];
    const entry = currentEntries[key];
    if (!pos || !entry) return 0;
    const box = nodeVisualBox(key, pos, entry);
    const center = nodeCenter(box);
    return Math.atan2(center.y - centerY, center.x - centerX);
}

function splitIntoRadialBands(keys, baseRadius) {
    if (!keys.length) return [];

    const maxDiameter = keys.reduce((largest, key) => {
        const pos = nodePositions[key];
        const entry = currentEntries[key];
        if (!pos || !entry) return largest;
        const box = nodeVisualBox(key, pos, entry);
        return Math.max(largest, Math.max(box.w, box.h));
    }, 120);

    const gap = Math.max(26, maxDiameter * 0.22);
    const slotArc = maxDiameter + gap;
    const rawCapacity = Math.floor((2 * Math.PI * baseRadius) / slotArc) || 5;
    const configuredMax = Number(graphSettings && graphSettings.maxNodesPerRing) || rawCapacity;
    const capacity = Math.max(5, Math.min(rawCapacity, configuredMax));
    const bandCount = Math.max(1, Math.ceil(keys.length / capacity));
    const gapMultiplier = (graphSettings && Number(graphSettings.radialGapMultiplier)) || 1;
    const radialStep = Math.max(78, maxDiameter * 0.72) * gapMultiplier;

    const bands = [];
    for (let i = 0; i < bandCount; i += 1) {
        const start = i * capacity;
        const slice = keys.slice(start, start + capacity);
        if (!slice.length) continue;
        bands.push({
            radius: baseRadius + i * radialStep,
            keys: slice,
        });
    }
    return bands;
}

function applyRadialFocusLayout(rootKey, options = {}) {
    if (!rootKey || !nodePositions[rootKey] || !currentEntries[rootKey]) return;

    const rootBox = nodeVisualBox(rootKey, nodePositions[rootKey]);
    const rootCenter = options.center || nodeCenter(rootBox);
    const centerX = rootCenter.x;
    const centerY = rootCenter.y;
    const distances = focusDistances(rootKey);
    const layoutDepth = Math.min(graphSettings.focusDepth, RADIAL_LAYOUT_MAX_DEPTH);
    const groups = new Map();

    for (const key of Object.keys(currentEntries).sort()) {
        if (!distances.has(key)) continue;
        const distance = key === rootKey ? 0 : distances.get(key);
        if (distance > layoutDepth) continue;
        if (!groups.has(distance)) groups.set(distance, []);
        groups.get(distance).push(key);
    }

    setSlotCenter(rootKey, centerX, centerY);

    for (const [distance, rawKeys] of Array.from(groups.entries()).sort((a, b) => a[0] - b[0])) {
        if (distance === 0) continue;

        // Keep angular ordering stable (based on current positions) to reduce
        // edge crossing flicker, then pack crowded rings into multiple bands.
        const keys = rawKeys.slice().sort((a, b) => keyAngleAroundCenter(a, centerX, centerY) - keyAngleAroundCenter(b, centerX, centerY));
        const baseRadius = radialRingRadius(distance, keys);
        const bands = splitIntoRadialBands(keys, baseRadius);

        bands.forEach((band, bandIndex) => {
            const offset = -Math.PI / 2
                + (distance % 2 === 0 && band.keys.length > 1 ? Math.PI / band.keys.length : 0)
                + (bandIndex % 2 ? Math.PI / Math.max(6, band.keys.length * 2) : 0);
            band.keys.forEach((key, index) => {
                const angle = offset + (Math.PI * 2 * index) / band.keys.length;
                setSlotCenter(key, centerX + Math.cos(angle) * band.radius, centerY + Math.sin(angle) * band.radius);
            });
        });
    }

    for (const node of scene.querySelectorAll('.mem-node')) {
        applyNodePlacement(node, node.dataset.key);
    }
    rerenderEdgesForCurrentPositions();
}

function buildNodeEl(key, entry, pos) {
    const color = nodeIdentityColor(key);
    const recencyColor = ageColor(entry.updatedAt);
    const isExpanded = expandedNodes.has(key);

    const div = document.createElement('div');
    div.className = `mem-node ${isExpanded ? 'expanded' : 'round'}`;
    div.dataset.key = key;
    div.setAttribute('role', 'button');
    div.setAttribute('tabindex', '0');
    div.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    div.setAttribute('aria-label', `${key} memory node`);
    const degree = nodeDegree(key);
    div.setAttribute('data-degree', degree);
    const tooltipParts = [key];
    if (entry.summary) tooltipParts.push(entry.summary);
    if (entry.importance > 0) tooltipParts.push(`importance ${entry.importance}/10`);
    div.title = tooltipParts.join('\n');
    div.style.cssText = `--node-color:${color};border:1.5px solid ${color}66;box-shadow:0 2px 14px #00000055;`;

    const tagsHtml = entry.tags && entry.tags.length
        ? `<div class="node-tags">${entry.tags.map(t => `<span class="node-tag">${esc(t)}</span>`).join('')}</div>`
        : '';

    const impHtml = entry.importance > 0
        ? `<div class="node-imp">importance <span>${entry.importance}</span>/10</div>`
        : '';

    div.innerHTML = `
<div class="node-mini">
  <span class="node-dot node-mini-dot" style="background:${color};box-shadow:0 0 8px ${color}"></span>
  <div class="node-mini-title">${esc(key)}</div>
    <svg class="node-mini-title-svg" viewBox="0 0 120 28" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <text x="60" y="18" text-anchor="middle" textLength="108" lengthAdjust="spacingAndGlyphs">${esc(key)}</text>
    </svg>
  <div class="node-mini-degree">${nodeDegree(key)} links</div>
  <div class="node-mini-summary">${esc(entry.summary || '')}</div>
  <div class="node-mini-tags">${(entry.tags || []).slice(0, 2).map(t => `<span>${esc(t)}</span>`).join('')}</div>
  <div class="node-mini-relation"></div>
</div>
<div class="node-card">
  <div class="node-header">
    <div class="node-key-row">
      <span class="node-dot" style="background:${color};box-shadow:0 0 6px ${color}"></span>
      <div class="node-key">${esc(key)}</div>
    </div>
    <div class="node-age" style="color:${recencyColor}">${ageLabel(entry.updatedAt)}</div>
  </div>
  <div class="node-summary">${esc(entry.summary || '')}</div>
  ${tagsHtml}${impHtml}
</div>`;

    applyNodePlacement(div, key);

    div.addEventListener('pointerdown', e => beginNodeDrag(e, key, div));
    div.addEventListener('click', e => {
        e.stopPropagation();
        if (suppressClickKey === key) {
            suppressClickKey = null;
            return;
        }
        const wasExpanded = expandedNodes.has(key);
        toggleNodeExpanded(key, div);
        if (wasExpanded) {
            clearActiveSelection({ resetLayout: true });
            return;
        }
        openDetail(key, currentEntries[key] || entry);
    });
    div.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        const wasExpanded = expandedNodes.has(key);
        toggleNodeExpanded(key, div);
        if (wasExpanded) {
            clearActiveSelection({ resetLayout: true });
            return;
        }
        openDetail(key, currentEntries[key] || entry);
    });
    div.addEventListener('mouseenter', () => {
        setFocusKey(key);
        highlightConnectedEdges(key, true);
    });
    div.addEventListener('mouseleave', () => {
        clearFocusKey();
        highlightConnectedEdges(key, false);
    });

    return div;
}

function setFocusKey(key) {
    // Allow hover effects on any node, even when another is selected.
    // Hover just updates visual feedback; clicking is what opens the detail panel.
    hoverKey = key;
    focusedKey = key;
    lastFocusedKey = key;
    applyFocusState();
}

function clearFocusKey() {
    hoverKey = null;
    focusedKey = selectedKey;
    applyFocusState();
}

function highlightConnectedEdges(key, highlight) {
    if (!edgesSvg) return;
    const paths = edgesSvg.querySelectorAll('.edge-path');
    if (highlight) {
        paths.forEach(path => {
            const fromKey = path.getAttribute('data-from-key');
            const toKey = path.getAttribute('data-to-key');
            if (fromKey === key || toKey === key) {
                path.classList.add('edge-highlighted');
            } else {
                path.classList.add('edge-dimmed');
            }
        });
    } else {
        paths.forEach(path => {
            path.classList.remove('edge-highlighted', 'edge-dimmed');
        });
    }
}

function applyFocusState() {
    const key = focusedKey;
    const distances = key ? focusDistances(key) : new Map();
    // If a node is selected, only allow hover effects on that selected node.
    const hoverActive = Boolean(hoverKey && key === hoverKey && (!selectedKey || hoverKey === selectedKey));
    const hoverNeighbors = hoverActive ? directNeighbors(hoverKey) : new Set();
    const selectedMode = Boolean(key && selectedKey === key && !hoverActive);

    for (const node of scene.querySelectorAll('.mem-node')) {
        const nodeKey = node.dataset.key;
        const distance = hoverActive
            ? (nodeKey === hoverKey ? 0 : (hoverNeighbors.has(nodeKey) ? 1 : undefined))
            : distances.get(nodeKey);
        const inFocus = Boolean(key) && distance !== undefined;
        applyMiniDetail(node, Boolean(key) ? distance : undefined, key);
        node.classList.toggle('dimmed', Boolean(key) && !inFocus);
        node.classList.toggle('related', inFocus && distance > 0);
        node.classList.toggle('selected', selectedKey === nodeKey);
        node.classList.toggle('hover-main', hoverActive && nodeKey === hoverKey);
        node.classList.toggle('hover-neighbor', hoverActive && hoverNeighbors.has(nodeKey));
        node.classList.toggle('hover-blurred', hoverActive && !inFocus);
        if (inFocus) applyNodeFocusChrome(node, distance);
        else {
            resetNodeChrome(node, nodeKey);
            if (key) node.style.opacity = String(dimmedNodeOpacity());
        }
    }

    for (const group of edgesSvg.querySelectorAll('.edge-group')) {
        resetEdgeChrome(group);
        const edge = {
            from: group.dataset.from,
            to: group.dataset.to,
        };
        const distance = key ? focusedEdgeDistance(edge, distances, key, selectedMode) : null;
        const inFocus = distance !== null;
        group.classList.toggle('dimmed', Boolean(key) && !inFocus);
        group.classList.toggle('highlight', inFocus);
        if (inFocus) applyEdgeFocusChrome(group, distance);
        else if (key) group.style.opacity = String(dimmedEdgeOpacity());
    }
}

// ── Edge rendering ─────────────────────────────────────────────────────
