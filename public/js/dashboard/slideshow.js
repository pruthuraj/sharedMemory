'use strict';

// ── Slideshow State ────────────────────────────────────────────────────

const SLIDESHOW_INTERVAL_MS = 4000;

let slideshowQueue   = [];
let slideshowIndex   = 0;
let slideshowTimer   = null;
let slideshowPaused  = false;
let slideshowBusy    = false;
let activeSlideshowKey = null;

// ── Pulse State ────────────────────────────────────────────────────────

let _pulseActive = false;
let _pulseKey    = null;

function startNodePulse(key) {
    _pulseActive = false; // stop previous loop
    _pulseKey    = key;
    if (!key || !cy) return;

    const node = cy.$id(key);
    if (!node.length) return;

    _pulseActive = true;

    function low() {
        if (!_pulseActive || _pulseKey !== key) return;
        node.animate(
            { style: { 'shadow-opacity': 0.38 } },
            { duration: 700, easing: 'ease-in-out', complete: high }
        );
    }
    function high() {
        if (!_pulseActive || _pulseKey !== key) return;
        node.animate(
            { style: { 'shadow-opacity': 0.95 } },
            { duration: 700, easing: 'ease-in-out', complete: low }
        );
    }
    low();
}

function stopNodePulse() {
    _pulseActive = false;
    _pulseKey    = null;
}

// ── Queue ──────────────────────────────────────────────────────────────

function rebuildSlideshowQueue() {
    slideshowQueue = Array.from(visibleNodeIds)
        .filter((k) => currentEntries[k])
        .sort((a, b) => {
            const am = isMainNode(a) ? 1 : 0;
            const bm = isMainNode(b) ? 1 : 0;
            if (am !== bm) return bm - am;
            return (currentEntries[b]?.importance || 0) - (currentEntries[a]?.importance || 0);
        });
    if (slideshowIndex >= slideshowQueue.length) slideshowIndex = 0;
}

// ── Highlight ──────────────────────────────────────────────────────────

function clearSlideshowHighlight() {
    stopNodePulse();
    if (activeSlideshowKey && cy) {
        cy.$id(activeSlideshowKey).removeClass('slideshow-active');
    }
    activeSlideshowKey = null;
}

function applySlideshowHighlight(key) {
    clearSlideshowHighlight();
    if (!key) return;
    activeSlideshowKey = key;
    if (cy) cy.$id(key).addClass('slideshow-active');
    startNodePulse(key);
}

// Gentle pan to the active slideshow node (no zoom change).
function panToActiveSlideshowNode(key) {
    if (!key || !cy) return;
    const node = cy.$id(key);
    if (!node.length) return;
    cy.animate({ center: { eles: node } }, { duration: 500, easing: 'ease-out' });
}

// ── Card Render ────────────────────────────────────────────────────────

function setEl(id, fn) {
    const el = document.getElementById(id);
    if (el) fn(el);
}

function renderSlideshowCard() {
    const key = slideshowQueue[slideshowIndex];
    if (!key) return;

    const entry      = currentEntries[key] || {};
    const catColor   = getCategoryColor(key);
    const accent     = getStableNodeColor(key);
    const importance = Math.max(0, Math.min(10, Number(entry.importance) || 0));
    const tags       = (entry.tags || []).slice(0, 3);
    const category   = getNodeCategory(key);

    const card = document.getElementById('slideshow-card');
    if (card) card.style.borderLeftColor = accent;

    setEl('ss-key', (el) => { el.textContent = key; el.style.color = accent; });
    setEl('ss-summary', (el) => { el.textContent = entry.summary || ''; });
    setEl('ss-imp', (el) => {
        el.textContent = importance > 0 ? `★ ${importance}` : '';
        el.style.color = accent;
    });
    setEl('ss-age', (el) => {
        el.textContent = entry.updatedAt ? ageLabel(entry.updatedAt) : '';
    });
    setEl('ss-category', (el) => {
        el.textContent = category;
        el.style.color = catColor;
    });
    setEl('ss-tags', (el) => {
        el.innerHTML = tags.map((t) => `<span class="ss-tag">${esc(t)}</span>`).join('');
    });
    setEl('ss-dots', (el) => {
        const cap = Math.min(slideshowQueue.length, 8);
        el.innerHTML = Array.from({ length: cap }, (_, i) =>
            `<span class="ss-dot${i === slideshowIndex % cap ? ' active' : ''}"></span>`
        ).join('');
    });

    applySlideshowHighlight(key);
    panToActiveSlideshowNode(key);
}

