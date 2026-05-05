'use strict';

// Declarative schema for all graph settings.
// Add a new setting: append an entry to a section. The panel and store
// pick it up automatically. Side effects are wired through the onChange
// callback passed to Settings.init.

(function (global) {
    const COLOR_PALETTES = {
        aurora: {
            label: 'Aurora',
            vars: { appBg: '#05050e', gridColor: '#12122a', panelBg: '#0f0f1e', surfaceBg: '#080810', surfaceBg2: '#0b0b14', borderColor: '#2d2d44', accent: '#6366f1', accent2: '#22c55e' },
        },
        ocean: {
            label: 'Ocean',
            vars: { appBg: '#061018', gridColor: '#12304a', panelBg: '#0d1720', surfaceBg: '#08131b', surfaceBg2: '#0b1a26', borderColor: '#23435c', accent: '#06b6d4', accent2: '#3b82f6' },
        },
        ember: {
            label: 'Ember',
            vars: { appBg: '#130906', gridColor: '#3a1a14', panelBg: '#1a1110', surfaceBg: '#150d0c', surfaceBg2: '#1e1210', borderColor: '#4d2a25', accent: '#f97316', accent2: '#ef4444' },
        },
        forest: {
            label: 'Forest',
            vars: { appBg: '#07110d', gridColor: '#163126', panelBg: '#0e1814', surfaceBg: '#09120f', surfaceBg2: '#0d1a16', borderColor: '#224035', accent: '#22c55e', accent2: '#84cc16' },
        },
        mono: {
            label: 'Mono',
            vars: { appBg: '#0a0a0a', gridColor: '#202020', panelBg: '#111111', surfaceBg: '#121212', surfaceBg2: '#161616', borderColor: '#343434', accent: '#e5e7eb', accent2: '#9ca3af' },
        },
    };

    const RELATION_COLOR_PRESETS = {
        aurora: { related_to: '#6366f1', depends_on: '#f59e0b', supports: '#22c55e', contradicts: '#ef4444', mentions: '#06b6d4', derived_from: '#a855f7', next_step: '#f97316' },
        ocean: { related_to: '#38bdf8', depends_on: '#60a5fa', supports: '#14b8a6', contradicts: '#f43f5e', mentions: '#22d3ee', derived_from: '#818cf8', next_step: '#0ea5e9' },
        ember: { related_to: '#fb7185', depends_on: '#fb923c', supports: '#f97316', contradicts: '#ef4444', mentions: '#f59e0b', derived_from: '#c084fc', next_step: '#fdba74' },
        forest: { related_to: '#4ade80', depends_on: '#84cc16', supports: '#22c55e', contradicts: '#f87171', mentions: '#10b981', derived_from: '#34d399', next_step: '#a3e635' },
        mono: { related_to: '#e5e7eb', depends_on: '#cbd5e1', supports: '#94a3b8', contradicts: '#9ca3af', mentions: '#d1d5db', derived_from: '#f3f4f6', next_step: '#6b7280' },
    };

    const RELATION_TYPES = ['related_to', 'depends_on', 'supports', 'contradicts', 'mentions', 'derived_from', 'next_step'];

    const DEFAULT_RELATION_FILTERS = Object.fromEntries(RELATION_TYPES.map((r) => [r, true]));

    const DEFAULT_CUSTOM_PALETTE = {
        appBg: '#05050e', panelBg: '#0f0f1e', surfaceBg: '#080810', surfaceBg2: '#0b0b14',
        borderColor: '#2d2d44', accent: '#6366f1', accent2: '#22c55e',
    };

    const SECTIONS = [
        {
            id: 'navigation',
            title: 'Navigation',
            settings: [
                { id: 'zoomSpeed', type: 'range', label: 'Zoom speed', min: 0.5, max: 2.5, step: 0.1, default: 1, format: (v) => `${Number(v).toFixed(1)}x`, domId: 'setting-zoom-speed' },
            ],
        },
        {
            id: 'focus',
            title: 'Focus',
            settings: [
                { id: 'focusDepth', type: 'range', label: 'Depth', min: 1, max: 6, step: 1, default: 4, format: (v) => String(Math.round(v)), domId: 'setting-focus-depth' },
                { id: 'focusIntensity', type: 'range', label: 'Intensity', min: 0.6, max: 1.4, step: 0.1, default: 1, format: (v) => `${Number(v).toFixed(1)}x`, domId: 'setting-focus-intensity' },
            ],
        },
        {
            id: 'display',
            title: 'Display',
            settings: [
                { id: 'edgeLabelMode', type: 'select', label: 'Edge labels', default: 'focus', domId: 'setting-edge-labels',
                  options: [{ value: 'focus', label: 'Hover/click' }, { value: 'always', label: 'Always' }, { value: 'off', label: 'Off' }] },
                { id: 'liveRefresh', type: 'toggle', label: 'Live refresh', default: true, domId: 'setting-live-refresh' },
                { id: 'nodeScale', type: 'range', label: 'Node size', min: 0.6, max: 1.8, step: 0.1, default: 1, format: (v) => `${Number(v).toFixed(1)}x` },
                { id: 'labelScale', type: 'range', label: 'Label size', min: 0.7, max: 1.6, step: 0.1, default: 1, format: (v) => `${Number(v).toFixed(1)}x` },
                { id: 'edgeThickness', type: 'range', label: 'Edge thickness', min: 0.5, max: 3, step: 0.1, default: 1, format: (v) => `${Number(v).toFixed(1)}x` },
            ],
        },
        {
            id: 'filters',
            title: 'Filters',
            settings: [
                { id: 'minImportance', type: 'range', label: 'Min importance', min: 0, max: 10, step: 1, default: 0, format: (v) => String(Math.round(v)) },
                { id: 'relationFilters', type: 'relationToggles', label: 'Show relations', relations: RELATION_TYPES, default: { ...DEFAULT_RELATION_FILTERS } },
            ],
        },
        {
            id: 'layout',
            title: 'Layout',
            settings: [
                { id: 'layoutMode', type: 'select', label: 'Algorithm', default: 'radial',
                  options: [{ value: 'radial', label: 'Radial focus' }, { value: 'force', label: 'Force-directed' }, { value: 'hierarchical', label: 'Hierarchical' }] },
            ],
        },
        {
            id: 'palette',
            title: 'Palette',
            settings: [
                { id: 'palette', type: 'palette', label: 'Theme', default: 'aurora', presets: COLOR_PALETTES, allowCustom: true },
                { id: 'customPalette.appBg', type: 'color', label: 'Background', default: DEFAULT_CUSTOM_PALETTE.appBg, domId: 'setting-custom-bg', visibleWhen: { palette: 'custom' } },
                { id: 'customPalette.panelBg', type: 'color', label: 'Surface', default: DEFAULT_CUSTOM_PALETTE.panelBg, domId: 'setting-custom-surface', visibleWhen: { palette: 'custom' } },
                { id: 'customPalette.accent', type: 'color', label: 'Accent', default: DEFAULT_CUSTOM_PALETTE.accent, domId: 'setting-custom-accent', visibleWhen: { palette: 'custom' } },
            ],
        },
    ];

    function getPath(obj, path) {
        const parts = path.split('.');
        let cur = obj;
        for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; }
        return cur;
    }

    function setPath(obj, path, value) {
        const parts = path.split('.');
        let cur = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
            cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = value;
    }

    function flatSettings() {
        const out = [];
        for (const sec of SECTIONS) for (const s of sec.settings) out.push({ ...s, sectionId: sec.id });
        return out;
    }

    function defaults() {
        const out = { customPalette: { ...DEFAULT_CUSTOM_PALETTE } };
        for (const s of flatSettings()) {
            const existing = getPath(out, s.id);
            if (existing === undefined) {
                const value = s.type === 'relationToggles' ? { ...s.default } : s.default;
                setPath(out, s.id, value);
            }
        }
        return out;
    }

    function clamp(v, min, max) { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min; }
    function isHex(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v); }

    // Coerce a partially-known value into a valid one for the given setting.
    function coerce(setting, value) {
        switch (setting.type) {
            case 'range': {
                const n = clamp(value, setting.min, setting.max);
                return setting.step >= 1 ? Math.round(n) : n;
            }
            case 'select':
                return setting.options.some((o) => o.value === value) ? value : setting.default;
            case 'toggle':
                return value === false ? false : Boolean(value || value === undefined ? setting.default : value);
            case 'color':
                return isHex(value) ? value : setting.default;
            case 'palette':
                if (value === 'custom' && setting.allowCustom) return 'custom';
                return setting.presets[value] ? value : setting.default;
            case 'relationToggles': {
                const out = { ...setting.default };
                if (value && typeof value === 'object') {
                    for (const r of setting.relations) {
                        if (typeof value[r] === 'boolean') out[r] = value[r];
                    }
                }
                return out;
            }
            default:
                return value !== undefined ? value : setting.default;
        }
    }

    global.SettingsSchema = {
        SECTIONS,
        COLOR_PALETTES,
        RELATION_COLOR_PRESETS,
        RELATION_TYPES,
        DEFAULT_CUSTOM_PALETTE,
        flatSettings,
        defaults,
        coerce,
        getPath,
        setPath,
    };
})(typeof window !== 'undefined' ? window : globalThis);
