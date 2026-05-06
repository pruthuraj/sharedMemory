'use strict';

// Graph filtering/rendering plus the right-side detail inspector and copy/close handlers.

function filteredGraph(entries, edges) {
    const minImportance = Number(graphSettings.minImportance) || 0;
    const relFilters = graphSettings.relationFilters || {};
    const visibleEntries = {};
    for (const [key, entry] of Object.entries(entries)) {
        if ((entry.importance ?? 0) < minImportance) continue;
        visibleEntries[key] = entry;
    }
    const visibleEdges = edges.filter((e) => {
        if (relFilters[e.relation] === false) return false;
        return visibleEntries[e.from] && visibleEntries[e.to];
    });
    return { entries: visibleEntries, edges: visibleEdges };
}

function renderGraph(rawEntries, rawEdges, options = {}) {
    const filtered = filteredGraph(rawEntries, rawEdges);
    const entries = filtered.entries;
    const edges = filtered.edges;
    const previousSelected = options.preserveSelection ? selectedKey : null;
    const previousPositions = options.preservePositions ? nodePositions : {};
    for (const el of scene.querySelectorAll('.mem-node')) el.remove();
    selectedKey = null;
    focusedKey = null;
    lastFocusedKey = null;
    detailPanel.classList.remove('visible');
    document.body.classList.remove('inspector-open');

    const keys = Object.keys(entries);
    for (const key of Array.from(expandedNodes)) {
        if (!entries[key]) expandedNodes.delete(key);
    }
    emptyState.classList.toggle('visible', keys.length === 0);
    updateLegend();
    renderIdentityPanel();

    if (!keys.length) {
        nodePositions = {};
        renderEdges([], {}, {});
        return;
    }

    const computedPositions = computeLayout(entries, edges);
    const positions = options.preservePositions
        ? mergePreservedPositions(computedPositions, previousPositions)
        : computedPositions;
    nodePositions = positions;

    sizeSceneToPositions(positions);

    renderEdges(edges, positions, entries);

    for (const [key, entry] of Object.entries(entries)) {
        if (positions[key]) scene.appendChild(buildNodeEl(key, entry, positions[key]));
    }

    if (options.fit !== false) fitView(positions);
    else applyTransform();

    if (previousSelected && entries[previousSelected]) {
        openDetail(previousSelected, entries[previousSelected]);
    } else {
        applyFocusState();
    }
}

