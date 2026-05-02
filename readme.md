# MCP Shared Memory Server (local)

This project provides a small, local "MCP-like" server that exposes a shared memory store and a simple linking model for AI agents via WebSocket. It's intended for local testing and prototyping: agents can `set` and `get` shared keys, `subscribe` to updates, and link to other agents so messages can be forwarded.
Contents

- [server.js](server.js#L1) — HTTP + WebSocket server and in-memory shared store.
- [example_agent.js](example_agent.js#L1) — small example agent showing register/set/subscribe flows.
- [package.json](package.json#L1) — project metadata and `npm start` script.
  Goals
- Provide a single shared memory surface agents can read/write.
- Notify subscribers when keys change.
- Allow simple agent-to-agent linking (forwarding of messages).
- Keep the system minimal and easy to extend (persistence, auth, CRDTs later).
  Quick start

1. Install dependencies:

```bash
npm install
```

2. Start the server:

```bash
npm start
```

3. Run example agents (in separate terminals):

```bash
node example_agent.js agentA
node example_agent.js agentB
```

Verify

- Check status endpoint:

```bash
curl http://localhost:3000/status
```

- Observe console output from `example_agent.js` — it will register, set a key, and print updates it receives.
  Architecture overview
- HTTP server: small status endpoint at `/status` that lists known agent IDs and stored memory keys.
- WebSocket server: agents connect and speak a tiny JSON protocol.
- In-memory store: a simple object mapping keys → { value, updatedAt, updatedBy }.
- Agents registry: map of agentId → { ws, subscriptions: Set, links: Set }. A disconnected agent keeps a placeholder record so other agents can link to it by ID.
  JSON WebSocket protocol
  All messages are JSON objects. The server replies with JSON. Below are the supported request `type` values, fields, and examples.

- `register`
  - Purpose: set or confirm the agent's ID with the server.
  - Request example:

```json
{ "type": "register", "agentId": "agentA" }
```

- `set`
  - Purpose: set a memory key's value (overwrites previous value).
  - Request example:

```json
{ "type": "set", "key": "greeting", "value": "hello from agentA" }
```

    - Server will store: `{ value, updatedAt, updatedBy }` and broadcast updates to subscribers.

- `get`
  - Purpose: read a key's current entry.
  - Request example:

```json
{ "type": "get", "key": "greeting" }
```

    - Response example:

```json
{ "type": "result", "key": "greeting", "entry": { "value": "hello", "updatedAt": 162..., "updatedBy": "agentA" } }
```

- `subscribe`
  - Purpose: subscribe to updates for a key. Server sends `update` messages when the key changes.
  - Request example:

```json
{ "type": "subscribe", "key": "greeting" }
```

    - Immediate server behavior: acknowledges with `{ type: 'subscribed', key }` and sends current value if present.

- `unsubscribe`
  - Purpose: stop receiving updates for a key.
  - Request example:

```json
{ "type": "unsubscribe", "key": "greeting" }
```

- `link`
  - Purpose: create a logical link from this agent to another agent ID. When this agent performs actions, a linked agent can receive forwarded `linked` notifications.
  - Request example:

```json
{ "type": "link", "target": "agentB" }
```

    - Note: linking only records the target ID on the source agent; it does not enforce bidirectional links.

- `unlink`
  - Purpose: remove a previously created link.

```json
{ "type": "unlink", "target": "agentB" }
```

- `list`
  - Purpose: ask the server for known agent IDs and memory keys.

```json
{ "type": "list" }
```

Server-originated message types

- `welcome`: sent when a connection is first accepted; contains a temporary or assigned `agentId`.
- `registered`: ack for `register` with confirmed `agentId`.
- `ok`: generic acknowledgement for actions like `set`.
- `update`: notification that a key changed. Example payload:

```json
{ "type": "update", "key": "greeting", "entry": { "value": "hi", "updatedAt": 162..., "updatedBy": "agentB" } }
```

- `linked`: delivered to agents that are linked from another agent when that agent performs an action; includes `from` and `payload` fields.

Example agent flow

1. Agent connects to `ws://localhost:3000`.
2. Agent sends `{ "type": "register", "agentId": "agentA" }`.
3. Agent subscribes to `greeting`:

```json
{ "type": "subscribe", "key": "greeting" }
```

4. Another agent sets the key:

```json
{ "type": "set", "key": "greeting", "value": "hello from agentB" }
```

5. The first agent receives an `update` message with the new entry.

Operational notes & limitations

- In-memory only: the current implementation keeps all state in memory. Restarting the server clears memory and agent runtime state.
- No authentication: anyone who can open the WebSocket can register as any agent ID. Consider adding token-based auth in production.
- Concurrency / conflicts: concurrent `set` operations are last-write-wins. For stronger guarantees across distributed agents, use CRDTs or add a leader/locking mechanism.

Extensions — suggested next steps

- Persistence: write memory entries to disk or a small database (SQLite, LevelDB, or Redis) to survive restarts.
- Auth: add TLS + token-based registration and an `admin` role for management operations.
- Message routing: implement bidirectional linking, message queuing for offline agents, or reliable delivery semantics.

Troubleshooting

- If agents don't receive updates:
  - Check server console for errors.
  - Confirm `/status` shows connected agent IDs.
  - Ensure the agent subscribed to the correct key name.

- Use `wscat` or `WebSocket` clients to manually exercise the protocol.

Contact

- If you want, I can add persistence, authentication, or a small dashboard to visualize shared memory. Ask which feature to implement next.

# MCP Shared Memory Server (local)

This repository contains a minimal, local "MCP-like" server that provides a shared memory store and simple linking between AI agents over WebSocket.

Files added:

- [server.js](server.js#L1) — main server (HTTP + WebSocket).
- [example_agent.js](example_agent.js#L1) — example agent client.
- [package.json](package.json#L1) — Node dependencies and start script.

Quick start

1. Install dependencies:

```bash
npm install
```

2. Start the server:

```bash
npm start
```

3. Run an example agent in another terminal:

```bash
node example_agent.js agentA
node example_agent.js agentB
```

Behavior

- Agents connect via WebSocket to `ws://localhost:3000`.
- Simple JSON protocol supported: `register`, `set`, `get`, `subscribe`, `unsubscribe`, `link`, `unlink`, `list`.
- Shared memory is kept in-memory; updates are broadcast to subscribers and linked agents.

Next steps (optional):

- Add persistent storage (file or DB) for memory.
- Add authentication/authorization for agents.
- Add richer conflict resolution or CRDTs for concurrent writes.
