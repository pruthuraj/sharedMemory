'use strict';

// ── Constants ──────────────────────────────────────────────────────────
const NODE_W = 240;
const NODE_ROUND_MIN = 116;
const NODE_ROUND_MAX = 196;
const NODE_ROUND_GROWTH = 22;
const NODE_TRANSITION_MS = 280;
const RADIAL_RING_GAP = 220;
const LIVE_REFRESH_MS = 5000;
const DRAG_THRESHOLD_PX = 4;
const ZOOM_MIN = 0.08;
const ZOOM_MAX = 3;
const DEFAULT_WHEEL_ZOOM_INTENSITY = 0.0015;
const DEFAULT_BUTTON_ZOOM_STEP = 1.1;
const DEFAULT_FOCUS_MAX_DEPTH = 4;
const DASHBOARD_SETTINGS_KEY = 'sharedMemory.dashboard.settings.v1';
const expandedNodes = new Set();
const FOCUS_SCALE = [
    { color: '#f8fafc', opacity: 1, edgeOpacity: 0.95, ring: 3, glow: 30 },
    { color: '#22c55e', opacity: 0.96, edgeOpacity: 0.82, ring: 2, glow: 22 },
    { color: '#06b6d4', opacity: 0.78, edgeOpacity: 0.62, ring: 1.5, glow: 17 },
    { color: '#a855f7', opacity: 0.58, edgeOpacity: 0.43, ring: 1, glow: 12 },
    { color: '#f59e0b', opacity: 0.4, edgeOpacity: 0.3, ring: 1, glow: 8 },
];
const DEFAULT_GRAPH_SETTINGS = Object.freeze({
    focusDepth: DEFAULT_FOCUS_MAX_DEPTH,
    focusIntensity: 1,
    zoomSpeed: 1,
    edgeLabelMode: 'focus',
    liveRefresh: true,
    palette: 'aurora',
    customPalette: {
        appBg: '#05050e',
        panelBg: '#0f0f1e',
        surfaceBg: '#080810',
        surfaceBg2: '#0b0b14',
        borderColor: '#2d2d44',
        accent: '#6366f1',
        accent2: '#22c55e',
    },
});

const COLOR_PALETTES = {
    aurora: {
        label: 'Aurora',
        vars: {
            appBg: '#05050e',
            gridColor: '#12122a',
            panelBg: '#0f0f1e',
            surfaceBg: '#080810',
            surfaceBg2: '#0b0b14',
            borderColor: '#2d2d44',
            accent: '#6366f1',
            accent2: '#22c55e',
        },
    },
    ocean: {
        label: 'Ocean',
        vars: {
            appBg: '#061018',
            gridColor: '#12304a',
            panelBg: '#0d1720',
            surfaceBg: '#08131b',
            surfaceBg2: '#0b1a26',
            borderColor: '#23435c',
            accent: '#06b6d4',
            accent2: '#3b82f6',
        },
    },
    ember: {
        label: 'Ember',
        vars: {
            appBg: '#130906',
            gridColor: '#3a1a14',
            panelBg: '#1a1110',
            surfaceBg: '#150d0c',
            surfaceBg2: '#1e1210',
            borderColor: '#4d2a25',
            accent: '#f97316',
            accent2: '#ef4444',
        },
    },
    forest: {
        label: 'Forest',
        vars: {
            appBg: '#07110d',
            gridColor: '#163126',
            panelBg: '#0e1814',
            surfaceBg: '#09120f',
            surfaceBg2: '#0d1a16',
            borderColor: '#224035',
            accent: '#22c55e',
            accent2: '#84cc16',
        },
    },
    mono: {
        label: 'Mono',
        vars: {
            appBg: '#0a0a0a',
            gridColor: '#202020',
            panelBg: '#111111',
            surfaceBg: '#121212',
            surfaceBg2: '#161616',
            borderColor: '#343434',
            accent: '#e5e7eb',
            accent2: '#9ca3af',
        },
    },
};

const RELATION_COLOR_PRESETS = {
    aurora: {
        related_to: '#6366f1',
        depends_on: '#f59e0b',
        supports: '#22c55e',
        contradicts: '#ef4444',
        mentions: '#06b6d4',
        derived_from: '#a855f7',
        next_step: '#f97316',
    },
    ocean: {
        related_to: '#38bdf8',
        depends_on: '#60a5fa',
        supports: '#14b8a6',
        contradicts: '#f43f5e',
        mentions: '#22d3ee',
        derived_from: '#818cf8',
        next_step: '#0ea5e9',
    },
    ember: {
        related_to: '#fb7185',
        depends_on: '#fb923c',
        supports: '#f97316',
        contradicts: '#ef4444',
        mentions: '#f59e0b',
        derived_from: '#c084fc',
        next_step: '#fdba74',
    },
    forest: {
        related_to: '#4ade80',
        depends_on: '#84cc16',
        supports: '#22c55e',
        contradicts: '#f87171',
        mentions: '#10b981',
        derived_from: '#34d399',
        next_step: '#a3e635',
    },
    mono: {
        related_to: '#e5e7eb',
        depends_on: '#cbd5e1',
        supports: '#94a3b8',
        contradicts: '#9ca3af',
        mentions: '#d1d5db',
        derived_from: '#f3f4f6',
        next_step: '#6b7280',
    },
};

let relationColors = { ...RELATION_COLOR_PRESETS.aurora };

// ── State ──────────────────────────────────────────────────────────────
let ws = null;
let currentEntries = {};
let currentEdges = [];
let nodePositions = {};
let scale = 1, panX = 0, panY = 0;
let isPanning = false, panStartX = 0, panStartY = 0, panStartPanX = 0, panStartPanY = 0;
let nodeDrag = null;
let suppressClickKey = null;
let selectedKey = null;
let focusedKey = null;
let lastFocusedKey = null;
let liveRefreshTimer = null;
let refreshQueued = false;
let nextRpcId = 1;
let graphSettings = loadGraphSettings();
const subscribedKeys = new Set();
const pending = {};
const msgQueue = [];

