# Refactorable Reliability Foundation Plan

## Summary
Refactor the shared-memory WebSocket server into small CommonJS modules, then correct the current reliability flaws without breaking existing clients. The public surface remains the JSON WebSocket protocol and the `/status` endpoint.

## Key Changes
- Split the monolithic server into focused modules:
  - `src/server.js`: Express, HTTP server, WebSocket setup, startup helpers, shutdown helpers.
  - `src/protocol.js`: JSON parsing, command allow-listing, and required field validation.
  - `src/memory-store.js`: in-memory key/value entries with `value`, `updatedAt`, and `updatedBy`.
  - `src/agent-registry.js`: temporary IDs, registration, offline reconnects, duplicate live ID rejection, subscriptions, and links.
  - `src/delivery.js`: safe WebSocket sends, subscriber updates, and linked-agent notifications.
- Keep CommonJS with `require` and `module.exports`.
- Preserve existing compatible message types: `welcome`, `registered`, `ok`, `result`, `subscribed`, `unsubscribed`, `linked`, `unlinked`, `list`, `update`, and `error`.
- Reject duplicate live `agentId` registration with `{ "type": "error", "message": "duplicate-agent" }`.
- Allow an offline placeholder ID to be reclaimed by a reconnecting agent.
- Validate messages as JSON objects with known `type` values and non-empty string `agentId`, `key`, or `target` fields where required.
- Make delivery safe for `null`, closing, closed, and offline sockets.
- Preserve `/status.agents` and `/status.memoryKeys`; add `/status.connectedAgents`.

## Test Plan
- Add `"test": "node --test"` to `package.json`.
- Add integration tests using Node's built-in test runner and `ws`.
- Cover:
  - `register`, `set`, `get`, `subscribe`, `unsubscribe`, `link`, `unlink`, and `list`.
  - `/status` includes known agents, connected agents, and memory keys.
  - Subscribers receive current value and later updates.
  - Invalid JSON, non-object JSON, unknown command types, and missing fields return `error`.
  - Duplicate live agent IDs are rejected.
  - Offline agent IDs can be reclaimed.
  - Linked notifications skip offline targets safely.
- Verify with:
  - `node --check server.js`
  - `node --check example_agent.js`
  - `npm test`

## Assumptions
- No authentication, persistence, database, dashboard, or real MCP protocol conversion in this pass.
- Module boundaries are internal only; clients continue using WebSocket JSON messages and `/status`.
- Existing clients with unique agent IDs remain compatible.
- New errors and `/status.connectedAgents` are additive reliability improvements.
