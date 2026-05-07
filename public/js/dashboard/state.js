'use strict';

// ── Layout / Node Constants ────────────────────────────────────────────

const NODE_W = 240;

const NODE_ROUND_MIN = 116;
const NODE_ROUND_MAX = 196;
const NODE_ROUND_GROWTH = 22;
const NODE_TRANSITION_MS = 280;

const RADIAL_RING_GAP = 220;
const RADIAL_LAYOUT_MAX_DEPTH = 2;

// ── Realtime Constants ─────────────────────────────────────────────────

const LIVE_REFRESH_MS = 5000;

// ── Interaction Constants ──────────────────────────────────────────────

const DRAG_THRESHOLD_PX = 4;

const ZOOM_MIN = 0.08;
const ZOOM_MAX = 3;
const DEFAULT_WHEEL_ZOOM_INTENSITY = 0.0015;
const DEFAULT_BUTTON_ZOOM_STEP = 1.1;

const DEFAULT_FOCUS_MAX_DEPTH = 4;

// ── Focus Styling ──────────────────────────────────────────────────────

const FOCUS_SCALE = [
    {
        color: '#f8fafc',
        opacity: 1,
        edgeOpacity: 0.95,
        ring: 3,
        glow: 30,
    },
    {
        color: '#22c55e',
        opacity: 0.96,
        edgeOpacity: 0.82,
        ring: 2,
        glow: 22,
    },
    {
        color: '#06b6d4',
        opacity: 0.78,
        edgeOpacity: 0.62,
        ring: 1.5,
        glow: 17,
    },
    {
        color: '#a855f7',
        opacity: 0.58,
        edgeOpacity: 0.43,
        ring: 1,
        glow: 12,
    },
    {
        color: '#f59e0b',
        opacity: 0.4,
        edgeOpacity: 0.3,
        ring: 1,
        glow: 8,
    },
];

// ── Settings Bootstrap ─────────────────────────────────────────────────
//
// Settings schema/store/panel/apply live in js/settings/.
// window.Settings is populated by those scripts before this file loads.
// Schema-driven palette + relation-color presets live in window.SettingsSchema.
// CSS-var application and relation-color resolution live in window.SettingsApply.

function getInitialGraphSettings() {
    if (!window.Settings || typeof window.Settings.snapshot !== 'function') {
        return {};
    }

    return window.Settings.snapshot();
}

function getInitialRelationColors() {
    if (
        !window.SettingsApply ||
        typeof window.SettingsApply.relationColors !== 'function'
    ) {
        return {};
    }

    return window.SettingsApply.relationColors('aurora', {});
}

let graphSettings = getInitialGraphSettings();
let relationColors = getInitialRelationColors();

// ── WebSocket / Realtime State ─────────────────────────────────────────

let ws = null;
let liveRefreshTimer = null;
let refreshQueued = false;
let nextRpcId = 1;

const subscribedKeys = new Set();
const pending = {};
const msgQueue = [];

// ── Graph Data State ───────────────────────────────────────────────────

let currentEntries = {};
let currentEdges = [];
let nodePositions = {};

const expandedNodes = new Set();

// ── Viewport State ─────────────────────────────────────────────────────

let scale = 1;
let panX = 0;
let panY = 0;

let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panStartPanX = 0;
let panStartPanY = 0;

// ── Node Interaction State ─────────────────────────────────────────────

let nodeDrag = null;
let suppressClickKey = null;

let selectedKey = null;
let focusedKey = null;
let hoverKey = null;
let lastFocusedKey = null;

// ── Import State ───────────────────────────────────────────────────────

let importSnapshotDraft = null;

// ── DOM Helpers ────────────────────────────────────────────────────────

function requiredEl(id) {
    const el = document.getElementById(id);

    if (!el) {
        console.warn(`Missing DOM element: #${id}`);
    }

    return el;
}

// ── Core DOM References ────────────────────────────────────────────────

const viewport = requiredEl('viewport');
const scene = requiredEl('scene');
const edgesSvg = requiredEl('edges-svg');

// ── Detail Panel DOM References ────────────────────────────────────────

const detailPanel = requiredEl('detail-panel');
const peekStrip = requiredEl('peek-strip');

// ── Connection DOM References ──────────────────────────────────────────

const tokenInput = requiredEl('token-input');
const connectBtn = requiredEl('connect-btn');
const refreshBtn = requiredEl('refresh-btn');
const statusText = requiredEl('status-text');
const loadingEl = requiredEl('loading');
const emptyState = requiredEl('empty-state');

// ── Identity Panel DOM References ──────────────────────────────────────

const identityBtn = requiredEl('identity-btn');
const identityPanel = requiredEl('identity-panel');
const identityClose = requiredEl('identity-close');
const identitySummary = requiredEl('identity-summary');
const identitySearch = requiredEl('identity-search');
const identityList = requiredEl('identity-list');

// ── Import Panel DOM References ────────────────────────────────────────

const importBtn = requiredEl('import-btn');
const importPanel = requiredEl('import-panel');
const importClose = requiredEl('import-close');
const importFile = requiredEl('import-file');
const importSummary = requiredEl('import-summary');
const importResult = requiredEl('import-result');
const importConfirmBtn = requiredEl('import-confirm-btn');
const importCancelBtn = requiredEl('import-cancel-btn');
// ── Export Button DOM References ───────────────────────────────────────

const exportBtn = requiredEl('export-btn');
// ── Settings Panel DOM References ──────────────────────────────────────

const settingsBtn = requiredEl('settings-btn');
const settingsPanel = requiredEl('settings-panel');
const settingsClose = requiredEl('settings-close');

// All other settings controls, such as sliders, selects, palette grid,
// and profile UI, are owned by js/settings/panel.js.
// fit-focused-btn and reset-settings-btn are generated by the panel and
// looked up after Settings.init() runs.

let fitFocusedBtn = null;