// ── DOM refs ───────────────────────────────────────────────────────────
const viewport = document.getElementById('viewport');
const scene = document.getElementById('scene');
const edgesSvg = document.getElementById('edges-svg');
const detailPanel = document.getElementById('detail-panel');
const tokenInput = document.getElementById('token-input');
const connectBtn = document.getElementById('connect-btn');
const refreshBtn = document.getElementById('refresh-btn');
const statusText = document.getElementById('status-text');
const emptyState = document.getElementById('empty-state');
const loadingEl = document.getElementById('loading');
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const settingsClose = document.getElementById('settings-close');
const settingsSummary = document.getElementById('settings-summary');
const settingZoomSpeed = document.getElementById('setting-zoom-speed');
const settingZoomSpeedValue = document.getElementById('setting-zoom-speed-value');
const settingFocusDepth = document.getElementById('setting-focus-depth');
const settingFocusDepthValue = document.getElementById('setting-focus-depth-value');
const settingFocusIntensity = document.getElementById('setting-focus-intensity');
const settingFocusIntensityValue = document.getElementById('setting-focus-intensity-value');
const settingEdgeLabels = document.getElementById('setting-edge-labels');
const settingEdgeLabelsValue = document.getElementById('setting-edge-labels-value');
const settingLiveRefresh = document.getElementById('setting-live-refresh');
const paletteOptions = document.getElementById('palette-options');
const customPaletteControls = document.getElementById('custom-palette-controls');
const settingCustomBg = document.getElementById('setting-custom-bg');
const settingCustomSurface = document.getElementById('setting-custom-surface');
const settingCustomAccent = document.getElementById('setting-custom-accent');
const fitFocusedBtn = document.getElementById('fit-focused-btn');
const resetSettingsBtn = document.getElementById('reset-settings-btn');