// ── Detail panel ───────────────────────────────────────────────────────
function openDetail(key, entry) {
    const previousSelected = selectedKey;
    const currentBox = nodePositions[key] ? nodeVisualBox(key, nodePositions[key], entry) : null;
    const focusCenter = currentBox ? nodeCenter(currentBox) : null;
    collapseOtherNodes(key);

    // Deselect previous
    if (selectedKey) {
        const prev = scene.querySelector(`[data-key="${CSS.escape(selectedKey)}"]`);
        if (prev) {
            const c = nodeIdentityColor(selectedKey);
            prev.style.borderColor = `${c}44`;
            prev.style.boxShadow = '0 2px 14px #00000055';
        }
    }

    selectedKey = key;
    focusedKey = key;
    lastFocusedKey = key;
    const color = nodeIdentityColor(key);
    const recencyColor = ageColor(entry.updatedAt);

    const nodeEl = scene.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (nodeEl) {
        nodeEl.classList.add('selected');
        nodeEl.style.borderColor = color;
        nodeEl.style.boxShadow = `0 0 0 3px ${color}33, 0 4px 24px #00000077`;
    }

    if (previousSelected !== key) {
        nodePositions = computeLayout(currentEntries, currentEdges);
        if (focusCenter) setSlotCenter(key, focusCenter.x, focusCenter.y);
    }
    applyRadialFocusLayout(key, { center: focusCenter });

    const dpBarEl = document.getElementById('dp-bar');
    if (dpBarEl) dpBarEl.style.background = `linear-gradient(90deg, ${color}, ${color}44)`;
    const dpLabelEl = document.getElementById('dp-label');
    if (dpLabelEl) {
        dpLabelEl.style.color = color;
        dpLabelEl.textContent = 'Memory Entry';
    }
    if (detailPanel) detailPanel.style.borderColor = `${color}44`;

    const val = typeof entry.value === 'object'
        ? JSON.stringify(entry.value, null, 2)
        : String(entry.value ?? '');

    const date = entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : '-';
    const age = entry.updatedAt ? ageLabel(entry.updatedAt) : '';

    const dpBody = document.getElementById('dp-body');
    if (dpBody) {
        dpBody.innerHTML = '';
        const keyDiv = document.createElement('div'); keyDiv.className = 'dp-key'; keyDiv.textContent = key; dpBody.appendChild(keyDiv);
        const tsDiv = document.createElement('div'); tsDiv.className = 'dp-ts'; tsDiv.style.color = recencyColor; tsDiv.textContent = `${date}${age ? ` - ${age}` : ''}`; dpBody.appendChild(tsDiv);
        const valDiv = document.createElement('div'); valDiv.className = 'dp-value'; valDiv.textContent = val; dpBody.appendChild(valDiv);
        const row = (label, valueNode) => {
            const r = document.createElement('div'); r.className = 'dp-row';
            const rl = document.createElement('span'); rl.className = 'dp-rl'; rl.textContent = label; r.appendChild(rl);
            const rv = document.createElement('span'); rv.className = 'dp-rv'; rv.appendChild(valueNode); r.appendChild(rv);
            return r;
        };
        dpBody.appendChild(row('Summary', document.createTextNode(entry.summary || '-')));
        const tagsNode = document.createElement('div'); tagsNode.innerHTML = '';
        if (entry.tags && entry.tags.length) {
            for (const t of entry.tags) {
                const sp = document.createElement('span'); sp.className = 'dp-tag'; sp.textContent = t; tagsNode.appendChild(sp);
            }
        } else {
            const span = document.createElement('span'); span.style.color = '#374151'; span.textContent = '-'; tagsNode.appendChild(span);
        }
        dpBody.appendChild(row('Tags', tagsNode));
        dpBody.appendChild(row('Importance', document.createTextNode(entry.importance ?? '-')));
        dpBody.appendChild(row('Revision', document.createTextNode(entry.revision ?? '-')));
        dpBody.appendChild(row('Updated by', document.createTextNode(entry.updatedBy || '-')));
        if (entry.expiresAt) {
            const expRow = document.createElement('div'); expRow.className = 'dp-row';
            const rl = document.createElement('span'); rl.className = 'dp-rl'; rl.textContent = 'Expires';
            const rv = document.createElement('span'); rv.className = 'dp-rv'; rv.style.color = '#f59e0b'; rv.textContent = new Date(entry.expiresAt).toLocaleString();
            expRow.appendChild(rl); expRow.appendChild(rv); dpBody.appendChild(expRow);
        }
    }


    detailPanel.classList.add('visible');
    document.body.classList.add('inspector-open');
    renderIdentityPanel();
    applyFocusState();
}

document.getElementById('dp-copy').addEventListener('click', async () => {
    if (!selectedKey) return;
    const entry = currentEntries[selectedKey];
    if (!entry) return;
    const payload = JSON.stringify({ key: selectedKey, ...entry }, null, 2);
    const btn = document.getElementById('dp-copy');
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(payload);
        } else {
            const ta = document.createElement('textarea');
            ta.value = payload;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        const original = btn.textContent;
        btn.textContent = 'Copied';
        btn.disabled = true;
        setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1200);
    } catch (_) {
        btn.textContent = 'Failed';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
    }
});

document.getElementById('dp-close').addEventListener('click', () => {
    if (selectedKey) {
        const el = scene.querySelector(`[data-key="${CSS.escape(selectedKey)}"]`);
        if (el) {
            const c = nodeIdentityColor(selectedKey);
            expandedNodes.delete(selectedKey);
            setNodePresentation(selectedKey, el);
            el.classList.remove('selected');
            el.style.borderColor = `${c}44`;
            el.style.boxShadow = '0 2px 14px #00000055';
        }
    }
    clearActiveSelection({ resetLayout: true });
});

viewport.addEventListener('click', e => {
    if (e.target === viewport || e.target === scene || e.target === edgesSvg) {
        document.getElementById('dp-close').click();
    }
});

// ── Pan / zoom ─────────────────────────────────────────────────────────
