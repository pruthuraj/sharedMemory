# MCP Shared Memory Server

This project is a small local shared-memory service for agent-like clients. It exposes the original WebSocket protocol and an official stdio MCP adapter for direct MCP tool calls.

Agents can register an ID, set and get shared keys, subscribe to updates, relate memories through a deterministic graph, request semantic suggestions, and link to other agent IDs for forwarded activity notifications. State uses an in-process SQLite database by default, with optional file-backed SQLite persistence.

## Files
- `server.js`: startup wrapper for `npm start`.
- `src/server.js`: Express, HTTP, WebSocket setup, and lifecycle helpers.
- `src/protocol.js`: JSON message parsing and validation.
- `src/memory-store.js`: SQLite-backed key/value store, metadata search, TTL, and memory graph.
- `src/suggestion-engine.js`: semantic memory suggestion queue, ranking, and index orchestration.
- `src/mcp-tools.js`: transport-independent handlers for official MCP tools.
- `src/agent-registry.js`: agent IDs, registrations, subscriptions, links, disconnects.
- `src/delivery.js`: safe WebSocket delivery helpers.
- `mcp-server.mjs`: official stdio MCP adapter.
- `scripts/smoke-suggest.js`: manual real-model suggestion smoke client.
- `example_agent.js`: simple client that registers, subscribes, sets a key, and lists server state.
- `test/server.test.js`: integration tests for the WebSocket protocol.
- `test/memory-store.test.js`: focused graph traversal and sorting tests.
- `test/suggestion-engine.test.js`: semantic suggestion queue, ranking, and index tests.
- `test/mcp-tools.test.js`: transport-independent MCP tool handler tests.
- `test/mcp-stdio.test.js`: real stdio MCP protocol integration tests.

## Quick Start

Install dependencies:

```bash
npm install
```

Use Node.js 24 or newer. Persistence uses Node's built-in `node:sqlite` module, which currently prints an experimental warning.

Start the server:

```bash
npm start
```

Start with persistent storage:

```bash
MEMORY_FILE=data/memory.db npm start
```

Start with token authentication:

```bash
MEMORY_TOKEN=secret npm start
```

Start with semantic suggestions enabled:

```bash
MEMORY_SUGGEST_ENABLED=true npm start
```

Run example agents in separate terminals:

```bash
node example_agent.js agentA
node example_agent.js agentB
```

Check server status:

```bash
curl http://localhost:3000/status
```

Run tests:

```bash
npm test
```

Run the official stdio MCP adapter:

```bash
npm run mcp
```

Run the manual real-model suggestion smoke test in a second terminal after starting the server with suggestions enabled:

```bash
MEMORY_SUGGEST_ENABLED=true npm start
npm run smoke:suggest
```

## HTTP Status

`GET /status` returns:

```json
{
  "agents": ["agentA"],
  "connectedAgents": ["agentA"],
  "memoryKeys": ["greeting"],
  "memoryCount": 1,
  "relationCount": 0,
  "expiredMemoryCount": 0,
  "pruneIntervalMs": 600000,
  "lastPrunedAt": null,
  "persistence": {
    "enabled": true,
    "file": "D:\\Pruthu\\cv projects\\test\\sharedMemory\\data\\memory.db",
    "dirty": false,
    "lastLoadedAt": 1714694400000,
    "lastFlushedAt": 1714694400500,
    "lastFlushError": null
  },
  "suggestions": {
    "enabled": false,
    "modelId": "onnx-community/all-MiniLM-L6-v2-ONNX",
    "modelLoaded": false,
    "activeIndexedCount": 0,
    "queuedUpdateCount": 0,
    "processing": false,
    "lastIndexedAt": null,
    "lastIndexError": null
  },
  "snapshot": {
    "lastExportedAt": null,
    "lastImportedAt": null,
    "lastImportStats": null
  }
}
```

- `agents`: all known agent IDs, including offline placeholders.
- `connectedAgents`: agent IDs with a live WebSocket.
- `memoryKeys`: non-expired keys currently stored in memory.
- `memoryCount`: number of non-expired memory entries.
- `relationCount`: number of graph edges whose endpoints are non-expired.
- `expiredMemoryCount`: expired entries still waiting for prune.
- `pruneIntervalMs`: background prune interval in milliseconds. `0` means disabled.
- `lastPrunedAt`: timestamp of the last explicit or background prune, or `null`.
- `persistence`: durability status. When `MEMORY_FILE` is unset, `enabled` is `false`.
- `suggestions`: semantic suggestion status, including active index size and queued embedding work. Suggestions are disabled unless explicitly enabled.
- `snapshot`: last WebSocket snapshot export/import timestamps and import stats.