// ── Helpers ────────────────────────────────────────────────────────────
function esc(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function normalizeHexColor(value, fallback) {
    return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function normalizeEdgeLabelMode(value, fallback = DEFAULT_GRAPH_SETTINGS.edgeLabelMode) {
    return ['focus', 'always', 'off'].includes(value) ? value : fallback;
}

function paletteVars(name, customPalette = {}) {
    const preset = COLOR_PALETTES[name] || COLOR_PALETTES.aurora;
    if (name !== 'custom') return preset.vars;

    return {
        appBg: normalizeHexColor(customPalette.appBg, DEFAULT_GRAPH_SETTINGS.customPalette.appBg),
        gridColor: normalizeHexColor(customPalette.gridColor, '#12122a'),
        panelBg: normalizeHexColor(customPalette.panelBg, DEFAULT_GRAPH_SETTINGS.customPalette.panelBg),
        surfaceBg: normalizeHexColor(customPalette.surfaceBg, DEFAULT_GRAPH_SETTINGS.customPalette.surfaceBg),
        surfaceBg2: normalizeHexColor(customPalette.surfaceBg2, DEFAULT_GRAPH_SETTINGS.customPalette.surfaceBg2),
        borderColor: normalizeHexColor(customPalette.borderColor, DEFAULT_GRAPH_SETTINGS.customPalette.borderColor),
        accent: normalizeHexColor(customPalette.accent, DEFAULT_GRAPH_SETTINGS.customPalette.accent),
        accent2: normalizeHexColor(customPalette.accent2, DEFAULT_GRAPH_SETTINGS.customPalette.accent2),
    };
}

function relationPalette(name, customPalette = {}) {
    if (name !== 'custom') {
        return { ...(RELATION_COLOR_PRESETS[name] || RELATION_COLOR_PRESETS.aurora) };
    }

    const accent = normalizeHexColor(customPalette.accent, DEFAULT_GRAPH_SETTINGS.customPalette.accent);
    const accent2 = normalizeHexColor(customPalette.accent2, DEFAULT_GRAPH_SETTINGS.customPalette.accent2);
    return {
        related_to: accent,
        depends_on: accent2,
        supports: '#22c55e',
        contradicts: '#ef4444',
        mentions: '#06b6d4',
        derived_from: '#a855f7',
        next_step: '#f97316',
    };
}

function loadGraphSettings() {
    try {
        const parsed = JSON.parse(localStorage.getItem(DASHBOARD_SETTINGS_KEY) || '{}');
        const customPalette = parsed.customPalette && typeof parsed.customPalette === 'object'
            ? parsed.customPalette
            : {};
        return {
            focusDepth: Math.round(clampNumber(parsed.focusDepth, 1, 6, DEFAULT_GRAPH_SETTINGS.focusDepth)),
            focusIntensity: clampNumber(parsed.focusIntensity, 0.6, 1.4, DEFAULT_GRAPH_SETTINGS.focusIntensity),
            zoomSpeed: clampNumber(parsed.zoomSpeed, 0.5, 2.5, DEFAULT_GRAPH_SETTINGS.zoomSpeed),
            edgeLabelMode: normalizeEdgeLabelMode(parsed.edgeLabelMode, parsed.edgeLabels === false ? 'off' : 'focus'),
            liveRefresh: parsed.liveRefresh !== false,
            palette: COLOR_PALETTES[parsed.palette] ? parsed.palette : 'aurora',
            customPalette: {
                appBg: normalizeHexColor(customPalette.appBg, DEFAULT_GRAPH_SETTINGS.customPalette.appBg),
                panelBg: normalizeHexColor(customPalette.panelBg, DEFAULT_GRAPH_SETTINGS.customPalette.panelBg),
                surfaceBg: normalizeHexColor(customPalette.surfaceBg, DEFAULT_GRAPH_SETTINGS.customPalette.surfaceBg),
                surfaceBg2: normalizeHexColor(customPalette.surfaceBg2, DEFAULT_GRAPH_SETTINGS.customPalette.surfaceBg2),
                borderColor: normalizeHexColor(customPalette.borderColor, DEFAULT_GRAPH_SETTINGS.customPalette.borderColor),
                accent: normalizeHexColor(customPalette.accent, DEFAULT_GRAPH_SETTINGS.customPalette.accent),
                accent2: normalizeHexColor(customPalette.accent2, DEFAULT_GRAPH_SETTINGS.customPalette.accent2),
            },
        };
    } catch {
        return { ...DEFAULT_GRAPH_SETTINGS };
    }
}

function saveGraphSettings() {
    try {
        localStorage.setItem(DASHBOARD_SETTINGS_KEY, JSON.stringify(graphSettings));
    } catch { }
}

function applyPaletteTheme() {
    const vars = paletteVars(graphSettings.palette, graphSettings.customPalette);
    relationColors = relationPalette(graphSettings.palette, graphSettings.customPalette);
    const root = document.documentElement.style;
    root.setProperty('--app-bg', vars.appBg);
    root.setProperty('--grid-color', vars.gridColor);
    root.setProperty('--panel-bg', vars.panelBg);
    root.setProperty('--surface-bg', vars.surfaceBg);
    root.setProperty('--surface-bg-2', vars.surfaceBg2);
    root.setProperty('--border-color', vars.borderColor);
    root.setProperty('--accent', vars.accent);
    root.setProperty('--accent-2', vars.accent2);
    rerenderEdgesForCurrentPositions();
}

function applyGraphSettings(options = {}) {
    document.body.classList.toggle('edge-labels-focus', graphSettings.edgeLabelMode === 'focus');
    document.body.classList.toggle('edge-labels-always', graphSettings.edgeLabelMode === 'always');
    document.body.classList.toggle('edge-labels-off', graphSettings.edgeLabelMode === 'off');
    applyPaletteTheme();
    syncSettingsControls();
    if (!options.skipSave) saveGraphSettings();

    if (graphSettings.liveRefresh) {
        if (ws && ws.readyState === WebSocket.OPEN && !liveRefreshTimer) startLiveRefresh();
    } else {
        stopLiveRefresh();
    }

    if (selectedKey) applyRadialFocusLayout(selectedKey);
    else applyFocusState();
}

function syncPaletteControls() {
    const paletteKeys = Object.keys(COLOR_PALETTES);
    paletteOptions.innerHTML = paletteKeys.map((key) => {
        const palette = COLOR_PALETTES[key];
        const checked = graphSettings.palette === key ? 'checked' : '';
        return `
      <label class="palette-option">
        <input type="radio" name="palette-mode" value="${key}" ${checked} />
        <span class="palette-swatch" style="background:${palette.vars.accent}"></span>
        <span>${palette.label}</span>
      </label>
    `;
    }).join('');

    customPaletteControls.classList.toggle('visible', graphSettings.palette === 'custom');
    settingCustomBg.value = graphSettings.customPalette.appBg;
    settingCustomSurface.value = graphSettings.customPalette.panelBg;
    settingCustomAccent.value = graphSettings.customPalette.accent;
}

function dimmedNodeOpacity() {
    return Math.max(0.08, 0.3 - graphSettings.focusIntensity * 0.11);
}

function dimmedEdgeOpacity() {
    return Math.max(0.06, 0.2 - graphSettings.focusIntensity * 0.07);
}

function zoomButtonFactor() {
    return 1 + (DEFAULT_BUTTON_ZOOM_STEP - 1) * graphSettings.zoomSpeed;
}

function ageColor(ts) {
    const ms = Date.now() - ts;
    if (ms < 3_600_000) return '#10b981';
    if (ms < 86_400_000) return '#6366f1';
    return '#475569';
}

function ageLabel(ts) {
    const ms = Date.now() - ts;
    if (ms < 60_000) return 'just now';
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
}

function setStatus(msg, cls = '') {
    statusText.textContent = msg;
    statusText.className = cls;
}

function nodeHeight(entry) {
    let h = 62;
    if (entry.tags && entry.tags.length) h += 22;
    if (entry.importance > 0) h += 18;
    return h;
}

function nodeDegree(key) {
    let degree = 0;
    for (const edge of currentEdges) {
        if (edge.from === key || edge.to === key) degree += 1;
    }
    return degree;
}

function collapsedNodeSize(key) {
    const degree = nodeDegree(key);
    const size = NODE_ROUND_MIN + Math.sqrt(degree) * NODE_ROUND_GROWTH;
    return Math.round(Math.min(NODE_ROUND_MAX, size));
}

function nodeVisualBox(key, pos, entry = currentEntries[key]) {
    const slotHeight = nodeHeight(entry || {});
    const expanded = expandedNodes.has(key);
    const roundSize = collapsedNodeSize(key);
    const w = expanded ? NODE_W : roundSize;
    const h = expanded ? slotHeight : roundSize;
    return {
        x: pos.x + (NODE_W - w) / 2,
        y: pos.y + (slotHeight - h) / 2,
        w,
        h,
    };
}

function applyNodePlacement(nodeEl, key) {
    const pos = nodePositions[key];
    const entry = currentEntries[key];
    if (!pos || !entry) return;

    const box = nodeVisualBox(key, pos, entry);
    nodeEl.style.left = `${box.x}px`;
    nodeEl.style.top = `${box.y}px`;
    nodeEl.style.setProperty('--node-w', `${box.w}px`);
    nodeEl.style.setProperty('--node-h', `${box.h}px`);
    nodeEl.style.setProperty('--node-degree', String(nodeDegree(key)));
}

function setSlotCenter(key, centerX, centerY) {
    const pos = nodePositions[key];
    const entry = currentEntries[key];
    if (!pos || !entry) return;

    pos.x = centerX - NODE_W / 2;
    pos.y = centerY - nodeHeight(entry) / 2;
}

function svgEl(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

function makeRequestId(prefix) {
    nextRpcId += 1;
    return `__${prefix}_${Date.now()}_${nextRpcId}__`;
}

function edgeKey(edge) {
    return `${edge.from}\u001f${edge.relation}\u001f${edge.to}`;
}

function edgeTouches(edge, key) {
    return edge.from === key || edge.to === key;
}

function focusStyle(distance) {
    return FOCUS_SCALE[Math.min(distance, FOCUS_SCALE.length - 1)];
}

function focusDistances(rootKey) {
    const distances = new Map();
    if (!rootKey || !currentEntries[rootKey]) return distances;

    const adjacency = new Map();
    for (const key of Object.keys(currentEntries)) adjacency.set(key, new Set());

    for (const edge of currentEdges) {
        if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
        adjacency.get(edge.from).add(edge.to);
        adjacency.get(edge.to).add(edge.from);
    }

    distances.set(rootKey, 0);
    const queue = [rootKey];
    for (let i = 0; i < queue.length; i += 1) {
        const current = queue[i];
        const distance = distances.get(current);
        if (distance >= graphSettings.focusDepth) continue;

        const neighbors = Array.from(adjacency.get(current) || []).sort();
        for (const neighbor of neighbors) {
            if (distances.has(neighbor)) continue;
            distances.set(neighbor, distance + 1);
            queue.push(neighbor);
        }
    }

    return distances;
}

function relationLabelBetween(sourceKey, targetKey) {
    const edge = currentEdges.find(candidate =>
        (candidate.from === sourceKey && candidate.to === targetKey) ||
        (candidate.from === targetKey && candidate.to === sourceKey)
    );
    return edge ? edge.relation.replace(/_/g, ' ') : '';
}

function applyMiniDetail(node, distance, rootKey) {
    node.classList.remove('focus-root', 'near-detail', 'mid-detail', 'far-detail', 'unrelated-detail');
    const relationEl = node.querySelector('.node-mini-relation');
    if (relationEl) relationEl.textContent = '';

    if (!rootKey) return;

    if (distance === undefined) {
        node.classList.add('unrelated-detail');
    } else if (distance === 0) {
        node.classList.add('focus-root');
    } else if (distance === 1) {
        node.classList.add('near-detail');
    } else if (distance === 2) {
        node.classList.add('mid-detail');
    } else {
        node.classList.add('far-detail');
    }

    if (relationEl) {
        relationEl.textContent = distance === 1 ? relationLabelBetween(node.dataset.key, rootKey) : '';
    }
}

function resetNodeChrome(node, key) {
    const color = ageColor(currentEntries[key]?.updatedAt || 0);
    node.style.opacity = '';
    node.style.borderColor = `${color}44`;
    node.style.boxShadow = '0 2px 14px #00000055';
}

function applyNodeFocusChrome(node, distance) {
    const style = focusStyle(distance);
    const intensity = graphSettings.focusIntensity;
    const opacity = distance === 0
        ? 1
        : Math.max(0.2, Math.min(1, style.opacity + (1 - intensity) * 0.12));
    const ring = Math.max(1, style.ring * intensity);
    const glow = Math.max(4, style.glow * intensity);
    node.style.opacity = String(opacity);
    node.style.borderColor = `${style.color}bb`;
    node.style.boxShadow =
        `0 0 0 ${ring}px ${style.color}44, 0 0 ${glow}px ${style.color}33, 0 4px 24px #00000088`;
}

function resetEdgeChrome(group) {
    group.style.opacity = '';
    group.style.filter = '';
    for (const path of group.querySelectorAll('path')) path.setAttribute('stroke-opacity', '0.6');
    for (const text of group.querySelectorAll('text')) text.setAttribute('opacity', '0.9');
    for (const rect of group.querySelectorAll('rect')) rect.setAttribute('opacity', '0.88');
}

function applyEdgeFocusChrome(group, distance) {
    const style = focusStyle(distance);
    const intensity = graphSettings.focusIntensity;
    const edgeOpacity = Math.max(0.18, Math.min(0.98, style.edgeOpacity + (1 - intensity) * 0.1));
    group.style.opacity = String(edgeOpacity);
    group.style.filter = `drop-shadow(0 0 ${Math.max(4, (style.glow * intensity) / 3)}px ${style.color}99)`;
    for (const path of group.querySelectorAll('path')) path.setAttribute('stroke-opacity', String(edgeOpacity));
    for (const text of group.querySelectorAll('text')) text.setAttribute('opacity', String(Math.min(0.95, edgeOpacity + 0.16)));
    for (const rect of group.querySelectorAll('rect')) rect.setAttribute('opacity', String(Math.min(0.9, edgeOpacity + 0.2)));
}

function sameJson(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function updateLegend() {
    const keys = Object.keys(currentEntries);
    document.getElementById('ld-nodes').querySelector('span:last-child').textContent =
        `${keys.length} ${keys.length === 1 ? 'node' : 'nodes'}`;
    document.getElementById('ld-edges').querySelector('span:last-child').textContent =
        `${currentEdges.length} ${currentEdges.length === 1 ? 'edge' : 'edges'}`;
}

function updateStatusCount() {
    const nc = Object.keys(currentEntries).length;
    const ec = currentEdges.length;
    setStatus(`${nc} nodes · ${ec} edges`, 'ok');
}

function clampScale(value) {
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value));
}

// ── Layout ─────────────────────────────────────────────────────────────
function computeLayout(entries, edges) {
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setGraph({ rankdir: 'LR', ranksep: 90, nodesep: 20, marginx: 60, marginy: 60 });
    g.setDefaultEdgeLabel(() => ({}));

    for (const [key, entry] of Object.entries(entries)) {
        g.setNode(key, { width: NODE_W, height: nodeHeight(entry) });
    }

    const seen = new Set();
    for (const edge of edges) {
        if (!entries[edge.from] || !entries[edge.to]) continue;
        const id = `${edge.from}||${edge.relation}||${edge.to}`;
        if (seen.has(id)) continue;
        seen.add(id);
        g.setEdge(edge.from, edge.to, {}, id);
    }

    dagre.layout(g);

    const positions = {};
    for (const key of g.nodes()) {
        const n = g.node(key);
        if (n) positions[key] = { x: n.x - n.width / 2, y: n.y - n.height / 2, w: n.width, h: n.height };
    }
    return positions;
}

function setNodePresentation(key, nodeEl) {
    const isExpanded = expandedNodes.has(key);
    nodeEl.classList.toggle('expanded', isExpanded);
    nodeEl.classList.toggle('round', !isExpanded);
    nodeEl.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    applyNodePlacement(nodeEl, key);
}

// Toggle node between round and expanded state with animation.
function toggleNodeExpanded(key, nodeEl) {
    if (expandedNodes.has(key)) {
        expandedNodes.delete(key);
    } else {
        expandedNodes.add(key);
    }

    setNodePresentation(key, nodeEl);
    rerenderEdgesForCurrentPositions();
    window.setTimeout(rerenderEdgesForCurrentPositions, NODE_TRANSITION_MS);
}

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
    lastFocusedKey = null;
    detailPanel.classList.remove('visible');
    if (options.resetLayout) resetToComputedLayout();
    else applyFocusState();
}

function radialRingRadius(distance, keys) {
    const maxSize = keys.reduce((largest, key) => Math.max(largest, nodeVisualBox(key, nodePositions[key]).w), 0);
    const circumferenceRadius = (keys.length * Math.max(maxSize + 64, 150)) / (Math.PI * 2);
    return Math.max(RADIAL_RING_GAP * distance, circumferenceRadius + RADIAL_RING_GAP * (distance - 1) * 0.35);
}

function applyRadialFocusLayout(rootKey) {
    if (!rootKey || !nodePositions[rootKey] || !currentEntries[rootKey]) return;

    const rootBox = nodeVisualBox(rootKey, nodePositions[rootKey]);
    const centerX = rootBox.x + rootBox.w / 2;
    const centerY = rootBox.y + rootBox.h / 2;
    const distances = focusDistances(rootKey);
    const outerDistance = graphSettings.focusDepth + 1;
    const groups = new Map();

    for (const key of Object.keys(currentEntries).sort()) {
        const distance = key === rootKey ? 0 : (distances.has(key) ? distances.get(key) : outerDistance);
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
    const color = ageColor(entry.updatedAt);
    const isExpanded = expandedNodes.has(key);

    const div = document.createElement('div');
    div.className = `mem-node ${isExpanded ? 'expanded' : 'round'}`;
    div.dataset.key = key;
    div.setAttribute('role', 'button');
    div.setAttribute('tabindex', '0');
    div.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    div.setAttribute('aria-label', `${key} memory node`);
    div.style.cssText = `border:1.5px solid ${color}44;box-shadow:0 2px 14px #00000055;`;

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
    <div class="node-age" style="color:${color}">${ageLabel(entry.updatedAt)}</div>
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
    div.addEventListener('mouseleave', () => {
        if (selectedKey !== key) clearFocusKey();
    });

    return div;
}

function setFocusKey(key) {
    focusedKey = key;
    lastFocusedKey = key;
    applyFocusState();
}

function clearFocusKey() {
    focusedKey = selectedKey;
    applyFocusState();
}

function applyFocusState() {
    const key = focusedKey;
    const distances = key ? focusDistances(key) : new Map();

    for (const node of scene.querySelectorAll('.mem-node')) {
        const nodeKey = node.dataset.key;
        const distance = distances.get(nodeKey);
        const inFocus = Boolean(key) && distance !== undefined;
        applyMiniDetail(node, Boolean(key) ? distance : undefined, key);
        node.classList.toggle('dimmed', Boolean(key) && !inFocus);
        node.classList.toggle('related', inFocus && distance > 0);
        node.classList.toggle('selected', selectedKey === nodeKey);
        if (inFocus) applyNodeFocusChrome(node, distance);
        else {
            resetNodeChrome(node, nodeKey);
            if (key) node.style.opacity = String(dimmedNodeOpacity());
        }
    }

    for (const group of edgesSvg.querySelectorAll('.edge-group')) {
        resetEdgeChrome(group);
        const fromDistance = distances.get(group.dataset.from);
        const toDistance = distances.get(group.dataset.to);
        const inFocus = Boolean(key) && fromDistance !== undefined && toDistance !== undefined;
        group.classList.toggle('dimmed', Boolean(key) && !inFocus);
        group.classList.toggle('highlight', inFocus);
        if (inFocus) applyEdgeFocusChrome(group, Math.max(fromDistance, toDistance));
        else if (key) group.style.opacity = String(dimmedEdgeOpacity());
    }
}

// ── Edge rendering ─────────────────────────────────────────────────────
function renderEdges(edges, positions, entries) {
    while (edgesSvg.firstChild) edgesSvg.removeChild(edgesSvg.firstChild);

    // Arrow markers
    const defs = svgEl('defs');
    for (const [rel, color] of Object.entries(relationColors)) {
        const m = svgEl('marker');
        m.setAttribute('id', `arr-${rel}`);
        m.setAttribute('markerWidth', '8');
        m.setAttribute('markerHeight', '6');
        m.setAttribute('refX', '7');
        m.setAttribute('refY', '3');
        m.setAttribute('orient', 'auto');
        const poly = svgEl('polygon');
        poly.setAttribute('points', '0 0, 8 3, 0 6');
        poly.setAttribute('fill', color);
        poly.setAttribute('opacity', '0.75');
        m.appendChild(poly);
        defs.appendChild(m);
    }
    edgesSvg.appendChild(defs);

    for (const edge of edges) {
        const sourceSlot = positions[edge.from];
        const targetSlot = positions[edge.to];
        if (!sourceSlot || !targetSlot) continue;

        const sp = nodeVisualBox(edge.from, sourceSlot, entries[edge.from]);
        const tp = nodeVisualBox(edge.to, targetSlot, entries[edge.to]);

        const color = relationColors[edge.relation] || relationColors.related_to || '#6366f1';
        const sw = (1.5 + (edge.weight || 0) * 2.5).toFixed(2);

        const sx = sp.x + sp.w;
        const sy = sp.y + sp.h / 2;
        const tx = tp.x;
        const ty = tp.y + tp.h / 2;
        const dx = Math.max(Math.abs(tx - sx) * 0.45, 48);
        const d = `M ${sx} ${sy} C ${sx + dx} ${sy} ${tx - dx} ${ty} ${tx} ${ty}`;

        const g = svgEl('g');
        g.classList.add('edge-group');
        g.dataset.from = edge.from;
        g.dataset.to = edge.to;
        g.dataset.relation = edge.relation;

        const path = svgEl('path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', sw);
        path.setAttribute('stroke-opacity', '0.6');
        path.setAttribute('marker-end', `url(#arr-${edge.relation})`);
        g.appendChild(path);

        // Label at bezier midpoint
        const mx = (sx + tx) / 2;
        const my = (sy + ty) / 2;

        const labelText = edge.relation.replace(/_/g, ' ');
        const labelWidth = Math.max(72, labelText.length * 6 + 18);

        const bg = svgEl('rect');
        bg.classList.add('edge-label-bg');
        bg.setAttribute('x', String(mx - labelWidth / 2));
        bg.setAttribute('y', String(my - 10));
        bg.setAttribute('width', String(labelWidth));
        bg.setAttribute('height', '18');
        bg.setAttribute('rx', '5');
        bg.setAttribute('fill', '#05050e');
        bg.setAttribute('opacity', '0.94');
        g.appendChild(bg);

        const lbl = svgEl('text');
        lbl.classList.add('edge-label-text');
        lbl.setAttribute('x', String(mx));
        lbl.setAttribute('y', String(my + 1));
        lbl.setAttribute('text-anchor', 'middle');
        lbl.setAttribute('dominant-baseline', 'middle');
        lbl.setAttribute('font-size', '10');
        lbl.setAttribute('fill', color);
        lbl.setAttribute('font-family', 'system-ui, sans-serif');
        lbl.setAttribute('font-weight', '700');
        lbl.setAttribute('opacity', '0.9');
        lbl.textContent = labelText;
        g.appendChild(lbl);

        edgesSvg.appendChild(g);
    }
}

// ── Graph render ───────────────────────────────────────────────────────
function mergePreservedPositions(nextPositions, previousPositions) {
    const merged = {};
    for (const [key, pos] of Object.entries(nextPositions)) {
        merged[key] = previousPositions[key]
            ? { ...pos, x: previousPositions[key].x, y: previousPositions[key].y }
            : pos;
    }
    return merged;
}

function sizeSceneToPositions(positions) {
    let maxX = 0, maxY = 0;
    for (const [key, p] of Object.entries(positions)) {
        const box = nodeVisualBox(key, p);
        maxX = Math.max(maxX, box.x + box.w);
        maxY = Math.max(maxY, box.y + box.h);
    }
    edgesSvg.setAttribute('width', maxX + 80);
    edgesSvg.setAttribute('height', maxY + 80);
}

function rerenderEdgesForCurrentPositions() {
    sizeSceneToPositions(nodePositions);
    renderEdges(currentEdges, nodePositions, currentEntries);
    applyFocusState();
}

function renderGraph(entries, edges, options = {}) {
    const previousSelected = options.preserveSelection ? selectedKey : null;
    const previousPositions = options.preservePositions ? nodePositions : {};
    for (const el of scene.querySelectorAll('.mem-node')) el.remove();
    selectedKey = null;
    focusedKey = null;
    lastFocusedKey = null;
    detailPanel.classList.remove('visible');

    const keys = Object.keys(entries);
    for (const key of Array.from(expandedNodes)) {
        if (!entries[key]) expandedNodes.delete(key);
    }
    emptyState.classList.toggle('visible', keys.length === 0);
    updateLegend();

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
    collapseOtherNodes(key);

    // Deselect previous
    if (selectedKey) {
        const prev = scene.querySelector(`[data-key="${CSS.escape(selectedKey)}"]`);
        if (prev) {
            const c = ageColor(currentEntries[selectedKey]?.updatedAt || 0);
            prev.style.borderColor = `${c}44`;
            prev.style.boxShadow = '0 2px 14px #00000055';
        }
    }

    selectedKey = key;
    focusedKey = key;
    lastFocusedKey = key;
    const color = ageColor(entry.updatedAt);

    const nodeEl = scene.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (nodeEl) {
        nodeEl.classList.add('selected');
        nodeEl.style.borderColor = color;
        nodeEl.style.boxShadow = `0 0 0 3px ${color}33, 0 4px 24px #00000077`;
    }

    applyRadialFocusLayout(key);

    document.getElementById('dp-bar').style.background = `linear-gradient(90deg, ${color}, ${color}44)`;
    document.getElementById('dp-label').style.color = color;
    document.getElementById('dp-label').textContent = 'Memory Entry';
    detailPanel.style.borderColor = `${color}44`;

    const val = typeof entry.value === 'object'
        ? JSON.stringify(entry.value, null, 2)
        : String(entry.value ?? '');

    const tagsHtml = entry.tags && entry.tags.length
        ? `<div class="dp-tags">${entry.tags.map(t => `<span class="dp-tag">${esc(t)}</span>`).join('')}</div>`
        : '<span style="color:#374151">—</span>';

    const date = entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : '—';
    const age = entry.updatedAt ? ageLabel(entry.updatedAt) : '';
    const exp = entry.expiresAt
        ? `<div class="dp-row"><span class="dp-rl">Expires</span><span class="dp-rv" style="color:#f59e0b">${new Date(entry.expiresAt).toLocaleString()}</span></div>`
        : '';

    document.getElementById('dp-body').innerHTML = `
<div class="dp-key">${esc(key)}</div>
<div class="dp-ts" style="color:${color}">${esc(date)}${age ? ` · ${esc(age)}` : ''}</div>
<div class="dp-value">${esc(val)}</div>
<div class="dp-row"><span class="dp-rl">Summary</span><span class="dp-rv">${esc(entry.summary || '—')}</span></div>
<div class="dp-row"><span class="dp-rl">Tags</span><span class="dp-rv">${tagsHtml}</span></div>
<div class="dp-row"><span class="dp-rl">Importance</span><span class="dp-rv" style="color:#a5b4fc">${entry.importance ?? '—'}</span></div>
<div class="dp-row"><span class="dp-rl">Revision</span><span class="dp-rv">${entry.revision ?? '—'}</span></div>
<div class="dp-row"><span class="dp-rl">Updated by</span><span class="dp-rv">${esc(entry.updatedBy || '—')}</span></div>
${exp}`;

    detailPanel.classList.add('visible');
    applyFocusState();
}

document.getElementById('dp-close').addEventListener('click', () => {
    if (selectedKey) {
        const el = scene.querySelector(`[data-key="${CSS.escape(selectedKey)}"]`);
        if (el) {
            const c = ageColor(currentEntries[selectedKey]?.updatedAt || 0);
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
function applyTransform() {
    scene.style.transform = `translate(${panX}px,${panY}px) scale(${scale})`;
    viewport.style.backgroundSize = `${32 * scale}px ${32 * scale}px`;
    viewport.style.backgroundPosition = `${panX}px ${panY}px`;
}

function zoomAt(viewportX, viewportY, nextScale) {
    const newScale = clampScale(nextScale);
    const sx = (viewportX - panX) / scale;
    const sy = (viewportY - panY) / scale;
    scale = newScale;
    panX = viewportX - sx * scale;
    panY = viewportY - sy * scale;
    applyTransform();
}

function zoomAtCenter(nextScale) {
    zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, nextScale);
}

function beginNodeDrag(e, key, nodeEl) {
    if (e.button !== 0 || !nodePositions[key]) return;
    e.stopPropagation();

    const pos = nodePositions[key];
    nodeDrag = {
        key,
        nodeEl,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: pos.x,
        startY: pos.y,
        moved: false,
    };
    nodeEl.setPointerCapture(e.pointerId);
}

function moveDraggedNode(e) {
    if (!nodeDrag) return;

    const clientDx = e.clientX - nodeDrag.startClientX;
    const clientDy = e.clientY - nodeDrag.startClientY;
    const movedEnough = Math.hypot(clientDx, clientDy) >= DRAG_THRESHOLD_PX;
    if (!nodeDrag.moved && !movedEnough) return;

    nodeDrag.moved = true;
    nodeDrag.nodeEl.classList.add('dragging');
    const pos = nodePositions[nodeDrag.key];
    pos.x = nodeDrag.startX + clientDx / scale;
    pos.y = nodeDrag.startY + clientDy / scale;
    applyNodePlacement(nodeDrag.nodeEl, nodeDrag.key);
    rerenderEdgesForCurrentPositions();
    e.preventDefault();
}

function endNodeDrag(e) {
    if (!nodeDrag) return false;

    const wasMoved = nodeDrag.moved;
    try {
        nodeDrag.nodeEl.releasePointerCapture(nodeDrag.pointerId);
    } catch { }
    nodeDrag.nodeEl.classList.remove('dragging');
    if (wasMoved) suppressClickKey = nodeDrag.key;
    nodeDrag = null;

    if (wasMoved) {
        e.preventDefault();
        e.stopPropagation();
    }
    return wasMoved;
}

function fitView(positions) {
    const keys = Object.keys(positions);
    if (!keys.length) return;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [key, p] of Object.entries(positions)) {
        const box = nodeVisualBox(key, p);
        minX = Math.min(minX, box.x); minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.w); maxY = Math.max(maxY, box.y + box.h);
    }

    const pad = 60;
    scale = Math.max(ZOOM_MIN, Math.min(1.2,
        Math.min((vw - pad * 2) / (maxX - minX), (vh - pad * 2) / (maxY - minY))
    ));
    panX = (vw - (maxX - minX) * scale) / 2 - minX * scale;
    panY = (vh - (maxY - minY) * scale) / 2 - minY * scale;
    applyTransform();
}

function fitFocusedNeighborhood() {
    const root = focusedKey || selectedKey || lastFocusedKey;
    if (!root || !nodePositions[root]) {
        fitView(nodePositions);
        return;
    }

    const distances = focusDistances(root);
    const focusedPositions = {};
    for (const key of distances.keys()) {
        if (nodePositions[key]) focusedPositions[key] = nodePositions[key];
    }
    fitView(Object.keys(focusedPositions).length ? focusedPositions : nodePositions);
}

function updateSettingsSummary() {
    settingsSummary.textContent =
        `depth ${graphSettings.focusDepth} | focus ${graphSettings.focusIntensity.toFixed(1)}x | zoom ${graphSettings.zoomSpeed.toFixed(1)}x`;
}

function syncSettingsControls() {
    settingZoomSpeed.value = String(graphSettings.zoomSpeed);
    settingZoomSpeedValue.textContent = `${graphSettings.zoomSpeed.toFixed(1)}x`;
    settingFocusDepth.value = String(graphSettings.focusDepth);
    settingFocusDepthValue.textContent = String(graphSettings.focusDepth);
    settingFocusIntensity.value = String(graphSettings.focusIntensity);
    settingFocusIntensityValue.textContent = `${graphSettings.focusIntensity.toFixed(1)}x`;
    settingEdgeLabels.value = graphSettings.edgeLabelMode;
    settingEdgeLabelsValue.textContent = graphSettings.edgeLabelMode === 'always'
        ? 'Always'
        : graphSettings.edgeLabelMode === 'off' ? 'Off' : 'Focus';
    settingLiveRefresh.checked = graphSettings.liveRefresh;
    syncPaletteControls();
    updateSettingsSummary();
}

function toggleSettingsPanel(force) {
    const nextVisible = force ?? !settingsPanel.classList.contains('visible');
    settingsPanel.classList.toggle('visible', nextVisible);
    settingsPanel.setAttribute('aria-hidden', nextVisible ? 'false' : 'true');
    settingsBtn.setAttribute('aria-expanded', nextVisible ? 'true' : 'false');
    if (nextVisible) syncSettingsControls();
}

viewport.addEventListener('mousedown', e => {
    if (e.target.closest('.mem-node')) return;
    if (nodeDrag) return;
    isPanning = true;
    panStartX = e.clientX; panStartY = e.clientY;
    panStartPanX = panX; panStartPanY = panY;
    viewport.classList.add('grabbing');
    e.preventDefault();
});
document.addEventListener('mousemove', e => {
    if (nodeDrag) return;
    if (!isPanning) return;
    panX = panStartPanX + (e.clientX - panStartX);
    panY = panStartPanY + (e.clientY - panStartY);
    applyTransform();
});
document.addEventListener('mouseup', () => {
    if (isPanning) { isPanning = false; viewport.classList.remove('grabbing'); }
});
document.addEventListener('pointermove', moveDraggedNode);
document.addEventListener('pointerup', endNodeDrag);
document.addEventListener('pointercancel', endNodeDrag);
viewport.addEventListener('wheel', e => {
    e.preventDefault();
    const cappedDelta = Math.max(-120, Math.min(120, e.deltaY));
    const factor = Math.exp(-cappedDelta * DEFAULT_WHEEL_ZOOM_INTENSITY * graphSettings.zoomSpeed);
    const rect = viewport.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    zoomAt(mx, my, scale * factor);
}, { passive: false });

document.getElementById('zoom-in-btn').addEventListener('click', () => {
    zoomAtCenter(scale * zoomButtonFactor());
});
document.getElementById('zoom-out-btn').addEventListener('click', () => {
    zoomAtCenter(scale / zoomButtonFactor());
});
document.getElementById('fit-btn').addEventListener('click', () => fitView(nodePositions));
fitFocusedBtn.addEventListener('click', fitFocusedNeighborhood);
settingsBtn.addEventListener('click', () => toggleSettingsPanel());
settingsClose.addEventListener('click', () => toggleSettingsPanel(false));
resetSettingsBtn.addEventListener('click', () => {
    graphSettings = { ...DEFAULT_GRAPH_SETTINGS };
    applyGraphSettings();
});
settingZoomSpeed.addEventListener('input', () => {
    graphSettings.zoomSpeed = clampNumber(settingZoomSpeed.value, 0.5, 2.5, DEFAULT_GRAPH_SETTINGS.zoomSpeed);
    applyGraphSettings();
});
settingFocusDepth.addEventListener('input', () => {
    graphSettings.focusDepth = Math.round(clampNumber(settingFocusDepth.value, 1, 6, DEFAULT_GRAPH_SETTINGS.focusDepth));
    applyGraphSettings();
});
settingFocusIntensity.addEventListener('input', () => {
    graphSettings.focusIntensity = clampNumber(settingFocusIntensity.value, 0.6, 1.4, DEFAULT_GRAPH_SETTINGS.focusIntensity);
    applyGraphSettings();
});
settingEdgeLabels.addEventListener('change', () => {
    graphSettings.edgeLabelMode = normalizeEdgeLabelMode(settingEdgeLabels.value);
    applyGraphSettings();
});
settingLiveRefresh.addEventListener('change', () => {
    graphSettings.liveRefresh = settingLiveRefresh.checked;
    applyGraphSettings();
});
paletteOptions.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.name !== 'palette-mode') return;
    graphSettings.palette = target.value;
    applyGraphSettings();
});
settingCustomBg.addEventListener('input', () => {
    graphSettings.palette = 'custom';
    graphSettings.customPalette.appBg = settingCustomBg.value;
    applyGraphSettings();
});
settingCustomSurface.addEventListener('input', () => {
    graphSettings.palette = 'custom';
    graphSettings.customPalette.panelBg = settingCustomSurface.value;
    applyGraphSettings();
});
settingCustomAccent.addEventListener('input', () => {
    graphSettings.palette = 'custom';
    graphSettings.customPalette.accent = settingCustomAccent.value;
    applyGraphSettings();
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') toggleSettingsPanel(false);
});
document.addEventListener('mousedown', e => {
    if (!settingsPanel.classList.contains('visible')) return;
    if (settingsPanel.contains(e.target) || settingsBtn.contains(e.target)) return;
    toggleSettingsPanel(false);
});
document.getElementById('fullscreen-btn').addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => { });
    else document.exitFullscreen().catch(() => { });
});
document.addEventListener('fullscreenchange', () => {
    document.getElementById('fullscreen-btn').textContent = document.fullscreenElement ? '⊠' : '⛶';
    setTimeout(() => fitView(nodePositions), 80);
});

