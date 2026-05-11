'use strict';

// Public facade. Wires schema + store + panel + apply together and exposes
// a small surface for dashboard.js to consume.

(function (global) {
    const Schema = global.SettingsSchema;
    const Store = global.SettingsStore;
    const Apply = global.SettingsApply;
    const Panel = global.SettingsPanel;

    let state = Store.load();
    let panelHandle = null;

    function snapshot() {
        return JSON.parse(JSON.stringify(state));
    }

    function get(path) {
        return Schema.getPath(state, path);
    }

    function set(path, value) {
        Schema.setPath(state, path, value);
        Store.save(state);
        Apply.apply(state, { reason: 'set', path });
        if (panelHandle) panelHandle.refresh();
    }

    function replace(next) {
        state = Store.hydrate(next);
        Store.save(state);
        Apply.apply(state, { reason: 'replace' });
        if (panelHandle) panelHandle.refresh();
    }

    function reset() {
        state = Store.reset();
        Apply.apply(state, { reason: 'reset' });
        if (panelHandle) panelHandle.refresh();
    }

    function init(options = {}) {
        if (typeof options.onChange === 'function') Apply.subscribe(options.onChange);
        Apply.apply(state, { reason: 'init' });

        const container = options.container || document.querySelector('#settings-panel .settings-body');
        if (container) {
            panelHandle = Panel.mount(container, { snapshot, get, set, reset, replace });
        }
        return { snapshot, get, set, reset, replace };
    }

    global.Settings = { init, snapshot, get, set, reset, replace, subscribe: Apply.subscribe };
})(typeof window !== 'undefined' ? window : globalThis);
