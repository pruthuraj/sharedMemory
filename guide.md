# sharedMemory Guide

sharedMemory is a local SQLite-backed coordination server for multi-agent systems. Runtime agents use WebSocket JSON commands; MCP clients use stdio tools backed by the same store.

## Architecture

| File | Role |
|---|---|
| `server.js` | `npm start` entrypoint, default port `3001`, signal shutdown |
| `src/server.js` | Express, WebSocket routing, auth, `/status`, `/protocol`, background prune |
| `src/protocol.js` | Command validation plus exported protocol metadata |
| `src/memory-store.js` | SQLite CRUD, revisions, TTL, graph, FTS search, snapshots |
| `src/delivery.js` | Safe WebSocket sends and subscription broadcasts |
| `mcp-server.mjs` | Official stdio MCP adapter |
| `scripts/shared-memory-client.js` | Reusable WebSocket client helper for maintenance scripts |

Request flow:

```text
WebSocket JSON -> parseMessage -> server route -> memory/registry/suggestions -> direct response
```

Direct responses echo `requestId`. Broadcasts such as `update`, `relation-update`, `linked`, and `snapshot-update` do not.

## Setup

```bash
npm install
npm start
npm run mcp
npm test
```

Environment:

| Variable | Default | Purpose |
|---|---:|---|
| `SHARED_MEMORY_PORT` / `PORT` | `3001` | HTTP/WebSocket port |
| `MEMORY_FILE` | none | SQLite database path |
| `MEMORY_TOKEN` | none | Bearer token for WS, `/status`, and `/protocol` |
| `MEMORY_SUGGEST_ENABLED` | `false` | Enables semantic suggestions |
| `SHARED_MEMORY_INSTALL_DIR` | `C:\sharedMemory` on Windows | Canonical plugin checkout |
| `SHARED_MEMORY_PLUGIN_ROOT` | host plugin dir | Downloaded plugin folder |
| `SHARED_MEMORY_MEMORY_FILE` | selected repo `data/memory.db` | Explicit plugin memory DB override |
| `SHARED_MEMORY_AUTO_INSTALL` | `false` | Allow clone/setup without an interactive prompt |
| `SHARED_MEMORY_AUTO_START` | `false` | Allow local server start without an interactive prompt |
| `SHARED_MEMORY_SKIP_SERVICE_CHECK` | `false` | Skip optional local server check/start |
| `SHARED_MEMORY_BOOTSTRAP_DRY_RUN` | `false` | Print bootstrap decisions without mutating anything |

The plugin launcher prefers `SHARED_MEMORY_PORT`, then `PORT`, then `3001`.
It derives `MEMORY_FILE` from the selected repo root and overrides inherited `MEMORY_FILE` values from another checkout. Set `SHARED_MEMORY_MEMORY_FILE` only when you intentionally want the plugin MCP server to use a different SQLite file.

## Plugin Auto-Boot

The Codex plugin has two roots:

- **Plugin root:** where the plugin was downloaded. `.mcp.json` uses `${pluginDir}` when available and falls back to host plugin env vars, cwd, and finally the canonical install path.
- **Server install root:** the preferred long-lived sharedMemory checkout, defaulting to `C:\sharedMemory` on Windows.

Startup behavior:

| Case | Behavior |
|---|---|
| `C:\sharedMemory` exists and is valid | Use it for stdio MCP and optional HTTP/WebSocket server |
| `C:\sharedMemory` exists but server on `3001` is down | Ask to start it, or start automatically with `SHARED_MEMORY_AUTO_START=true` |
| `C:\sharedMemory` is missing | Ask to clone/setup it, or do so with `SHARED_MEMORY_AUTO_INSTALL=true` |
| Install is denied but downloaded plugin is a full repo | Run from the downloaded plugin copy |
| Dependencies are missing | Ask to run `npm install`, auto-install if allowed, otherwise fail clearly |
| Non-interactive host | No prompt is possible; use explicit auto flags or preinstall dependencies |

Dry-run bootstrap decisions:

```bash
SHARED_MEMORY_BOOTSTRAP_DRY_RUN=true node .codex-plugin/plugin-start.mjs
```

## Discovery

Use discovery before writing maintenance clients:

```http
GET /status
GET /protocol
```

When `MEMORY_TOKEN` is set, both require:

```http
Authorization: Bearer <token>
```

`/status.runtime` identifies the live process:

```json
{
  "pid": 1234,
  "cwd": "C:\\sharedMemory",
  "entrypoint": "C:\\sharedMemory\\server.js",
  "startedAt": 1760000000000,
  "nodeVersion": "v24.x.x",
  "packageName": "mcp-shared-memory-server",
  "packageVersion": "0.1.0",
  "memoryFile": "C:\\sharedMemory\\data\\memory.db",
  "port": 3001
}
```

