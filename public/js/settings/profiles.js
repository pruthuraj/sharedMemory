'use strict';

// Named profiles (e.g. "Reading mode", "Editing mode") and JSON import/export.
// Profiles are independent snapshots stored under their own localStorage key.

(function (global) {
    const PROFILES_KEY = 'sharedMemory.dashboard.profiles.v1';
    const Schema = global.SettingsSchema;
    const Store = global.SettingsStore;

    function readAll() {
        try {
            const parsed = JSON.parse(localStorage.getItem(PROFILES_KEY) || '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch { return {}; }
    }

    function writeAll(profiles) {
        try { localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles)); }
        catch { /* ignore */ }
    }

    function list() {
        return Object.keys(readAll()).sort((a, b) => a.localeCompare(b));
    }

    function saveAs(name, settings) {
        const trimmed = String(name || '').trim();
        if (!trimmed) return { ok: false, error: 'empty-name' };
        const all = readAll();
        all[trimmed] = settings;
        writeAll(all);
        return { ok: true, name: trimmed };
    }

    function load(name) {
        const all = readAll();
        const found = all[name];
        if (!found) return { ok: false, error: 'missing-profile' };
        return { ok: true, settings: Store.hydrate(found) };
    }

    function remove(name) {
        const all = readAll();
        if (!(name in all)) return { ok: false };
        delete all[name];
        writeAll(all);
        return { ok: true };
    }

    function exportJson(settings) {
        return JSON.stringify({ version: 1, settings }, null, 2);
    }

    function importJson(text) {
        try {
            const parsed = JSON.parse(text);
            const candidate = parsed && parsed.settings ? parsed.settings : parsed;
            return { ok: true, settings: Store.hydrate(candidate) };
        } catch {
            return { ok: false, error: 'invalid-json' };
        }
    }

    global.SettingsProfiles = { list, saveAs, load, remove, exportJson, importJson };
})(typeof window !== 'undefined' ? window : globalThis);
