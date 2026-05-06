# JavaScript File Map

The old `js/dashboard.js` was doing too many jobs in one file: global state, DOM lookup, graph layout, node rendering, edge rendering, panels, import, settings, command palette, WebSocket logic, and event binding. It is now split into smaller files under `js/dashboard/`.

## Load order

The files are intentionally loaded in this order from `index.html` because they share the same browser global scope.

1. `js/settings/schema.js` - declarative settings schema, defaults, palette presets, relation filters.
2. `js/settings/store.js` - localStorage persistence and settings hydration/migration.
3. `js/settings/profiles.js` - saved settings profiles and import/export for profiles.
4. `js/settings/apply.js` - applies settings to CSS variables/body classes and notifies subscribers.
5. `js/settings/panel.js` - renders and binds the settings panel UI.
6. `js/settings/index.js` - public `window.Settings` facade used by the dashboard.
7. `js/dashboard/state.js` - constants, shared runtime state, DOM references, and zoom indicator setup.
8. `js/dashboard/utils.js` - helper functions for escaping, colors, timestamps, node geometry, focus distance, status, counters, and scale clamping.
9. `js/dashboard/layout.js` - hierarchical, radial, and force-directed graph layout functions.
10. `js/dashboard/nodes.js` - node rendering, node expansion/collapse, focus styling, and focused radial layout.
11. `js/dashboard/edges.js` - SVG edge rendering, edge label rendering, scene sizing, and edge rerender scheduling.
12. `js/dashboard/identity.js` - left identity panel, identity search, and focus-from-identity behavior.
13. `js/dashboard/import.js` - memory snapshot import parsing, validation feedback, and import submission.
14. `js/dashboard/graph-detail.js` - graph filtering/rendering and right detail inspector behavior.
15. `js/dashboard/viewport.js` - pan, zoom, drag, fit-view, fullscreen, settings panel open/close, and viewport event listeners.
16. `js/dashboard/settings-palette.js` - dashboard side effects when settings change and command-palette search.
17. `js/dashboard/realtime.js` - WebSocket connection, RPC helpers, subscriptions, live updates, refresh, loading, and audit badge.

## Why this refactor helps

- Layout code can be changed without touching WebSocket or panel code.
- Rendering code is separated from data loading code.
- Settings already had a clean modular structure, so the dashboard now follows the same pattern.
- Debugging becomes easier because problems are isolated by feature area.
- The old `js/dashboard.js` is now only a short legacy note, not the main implementation.

## Main faults in the old dashboard file

- It was a large monolithic file, so unrelated concerns were mixed together.
- Many functions depended on shared global variables, which makes testing and debugging harder.
- Event listeners were mixed directly into rendering/logic sections.
- WebSocket state, UI state, graph data, panel state, and import state all lived in the same scope.
- The settings modules were already cleanly separated, but the dashboard had not followed that architecture yet.
- `sameJson()` uses `JSON.stringify()`, which is simple but can become expensive on larger graph updates.
- The force layout runs 300 synchronous ticks, which is deterministic but may block the UI for very large graphs.

## Important note

This refactor keeps the current classic-script style instead of converting to ES modules. That means no bundler is required, and the app should still run by opening the same `index.html` structure through your existing server.
