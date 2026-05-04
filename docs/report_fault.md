# Fault Report

Status: corrected. See `docs/report_fault_correct.md` for the implemented fixes and verification.

## Scope
Audited the current sharedMemory integration after the stdio MCP adapter work. The audit covered runtime entry points, WebSocket routing, protocol validation, SQLite memory graph behavior, suggestion integration, MCP tool handling, tests, and public docs.

## Verification
- `node --check server.js`: passed.
- `node --check example_agent.js`: passed.
- `node --check mcp-server.mjs`: passed.
- `node --check scripts/*.js`: passed.
- `node --check src/*.js`: passed.
- `node --check test/*.js`: passed.
- `npm test`: 59 passed, 0 failed.
- Expected warning: Node prints the experimental `node:sqlite` warning.

## Faults Found

### P2 - No-op `unrelate` emits a false topology deletion
Evidence:
- `src/memory-store.js` synthesizes an edge descriptor when the edge did not exist.
- `src/server.js` always calls `notifyRelationUpdate(agents, "deleted", edge)` after `unrelate`.

Impact:
Subscribers can receive a `relation-update` with `action: "deleted"` for an edge that never existed. That event is misleading because `deleted` is supposed to mean a real relationship was removed. Agents using relation events as their local graph log can record a false topology transition.

Recommended fix:
Change `memory.unrelate()` to return `{ removed, edge }`, where `removed` is `false` when no edge existed. Keep the `unrelated` ack idempotent, but emit `relation-update` only when `removed === true`.

Add test coverage:
- Create two nodes.
- Subscribe a client to one endpoint.
- Call `unrelate` for a missing edge.
- Assert the caller receives `unrelated`.
- Assert no subscriber receives `relation-update`.
- Call `unrelate` for an existing edge and assert the existing notification still fires.

### P2 - No-op `delete` emits a false memory deletion
Evidence:
- `src/server.js` sends `notifyKeyUpdate(agents, key, null, { action: "deleted" })` even when `memory.delete(key)` returns `removed: false`.
- `src/server.js` also calls `removeSuggestionMemory(key)` unconditionally.

Impact:
Subscribers can receive an `update` with `entry: null` and `action: "deleted"` for a key that did not exist. That can cause agents to discard or mark context as explicitly deleted even though the store did not mutate.

Recommended fix:
Keep the direct `{ type: "deleted", removed: false }` ack for idempotency, but only call `removeSuggestionMemory()` and `notifyKeyUpdate(... action: "deleted")` when `result.removed === true`. Relation cascade notifications are already naturally bounded by `result.removedEdges`.

Add test coverage:
- Subscribe to a missing key.
- Delete that missing key.
- Assert the caller receives `{ removed: false }`.
- Assert subscribers do not receive an `update` deletion event.
- Preserve the current notification behavior for a real deleted key.

### P3 - Package metadata is stale after the official MCP adapter
Evidence:
- `package.json` still describes the project as `"Local MCP-like server providing shared memory and agent linking via WebSocket"`.

Impact:
The package metadata now undersells the current interface. The project has an official stdio MCP adapter, so tooling and readers may get the wrong integration signal from package metadata.

Recommended fix:
Update `package.json.description`, then let `package-lock.json` refresh if npm rewrites package metadata.

Suggested wording:
`Local shared-memory service with WebSocket coordination and stdio MCP tools.`

### P3 - A few test names and comments still reflect pre-SQLite wording
Evidence:
- `test/memory-store.test.js` and `test/server.test.js` still use temp filenames named `memory.json`.
- `test/memory-store.test.js` still has a test named `persistence rejects invalid JSON at startup`.
- `src/memory-store.js` comments describe search as a case-insensitive substring scan even though the implementation uses SQLite FTS5 trigram matching when `query` is present.

Impact:
This is not a runtime bug, but it increases maintenance risk. Future contributors may infer that JSON persistence or substring search is still the implemented behavior.

Recommended fix:
Rename temp files to `memory.db`, rename the invalid persistence test to mention corrupt SQLite input, and update the search comments to match FTS5 trigram behavior plus tag filtering.

## Not Classified As Faults
- `persistent_MemoryGraph_ImplPLAN.md` and other old plan files still mention JSON persistence, but the main historical note clearly marks that plan as obsolete.
- Semantic suggestions remain eventually consistent on the WebSocket path by design; the README documents the debounce behavior and manual smoke script waits for indexing.
- The stdio MCP adapter intentionally ignores `MEMORY_TOKEN` because stdio is local process transport.

## Recommended Next Slice
Fix the two notification false-positive cases first because they affect agent state integrity. After that, clean stale metadata/test wording. Then rerun:

```bash
node --check server.js
node --check example_agent.js
node --check mcp-server.mjs
node --check scripts/*.js
node --check src/*.js
node --check test/*.js
npm test
```
