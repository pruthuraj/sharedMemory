# sharedMemory

A local coordination server for multi-agent systems. Agents share a persistent, queryable memory graph over WebSocket; LLM integrations connect via a standard MCP stdio adapter.

---

## How it works

At its core, sharedMemory is an in-process SQLite database wrapped in a WebSocket server. Agents connect, register an ID, and read/write named memory entries. Each entry carries structured metadata — a summary, tags, importance, and optional TTL — alongside typed graph edges that link entries together. A second protocol layer (MCP stdio) exposes the same memory to LLM toolchains without running a WebSocket client.

The optional semantic suggestion engine indexes entry summaries into a vector space so agents can ask "what do I already know that's relevant to this context?" rather than issuing exact-key lookups.

### Module map

| Module | Role |
|---|---|
| `src/server.js` | HTTP + WebSocket listener, auth gating, route dispatch, background prune |
| `src/memory-store.js` | SQLite CRUD, TTL expiry, FTS5 search, graph relations, import/export |
| `src/protocol.js` | JSON message parsing and validation |
| `src/agent-registry.js` | Agent IDs, subscriptions, cross-agent links, disconnect handling |
| `src/delivery.js` | Safe WebSocket broadcast and direct-message delivery |
| `src/suggestion-engine.js` | Semantic suggestion queue and ranking pipeline |
| `src/vector-index.js` | In-memory cosine similarity index |
| `src/embedding-adapter.js` | Lazy-loading Hugging Face ONNX embedder |
| `mcp-server.mjs` | Official stdio MCP adapter |

### Request lifecycle

```
WebSocket JSON
  → parseMessage (protocol.js)
  → command switch (server.js)
  → memory-store / agent-registry / suggestion-engine
  → direct response + optional subscription broadcasts
```

Request IDs are transport-only. Direct responses echo the `requestId`; broadcasts (subscriptions, linked-agent forwards) do not.

---

## Setup

**Requirements:** Node.js 24+ (uses `node:sqlite`), npm 10+.

```bash
npm install
npm start          # in-memory store, port 3000
npm test           # full test suite
npm run mcp        # stdio MCP adapter only
```

### Configuration

All options are environment variables. None are required.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP/WebSocket listen port |
| `MEMORY_FILE` | _(none)_ | SQLite file path — enables persistence |
| `MEMORY_TOKEN` | _(none)_ | Bearer token for WebSocket + `/status` auth |
| `MEMORY_SUGGEST_ENABLED` | `false` | Enable semantic suggestions |
| `MEMORY_EMBED_MODEL` | `onnx-community/all-MiniLM-L6-v2-ONNX` | Embedding model for suggestions |

**Persistence:** When `MEMORY_FILE` is set, every write is immediately durable via SQLite WAL. Shutdown handlers flush any remaining dirty state before exit. To recover a corrupt database, delete the `.db` file and optionally re-import a snapshot.

**Semantic suggestions:** The first `suggest` call downloads ~25 MB of ONNX model weights and indexes all entry summaries. Subsequent calls are fast. Smoke-test with:

```bash
MEMORY_SUGGEST_ENABLED=true npm start   # terminal 1
npm run smoke:suggest                   # terminal 2
```

### Integrating with Claude Code (plugin)

Install as a Claude Code plugin — MCP tools, `UserPromptSubmit` hook, and `/memory-capture` skill load automatically:

```
/plugin install shared-memory@pruthuraj
```

Or add to `~/.claude/settings.json` manually:

```json
"enabledPlugins": { "shared-memory@pruthuraj": true },
"extraKnownMarketplaces": {
  "pruthuraj": { "source": { "source": "github", "repo": "pruthuraj/sharedMemory" } }
}
```

The plugin runs `mcp-server.mjs` from `SHARED_MEMORY_INSTALL_DIR` (default `C:\sharedMemory` on Windows, `~/.shared-memory` on other platforms). Override env vars in `plugin.json` if needed:

| Variable | Default | Purpose |
|---|---|---|
| `SHARED_MEMORY_INSTALL_DIR` | `C:\sharedMemory` | Where server code lives |
| `MEMORY_FILE` | `C:\sharedMemory\data\memory.db` | SQLite persistence path |
| `PORT` | `3000` | Server port |

### Integrating with Claude Desktop (Windows)

The MCP entry point is `mcp-server.mjs`. Point directly at the install dir:

```json
{
  "mcpServers": {
    "shared-memory": {
      "command": "node",
      "args": ["C:\\sharedMemory\\mcp-server.mjs"],
      "env": {
        "MCP_ENABLED": "true",
        "MEMORY_FILE": "C:\\sharedMemory\\data\\memory.db"
      }
    }
  }
}
```

---

## WebSocket protocol

Connect to `ws://localhost:3000`. When `MEMORY_TOKEN` is set, send an `auth` command before anything else.

All messages are JSON with a required `type` field. Responses echo `requestId` if you provided one.

### Authentication