// ── WebSocket ──────────────────────────────────────────────────────────
function wsSend(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function wsRpc(obj) {
    if (!obj.requestId) obj.requestId = makeRequestId(obj.type || 'rpc');
    return new Promise(res => { pending[obj.requestId] = res; wsSend(obj); });
}

function drainQueue(type) {
    const idx = msgQueue.findIndex(m => m.type === type);
    if (idx !== -1) return msgQueue.splice(idx, 1)[0];
    return null;
}

function subscribeToKey(key) {
    if (!key || subscribedKeys.has(key) || !ws || ws.readyState !== WebSocket.OPEN) return;
    subscribedKeys.add(key);
    wsSend({ type: 'subscribe', key, requestId: makeRequestId('sub') });
}

function syncSubscriptions() {
    for (const key of Object.keys(currentEntries)) subscribeToKey(key);
}

function upsertEdge(edge) {
    const id = edgeKey(edge);
    const index = currentEdges.findIndex(existing => edgeKey(existing) === id);
    if (index === -1) currentEdges.push(edge);
    else currentEdges[index] = edge;
}

function removeEdge(edge) {
    const id = edgeKey(edge);
    currentEdges = currentEdges.filter(existing => edgeKey(existing) !== id);
}

function markNodeUpdating(key) {
    const el = scene.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (!el) return;
    el.classList.remove('updating');
    void el.offsetWidth;
    el.classList.add('updating');
    window.setTimeout(() => el.classList.remove('updating'), 750);
}

function queueGraphReload(options = {}) {
    if (refreshQueued) return;
    refreshQueued = true;
    window.setTimeout(async () => {
        refreshQueued = false;
        if (ws && ws.readyState === WebSocket.OPEN) {
            await loadGraph({
                preserveView: true,
                preservePositions: Boolean(options.preservePositions),
                silent: true,
            });
        }
    }, 120);
}

function startLiveRefresh() {
    if (!graphSettings.liveRefresh) return;
    stopLiveRefresh();
    liveRefreshTimer = window.setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            loadGraph({ preserveView: true, preservePositions: true, silent: true });
        }
    }, LIVE_REFRESH_MS);
}

