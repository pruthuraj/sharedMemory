'use strict';

// ── Detail Panel Helpers ───────────────────────────────────────────────

function getDetailEl(id) {
    return document.getElementById(id);
}

function getSelectedNodeEl() {
    if (!selectedKey || !scene) return null;

    return scene.querySelector(`[data-key="${CSS.escape(selectedKey)}"]`);
}

function getNodeElByKey(key) {
    if (!key || !scene) return null;

    return scene.querySelector(`[data-key="${CSS.escape(key)}"]`);
}

function stringifyEntryValue(entry) {
    if (!entry) return '';

    return typeof entry.value === 'object'
        ? JSON.stringify(entry.value, null, 2)
        : String(entry.value ?? '');
}

function formatEntryDate(timestamp) {
    return timestamp ? new Date(timestamp).toLocaleString() : '-';
}

function buildDetailTagsHtml(entry) {
    const tags = entry?.tags || [];

    if (!tags.length) {
        return '<span style="color:#374151">-</span>';
    }

    return `
<div class="dp-tags">
  ${tags.map((tag) => `<span class="dp-tag">${esc(tag)}</span>`).join('')}
</div>`;
}

function buildExpiryHtml(entry) {
    if (!entry?.expiresAt) return '';

    return `
<div class="dp-row">
  <span class="dp-rl">Expires</span>
  <span class="dp-rv" style="color:#f59e0b">
    ${esc(new Date(entry.expiresAt).toLocaleString())}
  </span>
</div>`;
}

function buildDetailBodyHtml(key, entry, recencyColor) {
    const value = stringifyEntryValue(entry);
    const date = formatEntryDate(entry.updatedAt);
    const age = entry.updatedAt ? ageLabel(entry.updatedAt) : '';
    const tagsHtml = buildDetailTagsHtml(entry);
    const expiryHtml = buildExpiryHtml(entry);

    return `
<div class="dp-key">${esc(key)}</div>

<div class="dp-ts" style="color:${recencyColor}">
  ${esc(date)}${age ? ` - ${esc(age)}` : ''}
</div>

<div class="dp-value">${esc(value)}</div>

<div class="dp-row">
  <span class="dp-rl">Summary</span>
  <span class="dp-rv">${esc(entry.summary || '-')}</span>
</div>

<div class="dp-row">
  <span class="dp-rl">Tags</span>
  <span class="dp-rv">${tagsHtml}</span>
</div>

<div class="dp-row">
  <span class="dp-rl">Importance</span>
  <span class="dp-rv" style="color:#a5b4fc">${entry.importance ?? '-'}</span>
</div>

<div class="dp-row">
  <span class="dp-rl">Revision</span>
  <span class="dp-rv">${entry.revision ?? '-'}</span>
</div>

<div class="dp-row">
  <span class="dp-rl">Updated by</span>
  <span class="dp-rv">${esc(entry.updatedBy || '-')}</span>
</div>

${expiryHtml}`;
}

// ── Selection Styling ──────────────────────────────────────────────────

function resetNodeSelectionStyle(key) {
    const nodeEl = getNodeElByKey(key);

    if (!nodeEl) return;

    const color = nodeIdentityColor(key);

    nodeEl.classList.remove('selected');
    nodeEl.style.borderColor = `${color}44`;
    nodeEl.style.boxShadow = '0 2px 14px #00000055';
}

function applyNodeSelectionStyle(key) {
    const nodeEl = getNodeElByKey(key);

    if (!nodeEl) return;

    const color = nodeIdentityColor(key);

    nodeEl.classList.add('selected');
    nodeEl.style.borderColor = color;
    nodeEl.style.boxShadow = `0 0 0 3px ${color}33, 0 4px 24px #00000077`;
}

function resetPreviousSelection() {
    if (!selectedKey) return;

    resetNodeSelectionStyle(selectedKey);
}

function closeSelectedNodeVisualState() {
    if (!selectedKey) return;

    const nodeEl = getSelectedNodeEl();

    if (!nodeEl) return;

    expandedNodes.delete(selectedKey);
    setNodePresentation(selectedKey, nodeEl);
    resetNodeSelectionStyle(selectedKey);
}

// ── Detail Panel Rendering ─────────────────────────────────────────────