When `MEMORY_TOKEN` is set, `/status` requires:

```http
Authorization: Bearer secret
```

Missing or invalid bearer tokens return HTTP `401`:

```json
{ "error": "unauthorized" }
```

## Persistence

Persistence is optional and controlled by `MEMORY_FILE`.

```bash
MEMORY_FILE=data/memory.db npm start
```

The server opens (or creates) a SQLite database at the given path. A missing file starts with an empty graph. An invalid or corrupt file fails startup with a clear error message. Edges that reference missing memory entries are dropped during `importState` to preserve graph integrity.

Every write (`set`, `touch`, `relate`, `unrelate`, `delete`, `prune`) is immediately durable; SQLite writes are committed synchronously to WAL before the command response is sent. The dirty flag and debounced flush still exist as a semantic acknowledgment layer; `close()`, `SIGINT`, and `SIGTERM` clear the dirty flag before the process exits.

## WebSocket Protocol

Connect to:

```text
ws://localhost:3000
```

All messages are JSON objects with a `type` field.

Every command accepts an optional `requestId` string or finite number. Direct responses and direct errors echo the exact value. Broadcasts such as `update`, `relation-update`, cross-agent `linked`, and `welcome` do not include `requestId`.

Example:

```json
{ "type": "get", "key": "greeting", "requestId": "get-1" }
```

Response:

```json
{
  "type": "result",
  "key": "greeting",
  "entry": null,
  "requestId": "get-1"
}
```

### `auth`

Authenticates a WebSocket connection when `MEMORY_TOKEN` is configured.

```json
{ "type": "auth", "token": "secret", "requestId": "auth-1" }
```

Success:

```json
{ "type": "authenticated", "requestId": "auth-1" }
```

Failure:

```json
{ "type": "error", "message": "unauthorized", "requestId": "auth-1" }
```

When auth is enabled, only `auth` is allowed before successful authentication. Protected commands return `unauthorized` and the socket remains open so clients can authenticate and retry. When auth is disabled, sockets behave as authenticated and `auth` is accepted as a no-op success.

### `register`

Registers or confirms an agent ID.

```json
{ "type": "register", "agentId": "agentA" }
```

Response:

```json
{ "type": "registered", "agentId": "agentA" }
```

If another live connection already owns that ID, the server returns:

```json
{ "type": "error", "message": "duplicate-agent" }
```

Offline agent IDs can be reclaimed by a later connection.

### `set`

Stores a memory value.

```json
{ "type": "set", "key": "greeting", "value": "hello from agentA" }
```

Optional graph metadata can be included for low-token recall:

```json
{
  "type": "set",
  "key": "project.architecture",
  "value": "Full details...",
  "summary": "Server is split into focused modules.",
  "tags": ["architecture", "server"],
  "importance": 8
}
```

Temporary memories can expire by passing either `ttlMs` or `expiresAt`, but not both:

```json
{
  "type": "set",
  "key": "session.note",
  "value": "Temporary task context",
  "summary": "Temporary task context",
  "ttlMs": 600000
}
```

`ttlMs` is converted to an absolute `expiresAt` timestamp by the server clock. `expiresAt` must be a positive integer timestamp in milliseconds. Missing expiry means the entry does not expire.

Response:

```json
{ "type": "ok", "action": "set", "key": "greeting" }
```

The stored entry has this shape:

```json
{
  "value": "hello from agentA",
  "summary": "hello from agentA",
  "tags": [],
  "importance": 0,
  "expiresAt": null,
  "updatedAt": 1714694400000,
  "updatedBy": "agentA"
}
```

If `summary` is omitted, the server generates a compact fallback by stringifying the value, collapsing whitespace, and capping length. `importance` must be an integer from `0` to `10`.

Expired entries are hidden from `get`, `list`, `map`, and `search` without deleting or flushing them. Expired entries are removed only by `prune` or the background prune interval.

### `get`

