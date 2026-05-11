'use strict';

// ── Realtime Constants ─────────────────────────────────────────────────

const LIVE_REFRESH_MS = 5000;

// ── Focus Constants ────────────────────────────────────────────────────

const DEFAULT_FOCUS_MAX_DEPTH = 4;

// ── Settings Bootstrap ─────────────────────────────────────────────────

function validateRequiredModules() {
    const missing = [];

    if (!window.Settings || typeof window.Settings.snapshot !== 'function') {
        missing.push('window.Settings');
    }

    if (!window.SettingsApply || typeof window.SettingsApply.relationColors !== 'function') {
        missing.push('window.SettingsApply');
    }

    if (missing.length > 0) {
        console.error(
            `Missing required modules: ${missing.join(', ')}. ` +
            `Check that settings scripts are loaded before dashboard/state.js`
        );
    }

    return missing.length === 0;
}

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

validateRequiredModules();

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

// ── Cytoscape Instance ─────────────────────────────────────────────────

let cy = null;

// ── Selection State ────────────────────────────────────────────────────

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

let fitFocusedBtn = null;
