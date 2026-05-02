# MCP Shared Memory Server

This project is a small local WebSocket server for sharing memory between agent-like clients. It is "MCP-like" in purpose, but it does not implement the official Model Context Protocol.

Agents can register an ID, set and get shared keys, subscribe to updates, relate memories through a deterministic graph, and link to other agent IDs for forwarded activity notifications. State is in memory by default, with optional JSON persistence.

## Files
- `server.js`: startup wrapper for `npm start`.
- `src/server.js`: Express, HTTP, WebSocket setup, and lifecycle helpers.
- `src/protocol.js`: JSON message parsing and validation.
- `src/memory-store.js`: in-memory key/value store and memory graph.
- `src/agent-registry.js`: agent IDs, registrations, subscriptions, links, disconnects.
- `src/delivery.js`: safe WebSocket delivery helpers.
- `example_agent.js`: simple client that registers, subscribes, sets a key, and lists server state.
- `test/server.test.js`: integration tests for the WebSocket protocol.
- `test/memory-store.test.js`: focused graph traversal and sorting tests.

## Quick Start

Install dependencies:

```bash
npm install
```

Start the server:

```bash
npm start
```

Start with persistent storage:

```bash
MEMORY_FILE=data/memory.json npm start
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

## HTTP Status

`GET /status` returns:

```json
{
  "agents": ["agentA"],
  "connectedAgents": ["agentA"],
  "memoryKeys": ["greeting"],
  "memoryCount": 1,
  "relationCount": 0,
  "persistence": {
    "enabled": true,
    "file": "D:\\Pruthu\\cv projects\\test\\sharedMemory\\data\\memory.json",
    "dirty": false,
    "lastLoadedAt": 1714694400000,
    "lastFlushedAt": 1714694400500,
    "lastFlushError": null
  }
}
```

- `agents`: all known agent IDs, including offline placeholders.
- `connectedAgents`: agent IDs with a live WebSocket.
- `memoryKeys`: keys currently stored in memory.
- `memoryCount`: number of memory entries.
- `relationCount`: number of memory graph edges.
- `persistence`: durability status. When `MEMORY_FILE` is unset, `enabled` is `false`.

## Persistence

Persistence is optional and controlled by `MEMORY_FILE`.

```bash
MEMORY_FILE=data/memory.json npm start
```

The server loads the file on startup. Missing files start with an empty graph. Invalid JSON fails startup clearly. Edges that reference missing memory entries are dropped during load to preserve graph integrity.

Runtime mutations stay RAM-first. `set`, `relate`, `unrelate`, and `delete` mark the store dirty and schedule a debounced flush. The flush writes JSON atomically by writing a temp file next to the target and renaming it over the target. `close()`, `SIGINT`, and `SIGTERM` force a final flush.

Persisted JSON shape:

```json
{
  "entries": {
    "project.architecture": {
      "value": "Full details...",
      "summary": "Server is split into focused modules.",
      "tags": ["architecture", "server"],
      "importance": 8,
      "updatedAt": 1714694400000,
      "updatedBy": "agentA"
    }
  },
  "edges": [
    {
      "from": "project.database",
      "to": "project.architecture",
      "relation": "depends_on",
      "reason": "Database choices affect architecture.",
      "weight": 0.8,
      "updatedAt": 1714694400100,
      "updatedBy": "agentA"
    }
  ]
}
```

## WebSocket Protocol

Connect to:

```text
ws://localhost:3000
```

All messages are JSON objects with a `type` field.

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
  "updatedAt": 1714694400000,
  "updatedBy": "agentA"
}
```

If `summary` is omitted, the server generates a compact fallback by stringifying the value, collapsing whitespace, and capping length. `importance` must be an integer from `0` to `10`.

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
    "updatedAt": 1714694400000,
    "updatedBy": "agentA"
  }
}
```

If the key does not exist, `entry` is `null`.

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

`map` uses bidirectional breadth-first search with a visited set, so cycles cannot duplicate nodes or loop forever. Returned edges preserve original `from`, `to`, and `relation`. The root key is included first; the remaining nodes are sorted by importance descending, `updatedAt` descending, then key ascending before applying `limit`.

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

## Validation

The server returns `{ "type": "error", "message": "..." }` for invalid input.

- Invalid JSON: `invalid-json`
- JSON that is not an object: `invalid-message`
- Unknown or missing command type: `unknown-type`
- Missing or blank `key`: `missing-key`
- Missing or blank `target`: `missing-target`
- Missing or blank `from`: `missing-from`
- Missing or blank `to`: `missing-to`
- Blank `agentId`: `missing-agentId`
- Duplicate live agent ID: `duplicate-agent`
- Invalid metadata: `invalid-summary`, `invalid-tags`, `invalid-importance`
- Invalid graph request: `invalid-relation`, `invalid-reason`, `invalid-weight`, `invalid-depth`, `invalid-limit`
- Relation endpoint does not exist: `missing-node`
- Self-relation: `self-relation-not-allowed`

## Limitations

- State is lost on restart unless `MEMORY_FILE` is configured.
- There is no authentication or authorization.
- This is not a real MCP server implementation.
- Concurrent writes are last-write-wins.