Reads a memory key.

```json
{ "type": "get", "key": "greeting" }
```

Response:

```json
{
  "type": "result",
  "key": "greeting",
  "entry": {
    "value": "hello from agentA",
    "summary": "hello from agentA",
    "tags": [],
    "importance": 0,
    "expiresAt": null,
    "updatedAt": 1714694400000,
    "updatedBy": "agentA"
  }
}
```

If the key does not exist or is expired, `entry` is `null`.

### `touch`

Updates expiry and metadata timestamps without changing the stored value.

```json
{ "type": "touch", "key": "session.note", "ttlMs": 600000, "requestId": "touch-1" }
```

Response:

```json
{
  "type": "touched",
  "key": "session.note",
  "entry": {
    "value": "Temporary task context",
    "summary": "Temporary task context",
    "tags": [],
    "importance": 0,
    "expiresAt": 1714695000000,
    "updatedAt": 1714694400000,
    "updatedBy": "agentA"
  },
  "requestId": "touch-1"
}
```

`touch` accepts either `ttlMs` or `expiresAt`, but not both. If both expiry fields are omitted, the existing expiry is cleared and the memory becomes non-expiring.

### `subscribe`

Subscribes to updates for a key.

```json
{ "type": "subscribe", "key": "greeting" }
```

Response:

```json
{ "type": "subscribed", "key": "greeting" }
```

If the key already has a value, the server immediately sends an `update`. Future `set` calls for the same key also send `update` messages to subscribers.

```json
{
  "type": "update",
  "key": "greeting",
  "entry": {
    "value": "new value",
    "updatedAt": 1714694400000,
    "updatedBy": "agentB"
  }
}
```

If a subscribed key is deleted, subscribers receive:

```json
{
  "type": "update",
  "key": "greeting",
  "entry": null,
  "action": "deleted"
}
```

### `unsubscribe`

Stops updates for a key.

```json
{ "type": "unsubscribe", "key": "greeting" }
```

Response:

```json
{ "type": "unsubscribed", "key": "greeting" }
```

### `relate`

Creates or updates a typed edge between two existing memory keys.

```json
{
  "type": "relate",
  "from": "project.database",
  "to": "project.architecture",
  "relation": "depends_on",
  "reason": "Database choices affect architecture.",
  "weight": 0.8
}
```

Response:

```json
{
  "type": "related",
  "action": "created",
  "edge": {
    "from": "project.database",
    "to": "project.architecture",
    "relation": "depends_on",
    "reason": "Database choices affect architecture.",
    "weight": 0.8,
    "updatedAt": 1714694400000,
    "updatedBy": "agentA"
  }
}
```

Supported relations are `related_to`, `depends_on`, `supports`, `contradicts`, `mentions`, `derived_from`, and `next_step`. Duplicate `from + relation + to` edges update the existing edge and return `action: "updated"`.

### `unrelate`

Removes a typed edge. This is idempotent.

```json
{
  "type": "unrelate",
  "from": "project.database",
  "to": "project.architecture",
  "relation": "depends_on"
}
```

Response:

```json
{
  "type": "unrelated",
  "from": "project.database",
  "to": "project.architecture",
  "relation": "depends_on"
}
```

### `delete`

Deletes a memory key and cascades all inbound and outbound graph edges.

```json
{ "type": "delete", "key": "project.architecture" }
```

Response:

```json
{ "type": "deleted", "key": "project.architecture", "removed": true }
```

Deleting a missing key is safe and returns `removed: false`.

### `prune`

Removes all expired memory entries and cascades their inbound and outbound graph edges.

```json
{ "type": "prune", "requestId": "prune-1" }
```

Response:

```json
{
  "type": "pruned",
  "keys": ["session.note"],
  "count": 1,
  "requestId": "prune-1"
}
```

Subscribers to pruned keys receive:

```json
{
  "type": "update",
  "key": "session.note",
  "entry": null,
  "action": "expired"
}
```

Incident edges removed by expiry emit `relation-update` with `action: "cascade-deleted"`.

### `map`

Returns a deterministic metadata-only graph neighborhood for low-token recall.

```json
{ "type": "map", "key": "project.architecture", "depth": 1, "limit": 10 }
```

Response:

```json
{
  "type": "map-result",
  "key": "project.architecture",
  "nodes": [
    {
      "key": "project.architecture",
      "summary": "Server is split into focused modules.",
      "tags": ["architecture", "server"],
      "importance": 8,
      "updatedAt": 1714694400000,
      "updatedBy": "agentA"
    }
  ],
  "edges": []
}
```

`map` uses bidirectional breadth-first search with a visited set, so cycles cannot duplicate nodes or loop forever. Returned edges preserve original `from`, `to`, and `relation`. The root key is included first; the remaining nodes are sorted by importance descending, `updatedAt` descending, then key ascending before applying `limit`. Expired nodes and edges touching expired nodes are skipped.

### `search`

Searches memory metadata without returning full values.

```json
{
  "type": "search",
  "query": "architecture",
  "tags": ["server"],
  "minImportance": 5,
  "limit": 10
}
```

Filters compose with AND semantics:

- `query`: optional non-empty string matched case-insensitively against key, summary, and tags.
- `tags`: optional array of non-empty strings; every requested tag must be present.
- `minImportance`: optional integer `0` to `10`.
- `limit`: optional integer `1` to `100`, default `20`.

At least one of `query`, non-empty `tags`, or `minImportance` is required.

Response:

```json
{
  "type": "search-result",
  "results": [
    {
      "key": "project.architecture",
      "summary": "Server is split into focused modules.",
      "tags": ["architecture", "server"],
      "importance": 8,
      "updatedAt": 1714694400000,
      "updatedBy": "agentA"
    }
  ],
  "total": 1
}
```

`results` are metadata-only. Use `get` to retrieve full `value`. `total` is the pre-limit match count. Expired entries are not searched.

### `suggest`

Suggests relevant memory metadata for the agent's current task or prompt. Suggestions are semantic and metadata-only; use `get` to load full values for selected keys.

```json
{
  "type": "suggest",
  "context": "implement the database migration plan",
  "tags": ["database"],
  "limit": 5,
  "requestId": "suggest-1"
}
```

Response:

```json
{
  "type": "suggest-result",
  "suggestions": [
    {
      "key": "project.database",
      "summary": "Database migration approach.",
      "tags": ["database"],
      "importance": 8,
      "score": 0.87,
      "reasons": ["semantic-match", "high-importance"]
    }
  ],
  "requestId": "suggest-1"
}
```

`context` must be a non-empty string, `limit` must be `1` to `20`, and `tags` uses AND semantics. Suggestions are disabled by default; disabled servers return `suggest-result` with an empty `suggestions` array and do not load the embedding model. Enable them with `MEMORY_SUGGEST_ENABLED=true` or `createSharedMemoryServer({ suggestions: { enabled: true } })`. When enabled, the semantic index is eventually consistent: `set`, `touch`, `delete`, and `prune` enqueue index updates instead of blocking the write path. `/status.suggestions.modelLoaded` becomes `true` after the embedder has loaded.

### Snapshots

Snapshots export and restore the full graph, including memory values. Public import is strict and replace-only: invalid snapshots are rejected before the store mutates.

Export:

```json
{ "type": "export", "requestId": "export-1" }
```

Response:

```json
{
  "type": "export-result",
  "snapshot": {
    "entries": {
      "project.database": {
        "value": { "engine": "sqlite" },
        "summary": "Database summary",
        "tags": ["database"],
        "importance": 8,
        "expiresAt": null,
        "updatedAt": 1714694400000,
        "updatedBy": "agentA"
      }
    },
    "edges": []
  },
  "stats": { "entryCount": 1, "edgeCount": 0 },
  "requestId": "export-1"
}
```

Dry-run validation:

```json
{ "type": "validate-import", "snapshot": { "entries": {}, "edges": [] }, "requestId": "validate-1" }
```

Successful import:

```json
{ "type": "import", "snapshot": { "entries": {}, "edges": [] }, "requestId": "import-1" }
```

```json
{
  "type": "import-result",
  "ok": true,
  "mode": "replace",
  "stats": { "entryCount": 0, "edgeCount": 0 },
  "requestId": "import-1"
}
```

Invalid import returns `ok: false`, `error: "invalid-snapshot"`, and an `errors` array. Successful imports broadcast `{ "type": "snapshot-update", "action": "imported", "mode": "replace", "stats": { ... } }` without `requestId`.

