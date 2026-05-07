'use strict';

// Renders the settings panel from the schema. Owns no state of its own;
// reads/writes through the Settings facade passed to mount().

(function (global) {
    const Schema = global.SettingsSchema;
    const Profiles = global.SettingsProfiles;

    const COLLAPSED_KEY = 'sharedMemory.dashboard.settings.collapsed.v1';

    function loadCollapsed() {
        try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]')); }
        catch { return new Set(); }
    }
    function saveCollapsed(set) {
        try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set])); }
        catch { /* ignore */ }
    }

    function escAttr(v) {
        return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function rowTemplate(setting) {
        const dom = setting.domId ? ` id="${escAttr(setting.domId)}"` : '';
        const valueDom = setting.domId ? ` id="${escAttr(setting.domId)}-value"` : '';
        switch (setting.type) {
            case 'range':
                return `
          <label class="setting-row" data-setting="${escAttr(setting.id)}">
            <span class="setting-label">${escAttr(setting.label)}</span>
            <input${dom} type="range" min="${setting.min}" max="${setting.max}" step="${setting.step}" data-setting-input="${escAttr(setting.id)}" />
            <span class="setting-value"${valueDom} data-setting-value="${escAttr(setting.id)}"></span>
          </label>`;
            case 'select': {
                const opts = setting.options.map((o) => `<option value="${escAttr(o.value)}">${escAttr(o.label)}</option>`).join('');
                return `
          <label class="setting-row" data-setting="${escAttr(setting.id)}">
            <span class="setting-label">${escAttr(setting.label)}</span>
            <select${dom} data-setting-input="${escAttr(setting.id)}">${opts}</select>
            <span class="setting-value"${valueDom} data-setting-value="${escAttr(setting.id)}"></span>
          </label>`;
            }
            case 'toggle':
                return `
          <label class="setting-row toggle" data-setting="${escAttr(setting.id)}">
            <span class="setting-label">${escAttr(setting.label)}</span>
            <input${dom} type="checkbox" data-setting-input="${escAttr(setting.id)}" />
          </label>`;
            case 'color':
                return `
          <label class="setting-row color-row" data-setting="${escAttr(setting.id)}">
            <span class="setting-label">${escAttr(setting.label)}</span>
            <input${dom} type="color" data-setting-input="${escAttr(setting.id)}" />
          </label>`;
            case 'palette': {
                const presets = Object.entries(setting.presets).map(([key, p]) => `
            <label class="palette-option" data-palette-option="${escAttr(key)}">
              <input type="radio" name="palette-mode" value="${escAttr(key)}" />
              <span class="palette-swatch" style="background:${escAttr(p.vars.accent)}"></span>
              <span>${escAttr(p.label)}</span>
            </label>`).join('');
                const customOpt = setting.allowCustom ? `
            <label class="palette-option" data-palette-option="custom">
              <input type="radio" name="palette-mode" value="custom" />
              <span class="palette-swatch palette-swatch-custom"></span>
              <span>Custom</span>
            </label>` : '';
                return `
          <div class="setting-row palette-row" data-setting="${escAttr(setting.id)}">
            <div class="palette-grid" data-palette-grid>${presets}${customOpt}</div>
          </div>`;
            }
            case 'relationToggles': {
                const chips = setting.relations.map((r) => `
            <label class="relation-chip" data-relation="${escAttr(r)}">
              <input type="checkbox" data-relation-input="${escAttr(r)}" />
              <span>${escAttr(r)}</span>
            </label>`).join('');
                return `
          <div class="setting-row relation-row" data-setting="${escAttr(setting.id)}">
            <span class="setting-label">${escAttr(setting.label)}</span>
            <div class="relation-grid">${chips}</div>
          </div>`;
            }
            default:
                return '';
        }
    }

    function sectionTemplate(section, collapsedIds) {
        const isCollapsed = collapsedIds.has(section.id);
        const rows = section.settings.map(rowTemplate).join('');
        return `
      <div class="settings-section" data-section="${escAttr(section.id)}" ${isCollapsed ? 'data-collapsed="true"' : ''}>
        <button class="settings-section-header" type="button" data-section-toggle="${escAttr(section.id)}" aria-expanded="${!isCollapsed}">
          <span class="settings-section-title">${escAttr(section.title)}</span>
          <span class="settings-section-modified" data-section-modified="${escAttr(section.id)}" aria-label="Modified" hidden></span>
          <span class="settings-section-chevron" aria-hidden="true">${isCollapsed ? '▸' : '▾'}</span>
        </button>
        <div class="settings-section-body">${rows}</div>
      </div>`;
    }

    function actionsTemplate() {
        return `
      <div class="settings-section settings-actions-section">
        <div class="settings-section-title">Actions</div>
        <div class="settings-actions">
          <button id="fit-focused-btn">Fit Focus</button>
          <button id="reset-settings-btn">Reset</button>
        </div>
      </div>
      <div class="settings-section settings-profiles-section">
        <div class="settings-section-title">Profiles</div>
        <div class="profile-row">
          <select data-profile-select aria-label="Saved profiles"><option value="">— Saved profiles —</option></select>
          <button type="button" data-profile-load>Load</button>
          <button type="button" data-profile-delete>Delete</button>
        </div>
        <div class="profile-row">
          <input type="text" data-profile-name placeholder="Profile name" />
          <button type="button" data-profile-save>Save</button>
        </div>
        <div class="profile-row">
          <button type="button" data-profile-export>Export JSON</button>
          <button type="button" data-profile-import>Import JSON</button>
        </div>
      </div>`;
    }

    function buildLayout(settings) {
        const collapsed = loadCollapsed();
        const sections = Schema.SECTIONS.map((s) => sectionTemplate(s, collapsed)).join('');
        return `
      <div class="settings-search">
        <input type="search" id="settings-search-input" placeholder="Filter settings…" autocomplete="off" />
      </div>
      ${sections}
      ${actionsTemplate()}`;
    }

    // Render the live value of one setting into its row.
    function renderRow(root, setting, settings) {
        const id = setting.id;
        const value = Schema.getPath(settings, id);
        const input = root.querySelector(`[data-setting-input="${cssEsc(id)}"]`);
        const valueEl = root.querySelector(`[data-setting-value="${cssEsc(id)}"]`);

        switch (setting.type) {
            case 'range':
                if (input) input.value = String(value);
                if (valueEl) valueEl.textContent = setting.format ? setting.format(value) : String(value);
                break;
            case 'select':
                if (input) input.value = String(value);
                if (valueEl) {
                    const opt = setting.options.find((o) => o.value === value);
                    valueEl.textContent = opt ? opt.label : String(value);
                }
                break;
            case 'toggle':
                if (input) input.checked = Boolean(value);
                break;
            case 'color':
                if (input) input.value = String(value);
                break;
            case 'palette': {
                const grid = root.querySelector(`[data-setting="${cssEsc(id)}"] [data-palette-grid]`);
                if (grid) {
                    for (const radio of grid.querySelectorAll('input[name="palette-mode"]')) {
                        radio.checked = radio.value === value;
                    }
                }
                break;
            }
            case 'relationToggles': {
                const obj = value || {};
                for (const r of setting.relations) {
                    const cb = root.querySelector(`[data-relation-input="${cssEsc(r)}"]`);
                    if (cb) cb.checked = obj[r] !== false;
                }
                break;
            }
        }
    }

    function cssEsc(v) {
        return (window.CSS && CSS.escape) ? CSS.escape(v) : String(v).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
    }

    function isModified(setting, settings) {
        const value = Schema.getPath(settings, setting.id);
        const def = setting.type === 'relationToggles' ? setting.default : setting.default;
        return JSON.stringify(value) !== JSON.stringify(def);
    }

    function refreshModifiedDots(root, settings) {
        for (const sec of Schema.SECTIONS) {
            const dirty = sec.settings.some((s) => isModified(s, settings));
            const dot = root.querySelector(`[data-section-modified="${cssEsc(sec.id)}"]`);
            if (dot) dot.hidden = !dirty;
        }
    }

    function refreshVisibility(root, settings) {
        for (const s of Schema.flatSettings()) {
            if (!s.visibleWhen) continue;
            const row = root.querySelector(`[data-setting="${cssEsc(s.id)}"]`);
            if (!row) continue;
            const visible = Object.entries(s.visibleWhen).every(([k, v]) => Schema.getPath(settings, k) === v);
            row.hidden = !visible;
        }
    }

    function refreshAll(root, settings) {
        for (const s of Schema.flatSettings()) renderRow(root, s, settings);
        refreshModifiedDots(root, settings);
        refreshVisibility(root, settings);
        refreshProfileList(root);
        refreshSummary(root, settings);
    }

    function refreshSummary(root, settings) {
        const summary = document.getElementById('settings-summary');
        if (!summary) return;
        const depth = settings.focusDepth;
        const intensity = (settings.focusIntensity ?? 1).toFixed(1);
        const zoom = (settings.zoomSpeed ?? 1).toFixed(1);
        summary.textContent = `depth ${depth} | focus ${intensity}x | zoom ${zoom}x`;
    }

    function refreshProfileList(root) {
        const select = root.querySelector('[data-profile-select]');
        if (!select) return;
        const current = select.value;
        const names = Profiles.list();
        select.innerHTML = `<option value="">— Saved profiles —</option>` + names.map((n) =>
            `<option value="${escAttr(n)}">${escAttr(n)}</option>`).join('');
        if (names.includes(current)) select.value = current;
    }

    function bindEvents(root, facade) {
        // Search
        const search = root.querySelector('#settings-search-input');
        if (search) {
            search.addEventListener('input', () => {
                const q = search.value.trim().toLowerCase();
                const allRows = root.querySelectorAll('[data-setting]');
                const allSections = root.querySelectorAll('.settings-section');
                if (!q) {
                    for (const r of allRows) r.classList.remove('search-hidden');
                    for (const s of allSections) s.classList.remove('search-empty');
                    return;
                }
                for (const sec of Schema.SECTIONS) {
                    const secEl = root.querySelector(`[data-section="${cssEsc(sec.id)}"]`);
                    if (!secEl) continue;
                    let any = sec.title.toLowerCase().includes(q);
                    for (const s of sec.settings) {
                        const row = root.querySelector(`[data-setting="${cssEsc(s.id)}"]`);
                        const match = (s.label || '').toLowerCase().includes(q) || s.id.toLowerCase().includes(q);
                        if (row) row.classList.toggle('search-hidden', !match);
                        if (match) any = true;
                    }
                    secEl.classList.toggle('search-empty', !any);
                }
            });
        }

        // Section toggles
        root.addEventListener('click', (event) => {
            const toggle = event.target.closest('[data-section-toggle]');
            if (!toggle) return;
            const id = toggle.getAttribute('data-section-toggle');
            const secEl = root.querySelector(`[data-section="${cssEsc(id)}"]`);
            if (!secEl) return;
            const wasCollapsed = secEl.getAttribute('data-collapsed') === 'true';
            const next = !wasCollapsed;
            secEl.setAttribute('data-collapsed', String(next));
            toggle.setAttribute('aria-expanded', String(!next));
            const chevron = toggle.querySelector('.settings-section-chevron');
            if (chevron) chevron.textContent = next ? '▸' : '▾';
            const collapsed = loadCollapsed();
            if (next) collapsed.add(id); else collapsed.delete(id);
            saveCollapsed(collapsed);
        });

        // Range / select / toggle / color inputs
        root.addEventListener('input', (event) => {
            const target = event.target;
            const id = target.getAttribute && target.getAttribute('data-setting-input');
            if (id) {
                const setting = Schema.flatSettings().find((s) => s.id === id);
                if (!setting) return;
                let value;
                if (setting.type === 'toggle') value = target.checked;
                else value = Schema.coerce(setting, target.value);
                facade.set(id, value);
                return;
            }
            const rel = target.getAttribute && target.getAttribute('data-relation-input');
            if (rel) {
                const current = facade.get('relationFilters') || {};
                facade.set('relationFilters', { ...current, [rel]: target.checked });
            }
        });

        // Change events for select (some browsers fire only change, not input)
        root.addEventListener('change', (event) => {
            const target = event.target;
            if (target && target.name === 'palette-mode' && target.checked) {
                facade.set('palette', target.value);
            }
        });

        // Reset
        root.addEventListener('click', (event) => {
            if (event.target.id === 'reset-settings-btn') facade.reset();
        });

        // Profiles
        const select = root.querySelector('[data-profile-select]');
        const nameInput = root.querySelector('[data-profile-name]');
        const btnLoad = root.querySelector('[data-profile-load]');
        const btnSave = root.querySelector('[data-profile-save]');
        const btnDelete = root.querySelector('[data-profile-delete]');
        const btnExport = root.querySelector('[data-profile-export]');
        const btnImport = root.querySelector('[data-profile-import]');

        if (btnLoad) btnLoad.addEventListener('click', () => {
            if (!select || !select.value) return;
            const result = Profiles.load(select.value);
            if (result.ok) facade.replace(result.settings);
        });
        if (btnSave) btnSave.addEventListener('click', () => {
            const name = (nameInput && nameInput.value) || (select && select.value) || '';
            const result = Profiles.saveAs(name, facade.snapshot());
            if (result.ok) {
                if (nameInput) nameInput.value = '';
                refreshProfileList(root);
                if (select) select.value = result.name;
            }
        });
        if (btnDelete) btnDelete.addEventListener('click', () => {
            if (!select || !select.value) return;
            Profiles.remove(select.value);
            refreshProfileList(root);
        });
        if (btnExport) btnExport.addEventListener('click', () => {
            const json = Profiles.exportJson(facade.snapshot());
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'graph-settings.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 0);
        });
        if (btnImport) btnImport.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'application/json';
            input.addEventListener('change', () => {
                const file = input.files && input.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                    const result = Profiles.importJson(String(reader.result || ''));
                    if (result.ok) facade.replace(result.settings);
                };
                reader.readAsText(file);
            });
            input.click();
        });
    }

    function mount(container, facade) {
        container.innerHTML = buildLayout(facade.snapshot());
        bindEvents(container, facade);
        refreshAll(container, facade.snapshot());
        return {
            refresh: () => refreshAll(container, facade.snapshot()),
        };
    }

    global.SettingsPanel = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