function stopLiveRefresh() {
    if (liveRefreshTimer) {
        window.clearInterval(liveRefreshTimer);
        liveRefreshTimer = null;
    }
}

function handleLiveMessage(msg) {
    if (msg.type === 'update' && msg.key) {
        if (msg.entry === null) {
            if (!currentEntries[msg.key]) return true;
            delete currentEntries[msg.key];
            currentEdges = currentEdges.filter(edge => edge.from !== msg.key && edge.to !== msg.key);
            if (selectedKey === msg.key) document.getElementById('dp-close').click();
            renderGraph(currentEntries, currentEdges, { preserveSelection: true, preservePositions: true, fit: false });
            updateStatusCount();
            return true;
        }

        const changed = !sameJson(currentEntries[msg.key], msg.entry);
        currentEntries[msg.key] = msg.entry;
        subscribeToKey(msg.key);
        if (changed) {
            renderGraph(currentEntries, currentEdges, { preserveSelection: true, preservePositions: true, fit: false });
            markNodeUpdating(msg.key);
            updateStatusCount();
        }
        return true;
    }

    if (msg.type === 'relation-update' && msg.edge) {
        if (!currentEntries[msg.edge.from] || !currentEntries[msg.edge.to]) {
            queueGraphReload({ preservePositions: true });
            return true;
        }

        if (msg.action === 'deleted' || msg.action === 'cascade-deleted') {
            removeEdge(msg.edge);
        } else {
            upsertEdge(msg.edge);
        }

        renderGraph(currentEntries, currentEdges, { preserveSelection: true, preservePositions: true, fit: false });
        markNodeUpdating(msg.edge.from);
        markNodeUpdating(msg.edge.to);
        updateStatusCount();
        return true;
    }

    if (msg.type === 'snapshot-update') {
        queueGraphReload({ preservePositions: false });
        return true;
    }

    return false;
}