## Official MCP Adapter

The project also ships an official stdio MCP adapter:

```bash
npm run mcp
```

The adapter uses the same store modules directly; it does not require the WebSocket server to be running. It honors `MEMORY_FILE` for SQLite persistence. `MEMORY_TOKEN` is not used for stdio because the MCP process is local to the client that spawns it.

Exposed tools:

- `memory_set`: store a JSON value plus optional `summary`, `tags`, `importance`, `ttlMs`, and `expiresAt`.
- `memory_get`: load the full entry for a key.
- `memory_search`: return metadata-only search results and `total`.
- `memory_suggest`: return semantic suggestions; disabled suggestions return an empty list without loading the model.
- `memory_map`: return a metadata-only graph neighborhood.
- `memory_export`: export the full snapshot with values.
- `memory_validate_import`: validate a snapshot without mutating.
- `memory_import`: strictly validate and replace the current graph.

MCP tool responses are JSON text payloads with stable envelopes: `{ "ok": true, ... }` for success and `{ "ok": false, "error": "..." }` for domain failures.

### `relation-update`

Subscribers receive relation notifications when an edge touches a subscribed key.

```json
{
  "type": "relation-update",
  "action": "created",
  "keys": ["project.database", "project.architecture"],
  "edge": {
    "from": "project.database",
    "to": "project.architecture",
    "relation": "depends_on",
    "reason": "Database choices affect architecture.",
    "weight": 0.8,
    "updatedAt": 1714694400000,
    "updatedBy": "agentA"
  }
}
```

Actions are `created`, `updated`, `deleted`, and `cascade-deleted`. If a client subscribes to both endpoints, it receives exactly one relation notification.

### `link`

Creates a one-way logical link from the current agent to a target agent ID.

```json
{ "type": "link", "target": "agentB" }
```

Response:

```json
{ "type": "linked", "target": "agentB" }
```

When the source agent performs a `set`, the live linked target receives:

```json
{
  "type": "linked",
  "from": "agentA",
  "payload": {
    "action": "set",
    "key": "greeting",
    "entry": {
      "value": "hello",
      "updatedAt": 1714694400000,
      "updatedBy": "agentA"
    }
  }
}
```

Offline linked targets are skipped safely.

### `unlink`

Removes a one-way link.

```json
{ "type": "unlink", "target": "agentB" }
```

Response:

```json
{ "type": "unlinked", "target": "agentB" }
```

### `list`

Lists known agent IDs and memory keys.

```json
{ "type": "list" }
```

Response:

```json
{
  "type": "list",
  "agents": ["agentA", "agentB"],
  "memoryKeys": ["greeting"]
}
```

Expired keys are omitted from `memoryKeys`.

## Validation

The server returns `{ "type": "error", "message": "..." }` for invalid input.

- Invalid JSON: `invalid-json`
- JSON that is not an object: `invalid-message`
- Invalid request ID: `invalid-requestId`
- Unknown or missing command type: `unknown-type`
- Unauthorized command or auth failure: `unauthorized`
- Missing or blank `key`: `missing-key`
- Missing or blank `target`: `missing-target`
- Missing or blank `from`: `missing-from`
- Missing or blank `to`: `missing-to`
- Blank `agentId`: `missing-agentId`
- Duplicate live agent ID: `duplicate-agent`
- Invalid metadata: `invalid-summary`, `invalid-tags`, `invalid-importance`, `invalid-expiry`
- Invalid graph request: `invalid-relation`, `invalid-reason`, `invalid-weight`, `invalid-depth`, `invalid-limit`
- Invalid search request: `invalid-query`, `missing-filter`
- Invalid suggest request: `missing-context`, `invalid-context`
- Invalid snapshot request: `missing-snapshot`, `invalid-snapshot`
- Relation endpoint does not exist: `missing-node`
- Self-relation: `self-relation-not-allowed`

## Limitations

- State is lost on restart unless `MEMORY_FILE` is configured (SQLite file path).
- Authentication is a single static token when `MEMORY_TOKEN` is configured; it is not a multi-user identity system.
- The WebSocket protocol is project-specific; official MCP access is available through `npm run mcp`.
- Concurrent writes are last-write-wins.
- The FTS5 search index uses trigram tokenization; queries shorter than 3 characters will return no results.
