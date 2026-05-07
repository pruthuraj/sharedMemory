'use strict';

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

    document.getElementById('dp-bar').style.background = `linear-gradient(90deg, ${color}, ${color}44)`;
    document.getElementById('dp-label').style.color = color;
    document.getElementById('dp-label').textContent = 'Memory Entry';
    detailPanel.style.borderColor = `${color}44`;

    const val = typeof entry.value === 'object'
        ? JSON.stringify(entry.value, null, 2)
        : String(entry.value ?? '');

    const tagsHtml = entry.tags && entry.tags.length
        ? `<div class="dp-tags">${entry.tags.map(t => `<span class="dp-tag">${esc(t)}</span>`).join('')}</div>`
        : '<span style="color:#374151">-</span>';

    const date = entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : '-';
    const age = entry.updatedAt ? ageLabel(entry.updatedAt) : '';
    const exp = entry.expiresAt
        ? `<div class="dp-row"><span class="dp-rl">Expires</span><span class="dp-rv" style="color:#f59e0b">${new Date(entry.expiresAt).toLocaleString()}</span></div>`
        : '';

    document.getElementById('dp-body').innerHTML = `
<div class="dp-key">${esc(key)}</div>
<div class="dp-ts" style="color:${recencyColor}">${esc(date)}${age ? ` - ${esc(age)}` : ''}</div>
<div class="dp-value">${esc(val)}</div>
<div class="dp-row"><span class="dp-rl">Summary</span><span class="dp-rv">${esc(entry.summary || '-')}</span></div>
<div class="dp-row"><span class="dp-rl">Tags</span><span class="dp-rv">${tagsHtml}</span></div>
<div class="dp-row"><span class="dp-rl">Importance</span><span class="dp-rv" style="color:#a5b4fc">${entry.importance ?? '-'}</span></div>
<div class="dp-row"><span class="dp-rl">Revision</span><span class="dp-rv">${entry.revision ?? '-'}</span></div>
<div class="dp-row"><span class="dp-rl">Updated by</span><span class="dp-rv">${esc(entry.updatedBy || '-')}</span></div>
${exp}`;

    detailPanel.classList.add('visible');
    document.body.classList.add('inspector-open');
    renderIdentityPanel();
    applyFocusState();
}

document.getElementById('dp-copy').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!selectedKey) return;
    const entry = currentEntries[selectedKey];
    if (!entry) return;
    const text = typeof entry.value === 'object'
        ? JSON.stringify(entry.value, null, 2)
        : String(entry.value ?? '');
    try {
        await navigator.clipboard.writeText(text);
        const original = btn.textContent;
        btn.textContent = 'Copied';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.textContent = original;
            btn.classList.remove('copied');
        }, 1200);
    } catch {
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
