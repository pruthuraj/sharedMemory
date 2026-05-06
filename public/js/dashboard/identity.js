'use strict';

// Identity side panel rendering, filtering, open/close behavior, and focus-from-identity actions.

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
        identityList.innerHTML = '';
        const div = document.createElement('div');
        div.className = 'identity-empty';
        div.textContent = 'Connect to load node identities.';
        identityList.appendChild(div);
        return;
    }

    if (!visibleKeys.length) {
        identityList.innerHTML = '';
        const div = document.createElement('div');
        div.className = 'identity-empty';
        div.textContent = 'No matching nodes.';
        identityList.appendChild(div);
        return;
    }

    identityList.innerHTML = '';
    for (const key of visibleKeys) {
        const entry = currentEntries[key] || {};
        const color = nodeIdentityColor(key);
        const active = selectedKey === key ? ' active' : '';
        const summary = entry.summary || 'No summary';
        const btn = document.createElement('button');
        btn.className = `identity-item${active}`;
        btn.dataset.key = key;
        btn.title = key;

        const sw = document.createElement('span');
        sw.className = 'identity-swatch';
        sw.style.background = color;
        sw.style.boxShadow = `0 0 12px ${color}88`;
        btn.appendChild(sw);

        const copy = document.createElement('span');
        copy.className = 'identity-copy';
        const kspan = document.createElement('span');
        kspan.className = 'identity-key';
        kspan.textContent = key;
        const meta = document.createElement('span');
        meta.className = 'identity-meta';
        meta.textContent = `${nodeDegree(key)} links - importance ${entry.importance ?? 0}`;
        const ssum = document.createElement('span');
        ssum.className = 'identity-node-summary';
        ssum.textContent = summary;
        copy.appendChild(kspan);
        copy.appendChild(meta);
        copy.appendChild(ssum);
        btn.appendChild(copy);

        identityList.appendChild(btn);
    }
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

