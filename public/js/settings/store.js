'use strict';

// Persistence layer for settings. Reads/writes localStorage with the
// existing key (sharedMemory.dashboard.settings.v1), migrates legacy fields,
// and produces a fully-coerced settings object using the schema.

(function (global) {
    const STORAGE_KEY = 'sharedMemory.dashboard.settings.v1';
    const Schema = global.SettingsSchema;

    function readRaw() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
        catch { return {}; }
    }

    function writeRaw(value) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); }
        catch { /* quota / privacy mode — ignore */ }
    }

    // Convert legacy { edgeLabels: false } to { edgeLabelMode: 'off' }.
    function migrate(parsed) {
        const out = { ...parsed };
        if (out.edgeLabelMode === undefined && out.edgeLabels === false) {
            out.edgeLabelMode = 'off';
            delete out.edgeLabels;
        }
        return out;
    }

    // Coerce parsed JSON into a fully-valid settings object.
    function hydrate(parsed) {
        const base = Schema.defaults();
        const source = migrate(parsed || {});
        for (const setting of Schema.flatSettings()) {
            const raw = Schema.getPath(source, setting.id);
            const value = raw === undefined ? Schema.getPath(base, setting.id) : Schema.coerce(setting, raw);
            Schema.setPath(base, setting.id, value);
        }
        return base;
    }

    function load() { return hydrate(readRaw()); }

    function save(settings) { writeRaw(settings); }

    function reset() {
        const fresh = Schema.defaults();
        writeRaw(fresh);
        return fresh;
    }

    global.SettingsStore = { STORAGE_KEY, load, save, reset, hydrate };
})(typeof window !== 'undefined' ? window : globalThis);
