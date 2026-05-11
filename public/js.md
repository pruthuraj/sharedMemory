# JavaScript File Map

This dashboard has been split into focused browser JavaScript files. The files are loaded in dependency order from `index.html`.

## Dashboard files

| File | Purpose |
|---|---|
| `js/dashboard/state.js` | Shared constants, runtime state, and DOM references used by the graph dashboard. |
| `js/dashboard/utils.js` | Shared helpers for escaping HTML, hashing, node sizing, focus calculations, SVG helpers, status text, and JSON comparison. |
| `js/dashboard/layout.js` | Dagre layout, radial focus layout, graph filtering, graph rendering, scene sizing, and edge re-render orchestration. |
| `js/dashboard/nodes.js` | Memory-node creation, expand/collapse behavior, focus styling, dragging hooks, and node presentation updates. |
| `js/dashboard/edges.js` | SVG edge rendering, curved paths, arrow markers, edge labels, and relation color application. |
| `js/dashboard/identity.js` | Node Identity panel logic, search/filter handling, and jumping to a selected node. |
| `js/dashboard/import.js` | JSON snapshot import panel, file parsing, validation display, and merge/import confirmation. |
| `js/dashboard/graph-detail.js` | Detail/inspector panel shown when a memory node is selected. |
| `js/dashboard/viewport.js` | Viewport transform, zoom, pan, drag movement, fit view, fullscreen sizing helpers, and settings-panel visibility. |
| `js/dashboard/realtime.js` | WebSocket connection, RPC helpers, live updates, subscriptions, refresh queueing, and graph loading. |
| `js/dashboard/settings-palette.js` | Dashboard-specific effects triggered by settings changes, including relation colors, focus refresh, filters, and live-refresh toggling. |
| `js/dashboard/main.js` | Application bootstrap and event listener registration for toolbar buttons, panels, fullscreen, keyboard shortcuts, connect, refresh, and initial view application. |

## Settings files

| File | Purpose |
|---|---|
| `js/settings/schema.js` | Declarative schema for all graph settings, palettes, relation filters, defaults, and coercion helpers. |
| `js/settings/store.js` | Settings persistence through `localStorage`, including hydration and legacy migration. |
| `js/settings/profiles.js` | Saved settings profiles, profile import/export, and profile deletion. |
| `js/settings/apply.js` | Applies settings to CSS variables/body classes and notifies subscribers. |
| `js/settings/panel.js` | Renders the settings UI from the schema and binds its controls. |
| `js/settings/index.js` | Public facade that wires schema, store, panel, profiles, and apply together as `window.Settings`. |

## Load order

The scripts are intentionally loaded in `index.html` without ES modules. Because of that, order matters. Keep `state.js` and `utils.js` first, load feature files next, then load `main.js` last.