```json
{ "type": "auth", "token": "secret", "requestId": "auth-1" }
→ { "type": "authenticated", "requestId": "auth-1" }
```

When auth is disabled, sockets behave as pre-authenticated. Unauthenticated commands on a protected socket return `{ "type": "error", "message": "unauthorized" }` but keep the socket open for retry.

### Registering an agent

```json
{ "type": "register", "agentId": "agentA", "requestId": "reg-1" }
→ { "type": "registered", "agentId": "agentA", "requestId": "reg-1" }
```

If a live connection already owns the ID, you get `duplicate-agent`. Offline IDs are reclaimable.

### Memory CRUD

**Write** an entry with optional metadata and TTL:

```json
{
  "type": "set",
  "key": "project.architecture",
  "value": "Full details here...",
  "summary": "Server split into focused modules.",
  "tags": ["architecture"],
  "importance": 8,
  "requestId": "set-1"
}
→ { "type": "ok", "action": "set", "key": "project.architecture", "revision": 1, "requestId": "set-1" }
```

`importance` is `0–10`. If `summary` is omitted the server generates one from the value. For temporary entries, pass `ttlMs` (milliseconds from now) or `expiresAt` (absolute ms timestamp).

For optimistic locking, pass `ifRevision`: positive integer must match the current revision, `null` means create-only (fails if key already exists and is not expired).

**Read** and **delete** follow the same pattern:

```json
{ "type": "get", "key": "project.architecture", "requestId": "get-1" }
{ "type": "delete", "key": "project.architecture", "requestId": "del-1" }
```

`get` returns `entry: null` for missing or expired keys. `delete` cascades all graph edges. Both support `ifRevision`.

**Refresh expiry** without changing the value:

```json
{ "type": "touch", "key": "session.note", "ttlMs": 600000, "requestId": "touch-1" }
```

Omit both expiry fields to make a temporary entry permanent.

### Subscriptions

Subscribe to a key and receive live push updates whenever it changes:

```json
{ "type": "subscribe", "key": "project.architecture", "requestId": "sub-1" }
```

If the key already exists you get an immediate `update` message. Future writes from any agent trigger more. Deletions arrive as `{ "type": "update", "entry": null, "action": "deleted" }`.

### Memory graph

Link any two entries with a typed edge:

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

Allowed relation types: `related_to`, `depends_on`, `supports`, `contradicts`, `mentions`, `derived_from`, `next_step`.

Duplicate `from+relation+to` triples update the existing edge. Both endpoints must exist; self-relations are rejected. Subscribers to either endpoint receive a `relation-update` broadcast.

Remove an edge with `unrelate` (idempotent). Edges cascade-delete when an endpoint is deleted or expires.

### Graph navigation

Retrieve a metadata-only neighborhood via BFS — useful for low-token recall:

```json
{ "type": "map", "key": "project.architecture", "depth": 2, "limit": 10, "requestId": "map-1" }
```

Returns `nodes` (root first, then sorted by importance desc → updatedAt desc → key asc) and `edges`. Expired nodes are skipped. `depth` defaults to `1`, `limit` to `20`.

### Search

Full-text search across key, summary, and tags:

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

All filters use AND semantics. At least one filter is required. Queries shorter than 3 characters return no results (FTS5 trigram tokenization).

### Semantic suggestions

When suggestions are enabled, ask for context-aware recommendations:

```json
{
  "type": "suggest",
  "context": "implement the database migration plan",
  "tags": ["database"],
  "limit": 5,
  "requestId": "suggest-1"
}
```

Results are scored by cosine similarity plus tag and importance bonuses. Disabled servers return an empty `suggestions` array without loading the model.

### Bulk operations

Write many entries or relations in one round-trip with per-item failure isolation:

```json
{ "type": "bulk_set", "entries": [ { "key": "...", "value": "..." }, ... ] }
{ "type": "bulk_relate", "relations": [ { "from": "...", "to": "...", "relation": "..." }, ... ] }
```

### Pruning

Remove all expired entries and cascade their edges:

```json
{ "type": "prune", "requestId": "prune-1" }
→ { "type": "pruned", "keys": ["session.note"], "count": 1, "requestId": "prune-1" }
```

Pruning also runs automatically on a background timer (default interval 600 s).

### Memory hygiene

Audit for quality issues:

```json
{ "type": "audit", "requestId": "audit-1" }
```

Returns `{ zombies, orphans, duplicates, stale, expired, counts }`. Zombies are entries with importance 0, no tags, or empty summary. `memory_set` also returns a `warnings` array when metadata is thin — the write still succeeds.

### Agent links

Create a one-way logical link so another agent receives forwarded `set` notifications:

```json
{ "type": "link", "target": "agentB", "requestId": "link-1" }
```

Offline targets are skipped safely. Remove with `unlink`.

### Snapshots

Export the full graph:

```json
{ "type": "export", "requestId": "export-1" }
```

Validate without mutating:

```json
{ "type": "validate-import", "snapshot": { "entries": {}, "edges": [] }, "requestId": "validate-1" }
```

Import in `merge` mode (adds new entries, leaves existing ones untouched — idempotent) or `replace` mode (full graph replacement):

```json
{ "type": "import", "snapshot": { ... }, "mode": "merge", "requestId": "import-1" }
```

Successful imports broadcast `{ "type": "snapshot-update", "action": "imported", "mode": "..." }` to all connected agents.

### Error codes

| Code | Meaning |
|---|---|
| `invalid-json` / `invalid-message` | Parse error or non-object message |
| `unknown-type` | Missing or unrecognized `type` field |
| `unauthorized` | Auth failure or command before auth |
| `missing-key` / `missing-agentId` / `missing-from` / `missing-to` / `missing-target` | Required field absent |
| `duplicate-agent` | Live connection already owns this agent ID |
| `invalid-summary` / `invalid-tags` / `invalid-importance` / `invalid-expiry` | Metadata validation failure |
| `invalid-ifRevision` | Not a positive integer or null |
| `revision-conflict` | Versioned write failed — echoes `currentRevision` |
| `invalid-relation` | Relation type not in allowed list |
| `invalid-weight` | Not `0–1` |
| `missing-node` | Relation endpoint does not exist |
| `self-relation-not-allowed` | `from` and `to` are the same key |
| `missing-filter` | Search called with no filters |
| `missing-context` / `invalid-context` | Suggest called with bad context |
| `missing-snapshot` / `invalid-snapshot` | Import payload missing or malformed |

---

## MCP tools

The stdio adapter (`mcp-server.mjs`) exposes these tools to LLM clients:

| Tool | Description |
|---|---|
| `memory_set` | Store a key with metadata, tags, importance, TTL |
| `memory_get` | Retrieve full entry for a key |
| `memory_search` | Full-text + metadata search |
| `memory_suggest` | Semantic suggestions (requires `MEMORY_SUGGEST_ENABLED=true`) |
| `memory_map` | Metadata-only graph neighborhood |
| `memory_audit` | Quality audit (zombies, orphans, duplicates, stale) |
| `memory_bulk_set` | Many writes in one round-trip |
| `memory_bulk_relate` | Many relations in one round-trip |
| `memory_relate` / `memory_unrelate` | Single edge create/delete |
| `memory_export` | Full snapshot export |
| `memory_validate_import` | Dry-run snapshot validation |
| `memory_import` | Import snapshot (merge or replace) |

---

## HTTP status endpoint

`GET /status` returns server health, metrics, and configuration. When `MEMORY_TOKEN` is set, include `Authorization: Bearer <token>`. Key fields:

- `connectedAgents` — agent IDs with live WebSocket connections
- `memoryCount` / `relationCount` — live (non-expired) entry and edge counts
- `persistence.dirty` — true if unflushed writes exist
- `suggestions.modelLoaded` — true once the embedder is ready
- `audit` — zombie/orphan/duplicate/stale counts (cached 5 s)

---

## Dashboard

Open `http://localhost:3000` in a browser. The static dashboard visualizes the memory graph using [Cytoscape.js](https://js.cytoscape.org/) and connects via the same WebSocket protocol.

- **Node cards** render key, summary, and importance dots as SVG data URIs.
- **Layout modes** — `force` (Cytoscape `cose`) and `hierarchical` (cytoscape-dagre, left-to-right).
- **Settings panel** (`public/js/settings/`) controls palette, relation colors, node scale, and layout. Adding a new setting requires both a schema entry in `schema.js` and a handler in `settings-palette.js`.
- **Memory hygiene badge** — toolbar shows `! N` in red when zombies are present. Click to filter the identity panel.
- **Fuzzy search** — `Ctrl+K` / `Cmd+K` to search any node by key or summary.

---

## Testing

Tests use Node's built-in `node:test` runner with `node:assert/strict` — no external test framework.

```bash
npm test                                       # all suites
node --test test/server.test.js               # WebSocket protocol, auth, notifications
node --test test/memory-store.test.js         # CRUD, graph, FTS, TTL, persistence
node --test test/suggestion-engine.test.js    # suggestion queue, ranking, model loading
node --test test/mcp-tools.test.js            # MCP tool validation and responses
node --test test/mcp-stdio.test.js            # real child-process JSON-RPC integration
```

Tests favor deterministic injection: pass a `clock`/`now` function for time control, inject schedulers to replace debounce/background timers, and inject fake suggestion engines instead of loading real ONNX models. This keeps tests fast and hermetic.

---

## Limitations

- **No persistence by default.** State is lost on restart unless `MEMORY_FILE` is set.
- **Single static token.** `MEMORY_TOKEN` is not a multi-user identity system.
- **Last-write-wins by default.** Use `ifRevision` for optimistic concurrency control.
- **FTS minimum length.** Queries shorter than 3 characters return no results.
- **Model download on first use.** Enabling suggestions downloads ~25 MB of weights on the first `suggest` call.


