'use strict';

// ── Identity Panel Constants ───────────────────────────────────────────

const IDENTITY_EMPTY_CONNECT_MESSAGE = 'Connect to load node identities.';
const IDENTITY_EMPTY_SEARCH_MESSAGE = 'No matching nodes.';

// ── Identity Helpers ───────────────────────────────────────────────────

function identityFilterText() {
    return identitySearch ? identitySearch.value.trim().toLowerCase() : '';
}

function getIdentityKeys() {
    return Object.keys(currentEntries || {}).sort();
}

function getIdentityEntry(key) {
    return currentEntries?.[key] || {};
}

function getIdentitySearchText(key, entry) {
    return [
        key,
        entry.summary || '',
        ...(entry.tags || []),
    ].join(' ').toLowerCase();
}

function filterIdentityKeys(keys, filter) {
    if (!filter) return keys;

    return keys.filter((key) => {
        const entry = getIdentityEntry(key);
        const haystack = getIdentitySearchText(key, entry);

        return haystack.includes(filter);
    });
}

function setIdentitySummary(count) {
    if (!identitySummary) return;

    identitySummary.textContent = `${count} ${count === 1 ? 'node' : 'nodes'}`;
}

function setIdentityEmptyMessage(message) {
    if (!identityList) return;

    identityList.innerHTML = `<div class="identity-empty">${esc(message)}</div>`;
}

// ── Identity Item Rendering ────────────────────────────────────────────

function buildIdentityMeta(key, entry) {
    const degree = nodeDegree(key);
    const importance = entry.importance ?? 0;

    return `${degree} links - importance ${importance}`;
}

function buildIdentityItemHtml(key) {
    const entry = getIdentityEntry(key);
    const color = nodeIdentityColor(key);
    const activeClass = selectedKey === key ? ' active' : '';
    const summary = entry.summary || 'No summary';

    return `
<button class="identity-item${activeClass}" data-key="${esc(key)}" title="${esc(key)}">
  <span
    class="identity-swatch"
    style="background:${color};box-shadow:0 0 12px ${color}88"
  ></span>

  <span class="identity-copy">
    <span class="identity-key">${esc(key)}</span>
    <span class="identity-meta">${esc(buildIdentityMeta(key, entry))}</span>
    <span class="identity-node-summary">${esc(summary)}</span>
  </span>
</button>`;
}

function renderIdentityItems(keys) {
    if (!identityList) return;

    identityList.innerHTML = keys
        .map((key) => buildIdentityItemHtml(key))
        .join('');
}

// ── Identity Panel Rendering ───────────────────────────────────────────

function renderIdentityPanel() {
    if (!identityList || !identitySummary) return;

    const keys = getIdentityKeys();
    const filter = identityFilterText();
    const visibleKeys = filterIdentityKeys(keys, filter);

    setIdentitySummary(keys.length);

    if (!keys.length) {
        setIdentityEmptyMessage(IDENTITY_EMPTY_CONNECT_MESSAGE);
        return;
    }

    if (!visibleKeys.length) {
        setIdentityEmptyMessage(IDENTITY_EMPTY_SEARCH_MESSAGE);
        return;
    }

    renderIdentityItems(visibleKeys);
}

// ── Identity Panel Visibility ──────────────────────────────────────────

function setIdentityPanelOpen(isOpen) {
    if (!identityPanel || !identityBtn) return;

    identityPanel.classList.toggle('visible', isOpen);
    identityPanel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');

    identityBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

    document.body.classList.toggle('identity-open', isOpen);

    if (isOpen) {
        renderIdentityPanel();
    }
}

function openIdentityPanel() {
    setIdentityPanelOpen(true);
}

function closeIdentityPanel() {
    setIdentityPanelOpen(false);
}

function toggleIdentityPanel() {
    const isOpen = identityPanel?.classList.contains('visible');

    setIdentityPanelOpen(!isOpen);
}

// ── Identity Node Focus ────────────────────────────────────────────────

function focusIdentityNode(key) {
    const entry = currentEntries?.[key];

    if (!entry) return;

    openDetail(key, entry);
}