function updateDetailPanelChrome(key, entry) {
    const color = nodeIdentityColor(key);

    const barEl = getDetailEl('dp-bar');
    const labelEl = getDetailEl('dp-label');

    if (barEl) {
        barEl.style.background = `linear-gradient(90deg, ${color}, ${color}44)`;
    }

    if (labelEl) {
        labelEl.style.color = color;
        labelEl.textContent = 'Memory Entry';
    }

    detailPanel.style.borderColor = `${color}44`;
}

function updateDetailPanelBody(key, entry) {
    const bodyEl = getDetailEl('dp-body');

    if (!bodyEl) return;

    const recencyColor = ageColor(entry.updatedAt);

    bodyEl.innerHTML = buildDetailBodyHtml(key, entry, recencyColor);
}

function showDetailPanel() {
    detailPanel.classList.add('visible');
    document.body.classList.add('inspector-open');
}

function closeDetailPanel() {
    detailPanel.classList.remove('visible');
    document.body.classList.remove('inspector-open');
}

// ── Focus Layout ───────────────────────────────────────────────────────

function getCurrentNodeFocusCenter(key, entry) {
    const position = nodePositions[key];

    if (!position) return null;

    const box = nodeVisualBox(key, position, entry);

    return nodeCenter(box);
}

function updateGraphFocusLayout(key, entry, previousSelected, focusCenter) {
    if (previousSelected !== key) {
        nodePositions = computeLayout(currentEntries, currentEdges);

        if (focusCenter) {
            setSlotCenter(key, focusCenter.x, focusCenter.y);
        }
    }

    applyRadialFocusLayout(key, {
        center: focusCenter,
    });
}

// ── Detail Panel Public Action ─────────────────────────────────────────

function openDetail(key, entry) {
    if (!key || !entry) return;

    const previousSelected = selectedKey;
    const focusCenter = getCurrentNodeFocusCenter(key, entry);

    collapseOtherNodes(key);
    resetPreviousSelection();

    selectedKey = key;
    focusedKey = key;
    lastFocusedKey = key;

    applyNodeSelectionStyle(key);
    updateGraphFocusLayout(key, entry, previousSelected, focusCenter);

    updateDetailPanelChrome(key, entry);
    updateDetailPanelBody(key, entry);
    showDetailPanel();

    renderIdentityPanel();
    applyFocusState();
}

// ── Copy Action ────────────────────────────────────────────────────────

async function copySelectedEntryValue(buttonEl) {
    if (!selectedKey) return;

    const entry = currentEntries[selectedKey];

    if (!entry) return;

    const text = stringifyEntryValue(entry);
    const originalText = buttonEl.textContent;

    try {
        await navigator.clipboard.writeText(text);

        buttonEl.textContent = 'Copied';
        buttonEl.classList.add('copied');

        window.setTimeout(() => {
            buttonEl.textContent = originalText;
            buttonEl.classList.remove('copied');
        }, 1200);
    } catch {
        buttonEl.textContent = 'Failed';

        window.setTimeout(() => {
            buttonEl.textContent = originalText || 'Copy';
        }, 1200);
    }
}

function setupCopyButton() {
    const copyBtn = getDetailEl('dp-copy');

    if (!copyBtn) return;

    copyBtn.addEventListener('click', async (event) => {
        await copySelectedEntryValue(event.currentTarget);
    });
}

// ── Close Action ───────────────────────────────────────────────────────

function closeActiveDetail() {
    closeSelectedNodeVisualState();
    closeDetailPanel();
    clearActiveSelection({ resetLayout: true });
}

function setupCloseButton() {
    const closeBtn = getDetailEl('dp-close');

    if (!closeBtn) return;

    closeBtn.addEventListener('click', closeActiveDetail);
}

function setupViewportCloseHandler() {
    if (!viewport) return;

    viewport.addEventListener('click', (event) => {
        const clickedGraphBackground =
            event.target === viewport ||
            event.target === scene ||
            event.target === edgesSvg;

        if (!clickedGraphBackground) return;

        closeActiveDetail();
    });
}

// ── Event Setup ────────────────────────────────────────────────────────

setupCopyButton();
setupCloseButton();
setupViewportCloseHandler();