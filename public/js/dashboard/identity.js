'use strict';

// ── Identity panel ─────────────────────────────────────────────────────
function identityFilterText() {
    return identitySearch ? identitySearch.value.trim().toLowerCase() : '';
}

function renderIdentityPanel() {
    if (!identityList || !identitySummary) return;

    const keys = Object.keys(currentEntries).sort();
    const filter = identityFilterText();
    const visibleKeys = filter
        ? keys.filter((key) => {
            const entry = currentEntries[key] || {};
            const haystack = [
                key,
                entry.summary || '',
                ...(entry.tags || []),
            ].join(' ').toLowerCase();
            return haystack.includes(filter);
        })
        : keys;

    identitySummary.textContent = `${keys.length} ${keys.length === 1 ? 'node' : 'nodes'}`;

    if (!keys.length) {
        identityList.innerHTML = '<div class="identity-empty">Connect to load node identities.</div>';
        return;
    }

    if (!visibleKeys.length) {
        identityList.innerHTML = '<div class="identity-empty">No matching nodes.</div>';
        return;
    }

    identityList.innerHTML = visibleKeys.map((key) => {
        const entry = currentEntries[key] || {};
        const color = nodeIdentityColor(key);
        const active = selectedKey === key ? ' active' : '';
        const summary = entry.summary || 'No summary';
        return `
      <button class="identity-item${active}" data-key="${esc(key)}" title="${esc(key)}">
        <span class="identity-swatch" style="background:${color};box-shadow:0 0 12px ${color}88"></span>
        <span class="identity-copy">
          <span class="identity-key">${esc(key)}</span>
          <span class="identity-meta">${nodeDegree(key)} links - importance ${entry.importance ?? 0}</span>
          <span class="identity-node-summary">${esc(summary)}</span>
        </span>
      </button>
    `;
    }).join('');
}

function openIdentityPanel() {
    identityPanel.classList.add('visible');
    identityPanel.setAttribute('aria-hidden', 'false');
    identityBtn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('identity-open');
    renderIdentityPanel();
}

function closeIdentityPanel() {
    identityPanel.classList.remove('visible');
    identityPanel.setAttribute('aria-hidden', 'true');
    identityBtn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('identity-open');
}

function toggleIdentityPanel() {
    if (identityPanel.classList.contains('visible')) closeIdentityPanel();
    else openIdentityPanel();
}

function focusIdentityNode(key) {
    const entry = currentEntries[key];
    if (!entry) return;

    const node = scene.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (node && !expandedNodes.has(key)) {
        expandedNodes.add(key);
        setNodePresentation(key, node);
        rerenderEdgesForCurrentPositions();
        window.setTimeout(rerenderEdgesForCurrentPositions, NODE_TRANSITION_MS);
    }

    openDetail(key, entry);
}