async function connect() {
    const token = tokenInput.value.trim();
    connectBtn.disabled = true;
    setStatus('Connecting…');

    if (ws) { try { ws.close(); } catch { } ws = null; }
    msgQueue.length = 0;

    ws = new WebSocket(`ws://${location.host}/`);

    ws.onmessage = e => {
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.requestId && pending[msg.requestId]) {
            const res = pending[msg.requestId];
            delete pending[msg.requestId];
            res(msg);
        } else if (!msg.requestId) {
            if (pending[`__${msg.type}__`]) {
                const res = pending[`__${msg.type}__`];
                delete pending[`__${msg.type}__`];
                res(msg);
            } else if (handleLiveMessage(msg)) {
                return;
            } else {
                msgQueue.push(msg);
            }
        }
    };

    ws.onerror = () => { setStatus('Connection failed', 'error'); connectBtn.disabled = false; };
    ws.onclose = () => {
        stopLiveRefresh();
        subscribedKeys.clear();
        setStatus('Disconnected', 'error');
        connectBtn.disabled = false;
        refreshBtn.disabled = true;
    };

    const opened = await new Promise(res => { ws.onopen = () => res(true); ws.onerror = () => res(false); });
    if (!opened || ws.readyState !== WebSocket.OPEN) { connectBtn.disabled = false; return; }

    // Welcome (no requestId — may already be queued)
    const welcome = drainQueue('welcome') || await new Promise(res => { pending['__welcome__'] = res; });
    if (!welcome || welcome.type !== 'welcome') {
        setStatus('Bad server response', 'error'); connectBtn.disabled = false; return;
    }

    if (token) {
        const r = await wsRpc({ type: 'auth', token, requestId: '__auth__' });
        if (r.type === 'error') {
            setStatus('Auth failed', 'error'); ws.close(); connectBtn.disabled = false; return;
        }
    }

    refreshBtn.disabled = false;
    connectBtn.disabled = false;
    await loadGraph();
    startLiveRefresh();
}

async function loadGraph(options = {}) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!options.silent) {
        loadingEl.classList.add('visible');
        setStatus('Loading…');
    }

    const r = await wsRpc({ type: 'export', requestId: makeRequestId('export') });
    if (!options.silent) loadingEl.classList.remove('visible');

    if (r.type === 'error') {
        if (!options.silent) setStatus('Export failed', 'error');
        return;
    }

    currentEntries = r.snapshot.entries;
    currentEdges = r.snapshot.edges;
    syncSubscriptions();
    renderGraph(currentEntries, currentEdges, {
        preserveSelection: Boolean(options.preserveView),
        preservePositions: Boolean(options.preservePositions),
        fit: options.preserveView ? false : true,
    });

    updateStatusCount();
}

connectBtn.addEventListener('click', connect);
refreshBtn.addEventListener('click', loadGraph);
tokenInput.addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });

applyGraphSettings({ skipSave: true });
applyTransform();
