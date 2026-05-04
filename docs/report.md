# Integration And Fault Report

## Summary
This report records the current integration shape and the faults found before safely integrating the SQLite memory graph, TTL lifecycle, request IDs, auth, semantic suggestions, the stdio MCP adapter, strict snapshot import/export, and versioned memory writes. Initial verification before suggestion integration showed syntax checks passing and `npm test` passing with 51 tests. Later passes added opt-in semantic suggestions, MCP tool handlers, real stdio MCP protocol coverage, replace-mode snapshot tooling, and revision conflict checks.

Final verification after integration:

- `node --check server.js`: passed.
- `node --check example_agent.js`: passed.
- `node --check mcp-server.mjs`: passed.
- `node --check scripts/*.js`: passed.
- `node --check src/*.js`: passed.
- `node --check test/*.js`: passed.
- `npm test`: 72 passed, 0 failed.
- Note: Node prints the expected experimental warning for `node:sqlite`.

## Integration Map
- `server.js`: process entry point. Starts `createSharedMemoryServer`, flushes memory synchronously on `SIGINT`/`SIGTERM`, then closes the shared server resources.
- `src/server.js`: transport and lifecycle wiring. Owns Express, HTTP, WebSocket routing, auth gating, `/status`, background prune, notifications, and suggestion engine integration.
- `src/protocol.js`: command parser and validator. Defines supported WebSocket message types, request ID validation, memory metadata validation, graph validation, expiry validation, search validation, suggest validation, snapshot command shape validation, and optional `ifRevision` validation.
- `src/memory-store.js`: SQLite-backed state machine. Stores entries, per-key revisions, tags, relation edges, TTL fields, FTS5 search index, forgiving internal import/export helpers, strict public snapshot validation/import, dirty status, and prune behavior.
- `src/agent-registry.js`: tracks temporary/stable agent IDs, live sockets, subscriptions, links, reconnects, and duplicate-live-ID rejection.
- `src/delivery.js`: safe send and exactly-once fan-out helpers for key updates, relation updates, and linked-agent notifications.
- `src/suggestion-engine.js`, `src/vector-index.js`, `src/suggestion-ranking.js`, `src/embedding-adapter.js`: optional semantic suggestion subsystem. It queues memory metadata updates, embeds active memories only when enabled, ranks by semantic similarity plus metadata signals, and exposes status.
- `src/mcp-tools.js` and `mcp-server.mjs`: official stdio MCP adapter and transport-independent tool handlers, including snapshot export, validation, and replace-mode import.
- `scripts/smoke-suggest.js`: manual real-model smoke client for the WebSocket suggestion path.
- `test/*.js`: Node test runner coverage for the store, WebSocket protocol, server lifecycle, suggestion engine, MCP tool handlers, and real stdio MCP protocol flow.
- `readme.md`, `PLAN.md`, and `docs/system_diagram.md`: public usage contract, implementation roadmap, and architecture diagrams.

## Faults Found
- README and `PLAN.md` still described older JSON persistence even though the current store uses `node:sqlite`, WAL mode, and SQLite FTS5.
- Semantic suggestions were enabled by default, which could trigger embedding/model work from ordinary local memory writes.
- Root shutdown had indentation and non-ASCII comment artifacts, and it did not clearly route cleanup through the shared close path for suggestion engine disposal.
- Several comments contained mojibake or non-ASCII artifacts from prior edits.
- Legacy plan/report files remain in the repo root. They should be treated as historical notes unless promoted into current docs.
- Node 24 was an implicit runtime requirement because `node:sqlite` is used, but that requirement was not declared in package metadata.

## Integration Decisions
- Keep `node:sqlite`; do not switch to `better-sqlite3` in this pass.
- Declare and document Node `>=24`.
- Keep the additive `suggest` command, but make semantic suggestions opt-in.
- Disabled suggestions return a normal `suggest-result` with an empty `suggestions` array and do not enqueue embedding work.
- Keep all existing WebSocket command shapes backward-compatible.
- Use `docs/report.md` as the canonical fault/integration report location.
- Expose MCP over stdio first with `memory_suggest` as the flagship tool.
- Keep real-model smoke manual and opt-in so `npm test` stays deterministic and offline-safe.
- Use `@modelcontextprotocol/server` plus its runtime JSON-schema peer dependency for the stdio MCP adapter.
- Add public snapshot import as strict replace-mode only. Invalid snapshots return structured errors and cannot partially mutate the graph.
- Keep low-level `memory.importState()` forgiving for internal repair/testing, while WebSocket and MCP public imports use strict validation first.
- Add per-entry revisions with optional `ifRevision` checks for `set`, `touch`, and `delete`; legacy clients remain last-write-wins when they omit `ifRevision`.
- Use `ifRevision: null` only for create-only `set`, and report stale writes as `revision-conflict` with `currentRevision`.

## Verification Coverage
- Runtime and test files pass `node --check`.
- Full Node test suite passes.
- `/status.suggestions.enabled` is false by default.
- Disabled suggestions do not enqueue embedding work.
- Explicitly enabled suggestions still index memory and return metadata-only results.
- MCP tool handlers are covered for stable JSON envelopes, validation, search/map, disabled suggestions, and enabled suggestion refresh.
- MCP stdio integration is covered through a child process that performs initialize, initialized notification, tools/list, and tools/call for the five memory tools.
- Idempotent no-op `unrelate` and `delete` calls are covered so they acknowledge callers without emitting false state-change broadcasts.
- Snapshot coverage includes strict validation, failed-import atomicity, WebSocket import/export roundtrip, auth gating, suggestion-index refresh after replacement, `snapshot-update` broadcasts, and MCP stdio snapshot tools.
- Revision coverage includes store-level stale-write atomicity, WebSocket conflict responses with request IDs, MCP domain failures, snapshot revision compatibility, and legacy write compatibility.
