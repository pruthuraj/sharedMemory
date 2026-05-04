# Fault Correction Report

## Summary
Corrected the faults documented in `docs/report_fault.md`. The two state-integrity bugs were fixed in code and locked with regression coverage. Stale package/test/comment wording was also cleaned so docs and tests match the current SQLite plus official MCP implementation.

## Corrections

### Fixed - No-op `unrelate` emitted false relation deletions
Changed:
- `src/memory-store.js`: `unrelate()` now returns `{ removed, edge }` instead of only an edge descriptor.
- `src/server.js`: the `unrelate` route keeps the idempotent `unrelated` ack, but emits `relation-update` with `action: "deleted"` only when `removed === true`.

Result:
Agents subscribed to incident keys no longer receive false graph deletion events for relationships that never existed.

### Fixed - No-op `delete` emitted false memory deletions
Changed:
- `src/server.js`: the `delete` route keeps the direct `{ type: "deleted", removed: false }` ack for missing keys.
- `src/server.js`: subscriber `update` events and suggestion-index removals now run only when the key actually existed.

Result:
Subscribers no longer receive `update` with `entry: null` and `action: "deleted"` for a key that was already absent.

### Fixed - Stale package metadata
Changed:
- `package.json`: description now reflects both WebSocket coordination and official stdio MCP tools.

Result:
Package metadata no longer describes the project as only MCP-like WebSocket infrastructure.

### Fixed - Stale SQLite/search wording in tests and comments
Changed:
- `test/memory-store.test.js`: temp persistence filenames now use `memory.db`.
- `test/memory-store.test.js`: corrupt persistence test name now refers to corrupt SQLite input.
- `test/server.test.js`: persistence temp filename now uses `memory.db`.
- `src/memory-store.js`: search comment now describes SQLite FTS5 trigram search instead of substring scanning.

Result:
Maintenance wording now matches the current SQLite-backed implementation.

## Regression Coverage
Added:
- `test/server.test.js`: `idempotent unrelate and delete do not emit false state-change broadcasts`.

Covered behavior:
- Missing-edge `unrelate` still acks the caller.
- Missing-edge `unrelate` does not emit `relation-update`.
- Existing-edge `unrelate` still emits `relation-update: deleted`.
- Missing-key `delete` still acks with `removed: false`.
- Missing-key `delete` does not emit subscriber delete updates.
- Missing-key `delete` does not remove suggestion-index state.
- Existing-key `delete` still emits subscriber delete updates and removes suggestion-index state.

## Verification
Targeted verification completed:
- `node --check src/memory-store.js`: passed.
- `node --check src/server.js`: passed.
- `node --check test/server.test.js`: passed.
- `node --check test/memory-store.test.js`: passed.
- `node --test test/server.test.js`: 29 passed, 0 failed.

Full verification completed:
- `node --check server.js`: passed.
- `node --check example_agent.js`: passed.
- `node --check mcp-server.mjs`: passed.
- `node --check scripts/*.js`: passed.
- `node --check src/*.js`: passed.
- `node --check test/*.js`: passed.
- `npm test`: 60 passed, 0 failed.
- Expected warning: Node prints the experimental `node:sqlite` warning.