// ── Animation ──────────────────────────────────────────────────────────

function animateCard(dir, callback) {
    if (slideshowBusy) { callback(); return; }
    slideshowBusy = true;
    const card = document.getElementById('slideshow-card');
    if (!card) { callback(); slideshowBusy = false; return; }

    card.style.transition = 'opacity 140ms ease, transform 140ms ease';
    card.style.opacity    = '0';
    card.style.transform  = `translateX(${dir > 0 ? '10px' : '-10px'})`;

    window.setTimeout(() => {
        callback();
        card.style.transform = `translateX(${dir > 0 ? '-6px' : '6px'})`;
        requestAnimationFrame(() => {
            card.style.opacity   = '1';
            card.style.transform = 'translateX(0)';
            window.setTimeout(() => { slideshowBusy = false; }, 140);
        });
    }, 145);
}

// ── Navigation ─────────────────────────────────────────────────────────

function showSlide(index, dir) {
    if (!slideshowQueue.length) return;
    const n = slideshowQueue.length;
    slideshowIndex = ((index % n) + n) % n;
    animateCard(dir, renderSlideshowCard);
}

function slideshowNext() { showSlide(slideshowIndex + 1,  1); }
function slideshowPrev() { showSlide(slideshowIndex - 1, -1); }

// ── Timer ──────────────────────────────────────────────────────────────

function startSlideshowTimer() {
    stopSlideshowTimer();
    if (!slideshowPaused && slideshowQueue.length > 1) {
        slideshowTimer = window.setInterval(slideshowNext, SLIDESHOW_INTERVAL_MS);
    }
}

function stopSlideshowTimer() {
    if (!slideshowTimer) return;
    window.clearInterval(slideshowTimer);
    slideshowTimer = null;
}

function toggleSlideshowPause() {
    slideshowPaused = !slideshowPaused;
    setEl('ss-play-btn', (el) => { el.textContent = slideshowPaused ? '▶' : '⏸'; });
    slideshowPaused ? stopSlideshowTimer() : startSlideshowTimer();
}

// ── Focus Graph Node (click on card) ──────────────────────────────────

function focusSlideshowNodeInGraph() {
    const key = slideshowQueue[slideshowIndex];
    if (!key || !cy) return;
    const node = cy.$id(key);
    if (!node.length) return;
    cy.animate(
        { center: { eles: node }, zoom: Math.max(cy.zoom(), 1.4) },
        { duration: 550, easing: 'ease-in-out' }
    );
}

// ── Public Refresh ─────────────────────────────────────────────────────

function refreshSlideshow() {
    rebuildSlideshowQueue();
    const el = document.getElementById('node-slideshow');
    if (!el) return;

    if (!slideshowQueue.length) {
        el.classList.remove('visible');
        clearSlideshowHighlight();
        stopSlideshowTimer();
        return;
    }

    el.classList.add('visible');
    renderSlideshowCard();
    startSlideshowTimer();
}

// ── Init ───────────────────────────────────────────────────────────────

function initSlideshowBindings() {
    const card = document.getElementById('slideshow-card');
    if (card) {
        card.addEventListener('click', (e) => {
            if (!e.target.closest('.ss-controls')) focusSlideshowNodeInGraph();
        });
    }

    setEl('ss-prev-btn', (el) => {
        el.addEventListener('click', (e) => { e.stopPropagation(); slideshowPrev(); });
    });
    setEl('ss-next-btn', (el) => {
        el.addEventListener('click', (e) => { e.stopPropagation(); slideshowNext(); });
    });
    setEl('ss-play-btn', (el) => {
        el.addEventListener('click', (e) => { e.stopPropagation(); toggleSlideshowPause(); });
    });
}
