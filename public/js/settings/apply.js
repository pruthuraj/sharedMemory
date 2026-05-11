'use strict';

// Applies settings to the DOM: CSS custom properties for palette,
// body classes for edge-label mode, and CSS scale variables.
// Graph-specific side effects (re-running layout, restarting live refresh,
// re-rendering edges) are delegated to the consumer via SettingsApply.subscribe.

(function (global) {
    const Schema = global.SettingsSchema;

    const subscribers = new Set();
    let lastApplied = null;

    function paletteVars(name, customPalette) {
        const preset = Schema.COLOR_PALETTES[name];
        if (preset) return preset.vars;
        const fallback = Schema.COLOR_PALETTES.aurora.vars;
        return {
            appBg: customPalette.appBg || fallback.appBg,
            gridColor: fallback.gridColor,
            panelBg: customPalette.panelBg || fallback.panelBg,
            surfaceBg: customPalette.surfaceBg || fallback.surfaceBg,
            surfaceBg2: customPalette.surfaceBg2 || fallback.surfaceBg2,
            borderColor: customPalette.borderColor || fallback.borderColor,
            accent: customPalette.accent || fallback.accent,
            accent2: customPalette.accent2 || fallback.accent2,
        };
    }

    function relationColors(name, customPalette) {
        if (name !== 'custom' && Schema.RELATION_COLOR_PRESETS[name]) {
            return { ...Schema.RELATION_COLOR_PRESETS[name] };
        }
        const accent = customPalette.accent || '#6366f1';
        const accent2 = customPalette.accent2 || '#22c55e';
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

    function applyCssVars(settings) {
        const vars = paletteVars(settings.palette, settings.customPalette || {});
        const root = document.documentElement.style;
        root.setProperty('--app-bg', vars.appBg);
        root.setProperty('--grid-color', vars.gridColor);
        root.setProperty('--panel-bg', vars.panelBg);
        root.setProperty('--surface-bg', vars.surfaceBg);
        root.setProperty('--surface-bg-2', vars.surfaceBg2);
        root.setProperty('--border-color', vars.borderColor);
        root.setProperty('--accent', vars.accent);
        root.setProperty('--accent-2', vars.accent2);
        root.setProperty('--node-scale', String(settings.nodeScale ?? 1));
        root.setProperty('--label-scale', String(settings.labelScale ?? 1));
        root.setProperty('--edge-stroke-scale', String(settings.edgeThickness ?? 1));
    }

    function applyBodyClasses(settings) {
        const mode = settings.edgeLabelMode;
        document.body.classList.toggle('edge-labels-focus', mode === 'focus');
        document.body.classList.toggle('edge-labels-always', mode === 'always');
        document.body.classList.toggle('edge-labels-off', mode === 'off');
    }

    function diffKeys(prev, next) {
        const changed = new Set();
        if (!prev) {
            for (const s of Schema.flatSettings()) changed.add(s.id);
            return changed;
        }
        for (const s of Schema.flatSettings()) {
            const a = JSON.stringify(Schema.getPath(prev, s.id));
            const b = JSON.stringify(Schema.getPath(next, s.id));
            if (a !== b) changed.add(s.id);
        }
        return changed;
    }

    function apply(settings, options = {}) {
        applyCssVars(settings);
        applyBodyClasses(settings);
        const changed = diffKeys(lastApplied, settings);
        const event = { settings, changed, reason: options.reason || 'change' };
        for (const fn of subscribers) {
            try { fn(event); } catch (err) { console.error('settings subscriber error', err); }
        }
        lastApplied = JSON.parse(JSON.stringify(settings));
    }

    function subscribe(fn) {
        subscribers.add(fn);
        return () => subscribers.delete(fn);
    }

    global.SettingsApply = { apply, subscribe, paletteVars, relationColors };
})(typeof window !== 'undefined' ? window : globalThis);
