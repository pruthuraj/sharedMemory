'use strict';

// ── Peek Strip Constants ───────────────────────────────────────────────

const PEEK_VISIBLE_TAG_LIMIT = 4;
const NODE_TOOLTIP_VISIBLE_TAGS = 3;
const NODE_TOOLTIP_MARGIN = 16;

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

// ── Node Tooltip ───────────────────────────────────────────────────────

let nodeTooltipEl = null;

function getNodeTooltipEl() {
    if (!nodeTooltipEl) {
        nodeTooltipEl = document.getElementById('node-tooltip');
    }

    return nodeTooltipEl;
}

function buildTooltipHtml(key, entry, color) {
    const importance = Number(entry.importance) || 0;
    const tags = (entry.tags || []).slice(0, NODE_TOOLTIP_VISIBLE_TAGS);

    const tagsHtml = tags.length
        ? `<div class="nt-tags">${tags.map((t) => `<span class="nt-tag">${esc(t)}</span>`).join('')}</div>`
        : '';

    const impHtml = importance > 0
        ? `<span class="nt-imp">imp ${importance}</span>`
        : '';

    return `
<div class="nt-key">${esc(key)}</div>
${entry.summary ? `<div class="nt-summary">${esc(entry.summary)}</div>` : ''}
${(impHtml || tags.length) ? `<div class="nt-meta">${impHtml}<span>${ageLabel(entry.updatedAt)}</span></div>` : ''}
${tagsHtml}`.trim();
}

function showNodeTooltip(key, entry, renderedX, renderedY) {
    const el = getNodeTooltipEl();

    if (!el) return;

    const color = nodeIdentityColor(key);

    el.style.setProperty('--nt-color', color);
    el.innerHTML = buildTooltipHtml(key, entry, color);
    el.removeAttribute('hidden');

    positionNodeTooltip(el, renderedX, renderedY);
}

function positionNodeTooltip(el, x, y) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tipW = 260;
    const tipH = el.offsetHeight || 100;

    let left = x + NODE_TOOLTIP_MARGIN;
    let top = y - tipH / 2;

    if (left + tipW > vw - 8) left = x - tipW - NODE_TOOLTIP_MARGIN;
    if (top < 8) top = 8;
    if (top + tipH > vh - 8) top = vh - tipH - 8;

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
}

function hideNodeTooltip() {
    const el = getNodeTooltipEl();

    if (!el) return;

    el.setAttribute('hidden', '');
}

function moveNodeTooltip(renderedX, renderedY) {
    const el = getNodeTooltipEl();

    if (!el || el.hasAttribute('hidden')) return;

    positionNodeTooltip(el, renderedX, renderedY);
}

// ── Focus State ────────────────────────────────────────────────────────

function applyFocusState() {
    if (!cy) return;

    const key = focusedKey;

    cy.nodes().removeClass('dimmed selected hover-main related');
    cy.edges().removeClass('dimmed highlight');

    if (selectedKey) {
        cy.$id(selectedKey).addClass('selected');
    }

    if (!key) return;

    const distances = focusDistances(key);

    cy.nodes().forEach((node) => {
        const nodeKey = node.id();
        const distance = distances.get(nodeKey);

        if (nodeKey === selectedKey) node.addClass('selected');
        if (nodeKey === key) node.addClass('hover-main');
        if (distance !== undefined && nodeKey !== key) node.addClass('related');
        if (distance === undefined) node.addClass('dimmed');
    });

    cy.edges().forEach((edge) => {
        const fromDist = distances.get(edge.source().id());
        const toDist = distances.get(edge.target().id());

        if (fromDist !== undefined || toDist !== undefined) {
            edge.addClass('highlight');
        } else {
            edge.addClass('dimmed');
        }
    });
}