`/protocol` exposes:

- `commands`
- `relationTypes`
- `directResponseTypes`
- `broadcastTypes`
- `mcpTools`
- `protocolVersion`

Important direct response mappings:

| Command | Response |
|---|---|
| `auth` | `authenticated` |
| `set` | `ok` |
| `get` | `result` |
| `relate` | `related` |
| `unrelate` | `unrelated` |
| `validate-import` | `import-validation` |
| `import` | `import-result` |
| `bulk_set` | `bulk-set-result` |
| `bulk_relate` | `bulk-relate-result` |

## WebSocket Protocol

Connect to:

```text
ws://localhost:3001
```

Authenticate when required:

```json
{ "type": "auth", "token": "secret", "requestId": "auth-1" }
```

Register:

```json
{ "type": "register", "agentId": "agentA", "requestId": "reg-1" }
```

Set memory:

```json
{
  "type": "set",
  "key": "project.architecture",
  "value": "Full detail",
  "summary": "Architecture note",
  "tags": ["architecture"],
  "importance": 8,
  "requestId": "set-1"
}
```

Read memory:

```json
{ "type": "get", "key": "project.architecture", "requestId": "get-1" }
```

Use `ifRevision` on `set`, `touch`, and `delete` for compare-and-set behavior. Omitted `ifRevision` keeps legacy last-write-wins behavior.

## Graph Relations

Official relation types:

```text
related_to, depends_on, supports, contradicts, mentions,
derived_from, next_step, implements, documents, blocks
```

Create or update an edge:

```json
{
  "type": "relate",
  "from": "project.database",
  "to": "project.architecture",
  "relation": "depends_on",
  "reason": "Database choices affect architecture.",
  "weight": 0.8,
  "requestId": "rel-1"
}
```

Both endpoints must exist and be visible. Self-relations are rejected. Duplicate `from + relation + to` triples update the existing edge.

Remove an edge:

```json
{ "type": "unrelate", "from": "a", "to": "b", "relation": "documents", "requestId": "unrel-1" }
```

Map nearby context:

```json
{ "type": "map", "key": "project.architecture", "depth": 2, "limit": 10, "requestId": "map-1" }
```

`map` returns metadata-only `nodes` and `edges`; use `get` for full values.

## Search And Suggest

Search requires at least one filter:

```json
{
  "type": "search",
  "query": "architecture",
  "tags": ["server"],
  "minImportance": 5,
  "limit": 10,
  "requestId": "search-1"
}
```

Suggest is opt-in:

```bash
MEMORY_SUGGEST_ENABLED=true npm start
npm run smoke:suggest
```

Disabled servers return:

```json
{ "type": "suggest-result", "suggestions": [], "requestId": "suggest-1" }
```

## Snapshots

Export:

```json
{ "type": "export", "requestId": "export-1" }
```

Validate:

```json
{ "type": "validate-import", "snapshot": { "entries": {}, "edges": [] }, "requestId": "validate-1" }
```

Import:

```json
{ "type": "import", "snapshot": { "entries": {}, "edges": [] }, "mode": "merge", "requestId": "import-1" }
```

`mode` is `merge` or `replace`; omitted mode defaults to replace for backward compatibility.

## MCP Tools

The stdio adapter exposes:

```text
memory_set, memory_get, memory_search, memory_suggest, memory_map,
memory_relate, memory_unrelate, memory_export, memory_validate_import,
memory_import, memory_audit, memory_bulk_set, memory_bulk_relate
```

MCP results use JSON envelopes:

```json
{ "ok": true }
{ "ok": false, "error": "missing-node" }
```

## Operations

Run the read-only doctor:

```bash
npm run doctor
npm run doctor -- --json
```

The doctor compares the repo, `C:\sharedMemory`, live `/status`, and live `/protocol`. Use it when an agent seems to be talking to the wrong checkout.

Dry-run a restart:

```bash
npm run restart -- --dry-run --port 3001 --dir C:\sharedMemory
```

The restart script refuses to stop an unrelated process on the target port unless `--force` is supplied.

Important operational rule: Node does not reload changed modules in a running process. If you edit protocol constants or relation types, fully restart the server and then verify `/protocol`.

## Testing

```bash
node --check server.js
node --check mcp-server.mjs
node --check scripts/*.js
node --check src/*.js
node --check test/*.js
npm test
```

Tests use Node's built-in `node:test` runner and deterministic fake clocks/schedulers where timing matters.
