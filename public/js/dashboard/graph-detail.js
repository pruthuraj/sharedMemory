'use strict';

// ── Detail Panel Helpers ───────────────────────────────────────────────

function getDetailEl(id) {
    return document.getElementById(id);
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

    const category = getNodeCategory(key);
    const catColor = getCategoryColor(key);
    const importance = Math.max(0, Math.min(10, Number(entry.importance) || 0));

    const edgeCounts = {};
    for (const e of (currentEdges || [])) {
        if (e.from === key || e.to === key) {
            edgeCounts[e.relation] = (edgeCounts[e.relation] || 0) + 1;
        }
    }
    const connCount = Object.values(edgeCounts).reduce((s, n) => s + n, 0);
    const breakdown = Object.entries(edgeCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([r, n]) => `${esc(r.replace(/_/g, ' '))} ×${n}`)
        .join(', ');
    const childCount = (currentEdges || []).filter((e) => e.from === key && e.relation === 'child_of').length;
    const parentEdge = (currentEdges || []).find((e) => e.from === key && e.relation === 'child_of');
    const parentKey = parentEdge ? parentEdge.to : null;

    const dots = Array.from({ length: 10 }, (_, i) =>
        `<span class="dp-imp-dot${i < importance ? ' filled' : ''}"></span>`
    ).join('');

    const hierarchyHtml = (childCount > 0 || parentKey)
        ? `<div class="dp-hierarchy">
  ${childCount > 0 ? `<span class="dp-hier-item">↓ ${childCount} child${childCount !== 1 ? 'ren' : ''}</span>` : ''}
  ${parentKey ? `<span class="dp-hier-item">↑ <span class="dp-hier-parent">${esc(parentKey)}</span></span>` : ''}
</div>` : '';

    const stats = (entry.value && typeof entry.value === 'object' && entry.value.stats) || null;
    const statsHtml = stats ? `
<div class="dp-project-stats">
  <div class="dp-stats-title">Project descendants</div>
  <div class="dp-stats-grid">
    <span class="dp-stats-label">Count</span><span class="dp-stats-value">${Number(stats.count) || 0}</span>
    <span class="dp-stats-label">Avg importance</span><span class="dp-stats-value">${Number(stats.avgImportance || 0).toFixed(2)}</span>
    <span class="dp-stats-label">Sum</span><span class="dp-stats-value">${Number(stats.sum) || 0}</span>
    <span class="dp-stats-label">Threshold</span><span class="dp-stats-value">${Number(stats.threshold || 0).toFixed(2)}</span>
  </div>
  <div class="dp-stats-note">Leaves below threshold (${Number(stats.threshold || 0).toFixed(2)}) have no direct edges to this project root.</div>
</div>` : '';

    return `
<div class="dp-key">${esc(key)}</div>

<div class="dp-meta-row">
  <span class="dp-type-badge" style="background:${catColor}22;color:${catColor};border-color:${catColor}44">${esc(category)}</span>
  <span class="dp-ts" style="color:${recencyColor};margin:0">${age ? esc(age) + ' ago' : esc(date)}</span>
  <span class="dp-conn-count" title="${breakdown}">${connCount} link${connCount !== 1 ? 's' : ''}</span>
</div>

${hierarchyHtml}

${statsHtml}

<div class="dp-summary">${esc(entry.summary || '—')}</div>

<div class="dp-imp-row">
  <span class="dp-rl">Importance</span>
  <span class="dp-imp-dots">${dots}</span>
  <span class="dp-imp-num" style="color:#a5b4fc">${importance > 0 ? importance : '—'}</span>
</div>

<div class="dp-row">
  <span class="dp-rl">Tags</span>
  <span class="dp-rv">${tagsHtml}</span>
</div>

<div class="dp-row">
  <span class="dp-rl">Updated</span>
  <span class="dp-rv" style="color:${recencyColor}">${esc(date)}</span>
</div>

<div class="dp-row">
  <span class="dp-rl">Revision</span>
  <span class="dp-rv">${entry.revision ?? '—'}</span>
</div>

<div class="dp-row">
  <span class="dp-rl">Author</span>
  <span class="dp-rv">${esc(entry.updatedBy || '—')}</span>
</div>

${expiryHtml}

<details class="dp-raw-details">
  <summary class="dp-raw-toggle">Raw value</summary>
  <pre class="dp-raw-pre">${esc(value)}</pre>
</details>`;
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

// ── Detail Panel Public Action ─────────────────────────────────────────

function openDetail(key, entry) {
    if (!key || !entry) return;

    if (selectedKey && cy) {
        cy.$id(selectedKey).removeClass('selected');
    }

    selectedKey = key;
    focusedKey = key;
    lastFocusedKey = key;

    if (cy) {
        cy.$id(key).addClass('selected');
    }

    updateDetailPanelChrome(key, entry);
    updateDetailPanelBody(key, entry);
    showDetailPanel();

    renderIdentityPanel();
    applyFocusState();
}

// ── Close Action ───────────────────────────────────────────────────────

function closeActiveDetail() {
    if (selectedKey && cy) {
        cy.$id(selectedKey).removeClass('selected');
    }

    closeDetailPanel();

    selectedKey = null;
    focusedKey = null;
    hoverKey = null;

    updatePeekStrip(null);
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

function setupCloseButton() {
    const closeBtn = getDetailEl('dp-close');

    if (!closeBtn) return;

    closeBtn.addEventListener('click', closeActiveDetail);
}

// ── Event Setup ────────────────────────────────────────────────────────

setupCopyButton();
setupCloseButton();
