# Reliability-First Improvement Plan

## Summary
Improve the current WebSocket shared-memory server without breaking existing example clients. Keep the protocol shape intact, add practical validation, fix live agent ID collisions, make sends safe for closed/offline sockets, and add integration tests using Node’s built-in test runner.

## Key Changes
- Refactor `server.js` so the server can be created and closed from tests while preserving `npm start` behavior.
- Keep existing request/response message names compatible: `welcome`, `registered`, `ok`, `result`, `subscribed`, `unsubscribed`, `linked`, `unlinked`, `list`, `update`, and `error`.
- Add practical request validation:
  - Incoming WebSocket messages must be JSON objects with a known `type`.
  - `key`, `agentId`, and `target` fields must be non-empty strings where required.
  - Memory `value` may remain any JSON-compatible value.
- Use the duplicate agent policy we selected:
  - If an existing agent ID is offline, a new connection may reclaim it.
  - If an existing agent ID is currently connected, reject the second registration with `{ "type": "error", "message": "duplicate-agent" }`.
- Harden delivery:
  - `safeSend` should no-op for `null`, closed, or closing sockets.
  - Subscriber and linked-agent notifications should never throw when targets are offline.
- Add `/status` fields additively:
  - Preserve current `agents` and `memoryKeys`.
  - Add `connectedAgents` so callers can distinguish live sockets from remembered offline IDs.
- Clean up README quality:
  - Remove duplicated content.
  - Fix encoding artifacts.
  - Document duplicate registration behavior and the additive `connectedAgents` status field.

## Test Plan
- Add `"test": "node --test"` to `package.json`.
- Add integration tests that start the server on port `0` and connect clients with `ws`.
- Cover:
  - `/status` returns memory keys, known agents, and connected agents.
  - `register`, `set`, `get`, and `list` work as before.
  - `subscribe` receives current value and future updates.
  - invalid JSON and invalid message shapes return `error` instead of crashing.
  - duplicate live `agentId` registration is rejected.
  - offline agent ID reclaim works after the first socket closes.
  - linked notifications do not crash when the target is offline.
- Run:
  - `node --check server.js`
  - `node --check example_agent.js`
  - `npm test`

## Assumptions
- No authentication or persistence in this pass.
- No new third-party test framework; use Node 24’s built-in `node:test`.
- Existing clients using unique agent IDs should continue working unchanged.
- Any new errors or status fields are additive compatibility improvements.
