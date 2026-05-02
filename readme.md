# MCP Shared Memory Server

This project is a small local WebSocket server for sharing memory between agent-like clients. It is "MCP-like" in purpose, but it does not implement the official Model Context Protocol.

Agents can register an ID, set and get shared keys, subscribe to updates, and link to other agent IDs for forwarded activity notifications. State is in memory only.

## Files
- `server.js`: startup wrapper for `npm start`.
- `src/server.js`: Express, HTTP, WebSocket setup, and lifecycle helpers.
- `src/protocol.js`: JSON message parsing and validation.
- `src/memory-store.js`: in-memory key/value store.
- `src/agent-registry.js`: agent IDs, registrations, subscriptions, links, disconnects.
- `src/delivery.js`: safe WebSocket delivery helpers.
- `example_agent.js`: simple client that registers, subscribes, sets a key, and lists server state.
- `test/server.test.js`: integration tests for the protocol and reliability behavior.

## Quick Start

Install dependencies:

```bash
npm install
```

Start the server:

```bash
npm start
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
  "memoryKeys": ["greeting"]
}
```

- `agents`: all known agent IDs, including offline placeholders.
- `connectedAgents`: agent IDs with a live WebSocket.
- `memoryKeys`: keys currently stored in memory.

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

Response:

```json
{ "type": "ok", "action": "set", "key": "greeting" }
```

The stored entry has this shape:

```json
{
  "value": "hello from agentA",
  "updatedAt": 1714694400000,
  "updatedBy": "agentA"
}
```

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

### `unsubscribe`

Stops updates for a key.

```json
{ "type": "unsubscribe", "key": "greeting" }
```

Response:

```json
{ "type": "unsubscribed", "key": "greeting" }
```

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
- Blank `agentId`: `missing-agentId`
- Duplicate live agent ID: `duplicate-agent`

## Limitations

- State is in memory only and is lost on restart.
- There is no authentication or authorization.
- This is not a real MCP server implementation.
- Concurrent writes are last-write-wins.
