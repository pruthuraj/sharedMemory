# MCP Shared Memory Server

A local shared-memory coordination service for multi-agent systems with built-in semantic search and bidirectional memory graphs. Supports both WebSocket and MCP stdio protocols.

## Overview

**sharedMemory** provides agents with a persistent, queryable memory backend featuring:

- **Distributed Agent Coordination**: Register agents, subscribe to memory updates, and link agents for forwarded notifications
- **Semantic Memory Search**: Full-text search with metadata filtering (tags, importance, timestamps)
- **Memory Graph Relations**: Type-safe edges between memory entries (`depends_on`, `mentions`, `contradicts`, etc.)
- **TTL & Expiry Management**: Automatic cleanup of temporary memories
- **Dual Protocol Support**: WebSocket for real-time coordination, MCP stdio for LLM integrations
- **Optional Persistence**: File-backed SQLite for durability across restarts
- **Semantic Suggestions**: Optional AI-powered context-aware memory recommendations

All state uses an in-process SQLite database. File persistence is optional via `MEMORY_FILE` environment variable.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture & Files](#architecture--files)
3. [Configuration](#configuration)
4. [WebSocket Protocol](#websocket-protocol)
5. [Official MCP Adapter](#official-mcp-adapter)
6. [HTTP Status Endpoint](#http-status-endpoint)
7. [Persistence](#persistence)
8. [Snapshot Import/Export](#snapshot-importexport)
9. [Integration with Claude Desktop](#integrate-with-claude-desktop-or-another-mcp-client)
10. [Testing](#testing)
11. [Limitations](#limitations)

## Architecture & Files

### Core Modules

- **`src/server.js`**: Express HTTP server, WebSocket listener, request routing, auth gating, background prune timer, and notification orchestration
- **`src/memory-store.js`**: SQLite-backed key/value store with metadata, graph relations, TTL expiry, FTS5 full-text search, and persistence helpers
- **`src/protocol.js`**: JSON message parsing and validation for all command types
- **`src/agent-registry.js`**: Agent registration, subscriptions, cross-agent links, and disconnection handling
- **`src/delivery.js`**: Safe WebSocket broadcast and direct-message delivery
- **`src/suggestion-engine.js`**: Semantic suggestion queue, ranking pipeline, and index orchestration
- **`src/vector-index.js`**: In-memory vector index for similarity search
- **`src/embedding-adapter.js`**: Lazy-loading Hugging Face transformer embedder

### Entry Points & Helpers

- **`server.js`**: Startup wrapper for `npm start` (configures persistence)
- **`mcp-server.mjs`**: Official MCP stdio adapter exposing memory tools
- **`example_agent.js`**: Simple WebSocket client demonstrating register, subscribe, set, and list
- **`scripts/smoke-suggest.js`**: Manual smoke test for semantic suggestions with real models
- **`scripts/claude-mcp.ps1`**: Windows PowerShell launcher for Claude Desktop MCP integration

### Tests

- **`test/server.test.js`**: WebSocket protocol, auth, notifications, request IDs, prune, and suggestions
- **`test/memory-store.test.js`**: Store operations, graph traversal, SQLite persistence, FTS search, TTL, and prune
- **`test/suggestion-engine.test.js`**: Suggestion queue, ranking, tombstones, and close behavior
- **`test/mcp-tools.test.js`**: MCP tool envelopes, validation, search/map responses, and suggestion refresh
- **`test/mcp-stdio.test.js`**: Real stdio MCP protocol integration (initialize, tools, tool calls)

## Configuration

### Environment Variables

- **`PORT`** (default: `3000`): HTTP/WebSocket listen port
- **`MEMORY_FILE`** (optional): SQLite database file path for persistence (e.g., `data/memory.db`). Omit for in-memory store
- **`MEMORY_TOKEN`** (optional): Single static bearer token for WebSocket auth. When set, all clients must authenticate before issuing commands
- **`MEMORY_SUGGEST_ENABLED`** (default: `false`): Enable semantic memory suggestions
- **`MEMORY_EMBED_MODEL`** (default: `onnx-community/all-MiniLM-L6-v2-ONNX`): Hugging Face embedding model ID for suggestions

### Requirements

- **Node.js 24.0.0 or newer** (uses `node:sqlite` module)
- **npm 10+** (for workspace support)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

> **Note**: The `node:sqlite` module is experimental and will emit a deprecation warning on startup.

### 2. Start the Server

**Basic (in-memory):**

```bash
npm start
```

**With Persistence:**

```bash
MEMORY_FILE=data/memory.db npm start
```

**With Token Authentication:**

```bash
MEMORY_TOKEN=my-secret npm start
```

**With Semantic Suggestions:**

```bash
MEMORY_SUGGEST_ENABLED=true npm start
```

**All Options Combined:**

```bash
MEMORY_FILE=data/memory.db MEMORY_TOKEN=my-secret MEMORY_SUGGEST_ENABLED=true npm start
```

### 3. Connect & Test

**Check server health:**

```bash
curl http://localhost:3000/status
```

**Run example agents in separate terminals:**

```bash
node example_agent.js agentA
node example_agent.js agentB
```

Each agent will register, subscribe to a key, and display updates in real-time.

### 4. Run Tests

```bash
npm test
```

Or run individual test suites:

```bash
node --test test/server.test.js
node --test test/memory-store.test.js
node --test test/suggestion-engine.test.js
node --test test/mcp-tools.test.js
node --test test/mcp-stdio.test.js
```

### 5. Use the MCP Adapter

**Run the stdio MCP adapter:**

```bash
npm run mcp
```

**Smoke test semantic suggestions (after starting server with suggestions enabled):**

```bash
MEMORY_SUGGEST_ENABLED=true npm start
npm run smoke:suggest  # Run in separate terminal
```

## Integrate with Claude Desktop or Another MCP Client

The MCP entry point is [`mcp-server.mjs`](mcp-server.mjs), which exposes shared-memory tools over stdio. Claude Desktop and other MCP clients can integrate without running the WebSocket server.

### Setup on Windows

For dynamic repo paths, use the launcher script [`scripts/claude-mcp.ps1`](scripts/claude-mcp.ps1). This resolves the repo path at runtime so your Claude Desktop config doesn't require hardcoded paths.

**Preset Configuration:**

```json
{
  "mcpServers": {
    "shared-memory": {
      "command": "powershell",
      "args": [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        "D:\\Pruthu\\cv projects\\test\\sharedMemory\\scripts\\claude-mcp.ps1"
      ],
      "env": {
        "MEMORY_FILE": "D:\\Pruthu\\cv projects\\test\\sharedMemory\\data\\memory.db"
      }
    }
  }
}
```

**Custom Configuration (Recommended for Portability):**

```json
{
  "mcpServers": {
    "shared-memory": {
      "command": "powershell",
      "args": [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        "D:\\Pruthu\\cv projects\\test\\sharedMemory\\scripts\\claude-mcp.ps1"
      ],
      "env": {
        "SHARED_MEMORY_REPO_ROOT": "D:\\Pruthu\\cv projects\\test\\sharedMemory",
        "MEMORY_FILE": "D:\\Pruthu\\cv projects\\test\\sharedMemory\\data\\memory.db"
      }
    }
  }
}
```

**Environment Variables:**

- `SHARED_MEMORY_REPO_ROOT` (optional): Override repo path if the repo moves
- `SHARED_MEMORY_ENTRYPOINT` (optional): Use a different MCP entry point
- `MEMORY_FILE` (optional): Enable persistence; omit for in-memory store
- `MEMORY_TOKEN` (optional): Not used for stdio (local process only)

### Available MCP Tools

The stdio adapter exposes these tools:

| Tool                     | Description                                                   |
| ------------------------ | ------------------------------------------------------------- |
| `memory_set`             | Store a key with optional metadata, tags, importance, and TTL |
| `memory_get`             | Retrieve full entry for a key                                 |
| `memory_search`          | Full-text and metadata search                                 |
| `memory_suggest`         | Semantic suggestions based on context (when enabled)          |
| `memory_map`             | Get a metadata-only graph neighborhood                        |
| `memory_export`          | Export full snapshot with all values                          |
| `memory_validate_import` | Dry-run validate a snapshot                                   |
| `memory_import`          | Import a snapshot (replace or merge mode)                     |

### Other MCP Clients

For non-Claude clients, start the stdio adapter directly:

```bash
node mcp-server.mjs
```

Your client can then register the same tools. Keep the WebSocket server (`npm start`) running separately if you also need the browser dashboard.

## HTTP Status Endpoint

### `GET /status`

Returns server health, metrics, and configuration:

```json
{
  "agents": ["agentA", "agentB"],
  "connectedAgents": ["agentA"],
  "memoryKeys": ["greeting", "project.architecture"],
  "memoryCount": 2,
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

### Field Descriptions

| Field                            | Meaning                                              |
| -------------------------------- | ---------------------------------------------------- |
| `agents`                         | All known agent IDs (including offline placeholders) |
| `connectedAgents`                | Agent IDs with active WebSocket connections          |
| `memoryKeys`                     | Non-expired memory keys currently in store           |
| `memoryCount`                    | Total non-expired entries                            |
| `relationCount`                  | Graph edges between non-expired entries              |
| `expiredMemoryCount`             | Expired entries awaiting prune                       |
| `pruneIntervalMs`                | Background prune timer interval (0 = disabled)       |
| `lastPrunedAt`                   | Last prune timestamp or `null`                       |
| `persistence.enabled`            | `true` if `MEMORY_FILE` is configured                |
| `persistence.file`               | Path to SQLite database file                         |
| `persistence.dirty`              | `true` if unflushed writes exist                     |
| `persistence.lastLoadedAt`       | Timestamp of last database load                      |
| `persistence.lastFlushedAt`      | Timestamp of last sync to disk                       |
| `persistence.lastFlushError`     | Last persistence error or `null`                     |
| `suggestions.enabled`            | `true` if `MEMORY_SUGGEST_ENABLED=true`              |
| `suggestions.modelLoaded`        | `true` once embedder is ready                        |
| `suggestions.activeIndexedCount` | Indexed entries in suggestion vector index           |
| `suggestions.processing`         | `true` if embeddings are being computed              |
| `snapshot.lastExportedAt`        | Last snapshot export timestamp                       |

### Authentication

When `MEMORY_TOKEN` is configured, `/status` requires a bearer token:

```http
GET /status HTTP/1.1
Authorization: Bearer my-secret-token
```

**Success (200):**

```json
{ "agents": [...], ... }
```

**Failure (401):**

```json
{ "error": "unauthorized" }
```

## Persistence

Persistence is optional and controlled via the `MEMORY_FILE` environment variable.

### Enable Persistence

```bash
MEMORY_FILE=data/memory.db npm start
```

The server opens (or creates) a SQLite database at the given path. A missing file starts with an empty graph. An invalid or corrupt file fails startup with a clear error message.

### Durability Guarantees

- Every write (`set`, `touch`, `relate`, `unrelate`, `delete`, `prune`) is **immediately durable**
- SQLite writes are committed synchronously to WAL before the command response is sent
- Edges referencing missing entries are dropped during import to preserve graph integrity
- `SIGINT` and `SIGTERM` flush dirty memory synchronously before process exit

### Dirty Flag & Debounced Flush

The dirty flag and debounced flush act as a semantic acknowledgment layer:

- Writes mark the store as dirty
- Periodic flushing (configurable, default 600ms) syncs dirty state to disk
- Shutdown handlers ensure a final synchronous flush

### Recovery from Corruption

If the database is corrupted:

1. Delete the corrupt file: `rm data/memory.db*`
2. Restart the server to initialize a fresh database
3. Use snapshot import to restore memory from a backup

## Snapshot Import/Export

The WebSocket and MCP protocols support full graph snapshots with optional merge or replace modes.

### Export

Export the complete graph including all values:

**WebSocket:**

```json
{ "type": "export", "requestId": "export-1" }
```

**Response:**

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
        "revision": 1,
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

### Snapshot Formats

**Merge Mode:**

- Adds only new entries and edges
- Leaves existing memory untouched
- Idempotent and safe for repeated imports
- Default for dashboard uploads

**Replace Mode:**

- Replaces the entire graph with the imported snapshot
- Destructive—use only for deliberate restores
- Remains default for backward compatibility

### Import Validation

Dry-run validation without mutation:

```json
{
  "type": "validate-import",
  "snapshot": { "entries": {}, "edges": [] },
  "requestId": "validate-1"
}
```

### Import Execution

```json
{
  "type": "import",
  "snapshot": { "entries": {}, "edges": [] },
  "mode": "merge",
  "requestId": "import-1"
}
```

**Response:**

```json
{
  "type": "import-result",
  "ok": true,
  "mode": "merge",
  "stats": { "entryCount": 0, "edgeCount": 0 },
  "requestId": "import-1"
}
```

### Failure Handling

Invalid imports return detailed errors:

```json
{
  "ok": false,
  "error": "invalid-snapshot",
  "errors": [
    "Entry 'key1' has invalid expiry",
    "Relation from 'missing_key' to 'key2' not allowed"
  ]
}
```

### Snapshot Versioning

- Snapshot exports always include `revision` for each entry
- Strict import accepts older snapshots without `revision` as revision `1`
- Successful imports broadcast `{ "type": "snapshot-update", "action": "imported", "mode": "replace" }` without `requestId`

## WebSocket Protocol

The WebSocket server is the primary real-time coordination interface. Connect to `ws://localhost:3000` (or with auth token if configured).

### Request/Response Model

All WebSocket messages are JSON objects with a required `type` field.

**Request IDs:**

- All commands accept an optional `requestId` (string or finite number)
- Direct responses and errors echo the exact `requestId`
- Broadcasts (`update`, `relation-update`, `linked`, `welcome`) do not include `requestId`

**Example Request:**

```json
{ "type": "get", "key": "greeting", "requestId": "get-1" }
```

**Example Response:**

```json
{
  "type": "result",
  "key": "greeting",
  "entry": {
    "value": "hello from agentA",
    "summary": "hello from agentA",
    "tags": [],
    "importance": 0,
    "revision": 1,
    "expiresAt": null,
    "updatedAt": 1714694400000,
    "updatedBy": "agentA"
  },
  "requestId": "get-1"
}
```

---

### Authentication: `auth`

Authenticate when `MEMORY_TOKEN` is configured.

**Request:**

```json
{ "type": "auth", "token": "secret", "requestId": "auth-1" }
```

**Success:**

```json
{ "type": "authenticated", "requestId": "auth-1" }
```

**Failure:**

```json
{ "type": "error", "message": "unauthorized", "requestId": "auth-1" }
```

**Behavior:**

- When auth is enabled, only `auth` is allowed before successful authentication
- Protected commands return `unauthorized` but keep the socket open for retry
- When auth is disabled, sockets behave as pre-authenticated and `auth` is a no-op success

---

### Agent Registration: `register`

Register or confirm an agent ID.

**Request:**

```json
{ "type": "register", "agentId": "agentA", "requestId": "reg-1" }
```

**Success:**

```json
{ "type": "registered", "agentId": "agentA", "requestId": "reg-1" }
```

**Duplicate ID (another live connection owns it):**

```json
{ "type": "error", "message": "duplicate-agent" }
```

**Note:** Offline agent IDs can be reclaimed by a later connection.

---

### Memory Operations: `set` / `get` / `delete`

#### `set` — Store a Memory Entry

**Basic:**

```json
{
  "type": "set",
  "key": "greeting",
  "value": "hello from agentA",
  "requestId": "set-1"
}
```

**With Metadata:**

```json
{
  "type": "set",
  "key": "project.architecture",
  "value": "Full architectural details...",
  "summary": "Server is split into focused modules.",
  "tags": ["architecture", "server"],
  "importance": 8,
  "requestId": "set-1"
}
```

**With TTL (temporary memory):**

```json
{
  "type": "set",
  "key": "session.note",
  "value": "Temporary task context",
  "ttlMs": 600000,
  "requestId": "set-1"
}
```

Alternatively, use absolute `expiresAt` (milliseconds):

```json
{
  "type": "set",
  "key": "session.note",
  "value": "Expires at a specific time",
  "expiresAt": 1714695000000,
  "requestId": "set-1"
}
```

**Response:**

```json
{
  "type": "ok",
  "action": "set",
  "key": "greeting",
  "revision": 1,
  "requestId": "set-1"
}
```

**Stored Entry Shape:**

```json
{
  "value": "hello from agentA",
  "summary": "hello from agentA",
  "tags": [],
  "importance": 0,
  "revision": 1,
  "expiresAt": null,
  "updatedAt": 1714694400000,
  "updatedBy": "agentA"
}
```

**Automatic Summary:** If `summary` is omitted, the server generates a compact fallback by stringifying the value, collapsing whitespace, and capping length.

**Importance:** Must be an integer from `0` to `10`.

**Expiry:**

- Expired entries are hidden from `get`, `list`, `map`, and `search` without deleting them
- Only `prune` or background prune removes expired entries

**Revision Control (Optimistic Locking):**

```json
{
  "type": "set",
  "key": "greeting",
  "value": "new value",
  "ifRevision": 1,
  "requestId": "set-1"
}
```

- `ifRevision: null` = create-only (succeeds only if key is absent or expired)
- Positive integer = must match current revision or fail

**Revision Conflict:**

```json
{
  "type": "error",
  "message": "revision-conflict",
  "key": "greeting",
  "currentRevision": 2,
  "requestId": "set-1"
}
```

#### `get` — Retrieve a Memory Entry

**Request:**

```json
{ "type": "get", "key": "greeting", "requestId": "get-1" }
```

**Response:**

```json
{
  "type": "result",
  "key": "greeting",
  "entry": { ... },
  "requestId": "get-1"
}
```

If the key does not exist or is expired, `entry` is `null`.

#### `delete` — Remove a Memory Entry

**Request:**

```json
{ "type": "delete", "key": "project.architecture", "requestId": "del-1" }
```

**Response:**

```json
{
  "type": "deleted",
  "key": "project.architecture",
  "removed": true,
  "revision": 3,
  "requestId": "del-1"
}
```

**Behavior:**

- Cascades all inbound and outbound graph edges
- Deleting a missing key is safe; returns `removed: false` and `revision: null`
- Supports `ifRevision` for optimistic locking

---

### Subscription & Updates: `subscribe` / `unsubscribe` / `update`

#### `subscribe` — Watch for Memory Changes

**Request:**

```json
{ "type": "subscribe", "key": "greeting", "requestId": "sub-1" }
```

**Response:**

```json
{ "type": "subscribed", "key": "greeting", "requestId": "sub-1" }
```

**Immediate Update (if key exists):**

```json
{
  "type": "update",
  "key": "greeting",
  "entry": { "value": "hello", "revision": 1, ... }
}
```

**Future Updates (when others modify the key):**

```json
{
  "type": "update",
  "key": "greeting",
  "entry": { "value": "new value", "revision": 2, ... },
  "requestId": null
}
```

**Deletion Update:**

```json
{
  "type": "update",
  "key": "greeting",
  "entry": null,
  "action": "deleted"
}
```

#### `unsubscribe` — Stop Watching

**Request:**

```json
{ "type": "unsubscribe", "key": "greeting" }
```

**Response:**

```json
{ "type": "unsubscribed", "key": "greeting" }
```

---

### Touch (Refresh Expiry): `touch`

Update expiry and metadata timestamps without changing the stored value.

**Request:**

```json
{
  "type": "touch",
  "key": "session.note",
  "ttlMs": 600000,
  "requestId": "touch-1"
}
```

**Response:**

```json
{
  "type": "touched",
  "key": "session.note",
  "entry": { ... },
  "requestId": "touch-1"
}
```

**Behavior:**

- Accepts either `ttlMs` or `expiresAt`, but not both
- Omitting both expiry fields clears expiry (memory becomes permanent)
- Supports `ifRevision` for optimistic locking
- Stale checks return `revision-conflict`

---

### Memory Graph: `relate` / `unrelate` / `relation-update`

Create typed edges between memory entries for rich context.

#### `relate` — Create/Update an Edge

**Request:**

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

**Response:**

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
  },
  "requestId": "rel-1"
}
```

**Supported Relations:**

- `related_to`
- `depends_on`
- `supports`
- `contradicts`
- `mentions`
- `derived_from`
- `next_step`

**Behavior:**

- Duplicate `from + relation + to` edges update the existing edge (action: "updated")
- Both endpoints must exist as memory entries
- Self-relations are not allowed

#### `unrelate` — Remove an Edge

**Request:**

```json
{
  "type": "unrelate",
  "from": "project.database",
  "to": "project.architecture",
  "relation": "depends_on",
  "requestId": "unrel-1"
}
```

**Response:**

```json
{
  "type": "unrelated",
  "from": "project.database",
  "to": "project.architecture",
  "relation": "depends_on",
  "requestId": "unrel-1"
}
```

**Behavior:** Idempotent—removing a non-existent edge succeeds without error.

#### `relation-update` — Broadcast on Graph Changes

Subscribers to either endpoint receive notifications:

```json
{
  "type": "relation-update",
  "action": "created",
  "keys": ["project.database", "project.architecture"],
  "edge": { ... }
}
```

**Actions:** `created`, `updated`, `deleted`, `cascade-deleted` (edge deleted due to endpoint expiry/deletion)

---

### Graph Navigation: `map`

Get a deterministic metadata-only neighborhood for low-token recall.

**Request:**

```json
{
  "type": "map",
  "key": "project.architecture",
  "depth": 2,
  "limit": 10,
  "requestId": "map-1"
}
```

**Response:**

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
      "revision": 1,
      "updatedAt": 1714694400000,
      "updatedBy": "agentA"
    }
  ],
  "edges": [],
  "requestId": "map-1"
}
```

**Behavior:**

- Uses bidirectional breadth-first search with a visited set (no cycles)
- Root key included first
- Remaining nodes sorted by: importance (desc), updatedAt (desc), key (asc)
- Expired nodes and edges touching expired nodes are skipped
- `depth` defaults to `1`, `limit` defaults to `20`

---

### Search: `search`

Full-text search on memory metadata (no values).

**Request:**

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

**Response:**

```json
{
  "type": "search-result",
  "results": [
    {
      "key": "project.architecture",
      "summary": "Server is split into focused modules.",
      "tags": ["architecture", "server"],
      "importance": 8,
      "revision": 1,
      "updatedAt": 1714694400000,
      "updatedBy": "agentA"
    }
  ],
  "total": 1,
  "requestId": "search-1"
}
```

**Filters (AND semantics):**

- `query`: Case-insensitive match against key, summary, tags
- `tags`: All requested tags must be present
- `minImportance`: `0` to `10`
- `limit`: `1` to `100` (default: `20`)

**Requirements:** At least one of `query`, non-empty `tags`, or `minImportance` must be provided.

**FTS Limitation:** Queries shorter than 3 characters return no results.

---

### Semantic Suggestions: `suggest`

Get context-aware memory recommendations (when suggestions are enabled).

**Request:**

```json
{
  "type": "suggest",
  "context": "implement the database migration plan",
  "tags": ["database"],
  "limit": 5,
  "requestId": "suggest-1"
}
```

**Response:**

```json
{
  "type": "suggest-result",
  "suggestions": [
    {
      "key": "project.database",
      "summary": "Database migration approach.",
      "tags": ["database"],
      "importance": 8,
      "revision": 1,
      "score": 0.87,
      "reasons": ["semantic-match", "high-importance"]
    }
  ],
  "requestId": "suggest-1"
}
```

**Behavior:**

- `context` must be a non-empty string
- `limit` must be `1` to `20`
- `tags` uses AND semantics
- Disabled servers return empty `suggestions` array without loading the model
- Enable with `MEMORY_SUGGEST_ENABLED=true`

---

### Pruning: `prune`

Remove all expired memory entries and cascade their edges.

**Request:**

```json
{ "type": "prune", "requestId": "prune-1" }
```

**Response:**

```json
{
  "type": "pruned",
  "keys": ["session.note"],
  "count": 1,
  "requestId": "prune-1"
}
```

**Subscriber Notifications:**

```json
{
  "type": "update",
  "key": "session.note",
  "entry": null,
  "action": "expired"
}
```

Cascaded edges emit `relation-update` with `action: "cascade-deleted"`.

---

### Agent Links: `link` / `unlink` / `linked`

Create one-way logical links for cross-agent notifications.

#### `link` — Create a Link

**Request:**

```json
{ "type": "link", "target": "agentB", "requestId": "link-1" }
```

**Response:**

```json
{ "type": "linked", "target": "agentB", "requestId": "link-1" }
```

#### `unlink` — Remove a Link

**Request:**

```json
{ "type": "unlink", "target": "agentB" }
```

**Response:**

```json
{ "type": "unlinked", "target": "agentB" }
```

#### `linked` — Forwarded Notifications

When the source agent performs a `set`, live linked targets receive:

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

**Note:** Offline linked targets are skipped safely.

---

### Utility: `list`

List known agent IDs and memory keys.

**Request:**

```json
{ "type": "list", "requestId": "list-1" }
```

**Response:**

```json
{
  "type": "list",
  "agents": ["agentA", "agentB"],
  "memoryKeys": ["greeting"],
  "requestId": "list-1"
}
```

**Note:** Expired keys are omitted from `memoryKeys`.

---

### Error Handling

Invalid input returns:

```json
{ "type": "error", "message": "error-code", "requestId": "..." }
```

| Error Code                  | Meaning                                            |
| --------------------------- | -------------------------------------------------- |
| `invalid-json`              | JSON parse error                                   |
| `invalid-message`           | JSON is not an object                              |
| `invalid-requestId`         | Request ID is not a string or finite number        |
| `unknown-type`              | Unknown or missing `type` field                    |
| `unauthorized`              | Auth failure or protected command before auth      |
| `missing-key`               | Missing or blank `key` field                       |
| `missing-target`            | Missing or blank `target` field                    |
| `missing-from`              | Missing or blank `from` field                      |
| `missing-to`                | Missing or blank `to` field                        |
| `missing-agentId`           | Missing or blank `agentId` field                   |
| `duplicate-agent`           | Live connection already owns this agent ID         |
| `invalid-summary`           | Summary failed validation                          |
| `invalid-tags`              | Tags failed validation                             |
| `invalid-importance`        | Importance is not 0–10                             |
| `invalid-expiry`            | `ttlMs` or `expiresAt` is invalid                  |
| `invalid-ifRevision`        | `ifRevision` is not a positive integer or null     |
| `invalid-relation`          | Relation type not in allowed list                  |
| `invalid-reason`            | Reason failed validation                           |
| `invalid-weight`            | Weight is not 0–1                                  |
| `invalid-depth`             | Depth is not a positive integer                    |
| `invalid-limit`             | Limit is not 1–100                                 |
| `invalid-query`             | Query failed validation                            |
| `missing-filter`            | Search has no filters                              |
| `missing-context`           | Suggest has no context                             |
| `invalid-context`           | Context failed validation                          |
| `missing-snapshot`          | Import missing snapshot object                     |
| `invalid-snapshot`          | Snapshot structure is invalid                      |
| `revision-conflict`         | Versioned write failed (current revision mismatch) |
| `missing-node`              | Relation endpoint does not exist                   |
| `self-relation-not-allowed` | From and to are the same key                       |

## Limitations

- **No Persistence by Default**: State is lost on restart unless `MEMORY_FILE` is configured. File persistence uses SQLite WAL for atomic writes
- **Single Static Token**: `MEMORY_TOKEN` is a single bearer token, not a multi-user identity system
- **WebSocket is Project-Specific**: The WebSocket protocol is custom; use `npm run mcp` for official MCP tool access
- **Last-Write-Wins by Default**: Concurrent writes overwrite unless clients use `ifRevision` for optimistic locking
- **FTS Search Limitation**: Queries shorter than 3 characters return no results due to trigram tokenization

## Testing

Tests use Node.js built-in `node:test` and `node:assert/strict` (no external test framework).

### Run All Tests

```bash
npm test
```

This runs all test files in the `test/` directory.

### Run Individual Test Suites

```bash
node --test test/server.test.js           # WebSocket protocol, auth, notifications
node --test test/memory-store.test.js     # Store operations, graph traversal, persistence
node --test test/suggestion-engine.test.js # Suggestions, embeddings, ranking
node --test test/mcp-tools.test.js        # MCP tool validation and responses
node --test test/mcp-stdio.test.js        # Real stdio MCP JSON-RPC integration
```

### Test Coverage

| Suite                       | Focus                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `server.test.js`            | WebSocket protocol, command routing, auth, subscriptions, broadcasts, request IDs, error handling  |
| `memory-store.test.js`      | CRUD operations, graph relations, FTS search, TTL expiry, prune, SQLite persistence, import/export |
| `suggestion-engine.test.js` | Suggestion queue, semantic ranking, model loading, tombstones, close behavior                      |
| `mcp-tools.test.js`         | MCP tool envelopes, parameter validation, response formatting, search/map results                  |
| `mcp-stdio.test.js`         | Real child process MCP JSON-RPC, initialize handshake, tool discovery, tool calls                  |

### Test Patterns

Tests use dependency injection for determinism:

- Inject clock or `now` function for time control
- Inject schedulers for async operations
- Inject fake suggestion engines instead of loading real models
- Deterministic graph traversal with reproducible sort order

### Example: Writing a Test

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/memory-store.js";

test("memory store set and get", async (t) => {
  const store = createMemoryStore();

  // Set a value
  await store.set("greeting", "hello", {});

  // Get it back
  const entry = await store.get("greeting");
  assert.equal(entry.value, "hello");
});
```
