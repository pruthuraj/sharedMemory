'use strict';

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
    const maxSize = keys.reduce((largest, key) => Math.max(largest, nodeVisualBox(key, nodePositions[key]).w), 0);
    const circumferenceRadius = (keys.length * Math.max(maxSize + 64, 150)) / (Math.PI * 2);
    return Math.max(RADIAL_RING_GAP * distance, circumferenceRadius + RADIAL_RING_GAP * (distance - 1) * 0.35);
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

    for (const [distance, keys] of Array.from(groups.entries()).sort((a, b) => a[0] - b[0])) {
        if (distance === 0) continue;

        const radius = radialRingRadius(distance, keys);
        const offset = -Math.PI / 2 + (distance % 2 === 0 && keys.length > 1 ? Math.PI / keys.length : 0);
        keys.forEach((key, index) => {
            const angle = offset + (Math.PI * 2 * index) / keys.length;
            setSlotCenter(key, centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
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
    div.addEventListener('mouseenter', () => setFocusKey(key));
    div.addEventListener('mouseleave', () => clearFocusKey());
    div.addEventListener('focus', () => setFocusKey(key));
    div.addEventListener('blur', () => clearFocusKey());

    return div;
}

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

function updatePeekStrip(key) {
    if (!peekStrip) return;
    const entry = key ? currentEntries[key] : null;
    if (!entry) {
        peekStrip.hidden = true;
        return;
    }
    const color = nodeIdentityColor(key);
    const importance = Math.max(0, Math.min(10, Number(entry.importance) || 0));
    const tags = (entry.tags || []).slice(0, 4);
    peekStrip.hidden = false;
    peekStrip.style.setProperty('--peek-color', color);
    peekStrip.querySelector('.peek-dot').style.background = color;
    peekStrip.querySelector('.peek-key').textContent = key;
    peekStrip.querySelector('.peek-imp-fill').style.width = `${importance * 10}%`;
    peekStrip.querySelector('.peek-imp').setAttribute('title', `Importance ${importance}/10`);
    peekStrip.querySelector('.peek-tags').innerHTML = tags
        .map(t => `<span class="peek-tag">${esc(t)}</span>`)
        .join('');
    peekStrip.querySelector('.peek-summary').textContent = entry.summary || '';
}

function applyFocusState() {
    const key = focusedKey;
    const distances = key ? focusDistances(key) : new Map();
    const hoverActive = Boolean(hoverKey && key === hoverKey);
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
