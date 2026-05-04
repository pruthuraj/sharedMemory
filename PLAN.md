# Memory Graph Implementation Plan

## Status
- **Slice 1 - SQLite Persistent Memory Graph**: implemented and tested.
- **Slice 2 - Search**: implemented and tested.
- **Slice 3 - Request IDs**: implemented and tested.
- **Slice 4 - Optional Token Auth**: implemented and tested.
- **Slice 5 - TTL Expiry And Prune**: implemented and tested.
- **Slice 6 - Safe Integration And Fault Report**: implemented in this pass.
- **Slice 7 - Official MCP Adapter And Real Suggestion Smoke**: implemented in this pass.
- **Slice 8 - Snapshots / Export / Import**: implemented in this pass.
- **Slice 9 - Versioned Memory Writes**: implemented in this pass.
- Current verification target: `node --check` for runtime/test files and `npm test`.

---

## Slice 1 - SQLite Persistent Memory Graph

### Summary
Use SQLite as the single backing store for memory entries, tags, relations, TTL metadata, and indexed search. File-backed persistence is enabled when `MEMORY_FILE` is provided; otherwise the server uses an in-process SQLite database.

### Key Behavior
- `createMemoryStore({ persistence: { file } })` and `MEMORY_FILE` enable local SQLite file persistence.
- The implementation uses Node 24's built-in `node:sqlite` module with WAL mode and foreign keys enabled.
- Writes are committed before the command response; `flush()` and `flushSync()` clear dirty status for observability and shutdown paths.
- Dangling edges are dropped by `importState()` to preserve graph integrity.
- `/status.persistence` exposes enabled state, file path, dirty state, load/flush timestamps, and last flush error.

### Tests
- Missing file startup.
- Inaccessible or corrupt SQLite path startup failure.
- Entries and edges persist and reload.
- Dangling imported edges are dropped.
- Cascade delete persists removed edges.
- Dirty state is acknowledged by debounced and sync flush paths.
- `/status.persistence` and close-time flushing.

---

## Slice 2 - Search

### Summary
Add a metadata-only `search` command so agents can discover memories without knowing exact keys or loading full values into context.

### Key Behavior
- `query` matches key, summary, and tags through SQLite FTS5 trigram indexing.
- `tags` uses AND semantics: every requested tag must be present.
- `minImportance` filters by agent-supplied importance.
- `limit` bounds returned results, while `total` reports the pre-limit match count.
- Results are metadata-only; clients use `get` for full `value`.
- Sorting matches `map`: importance descending, `updatedAt` descending, key ascending.

### Tests
- Metadata-only result shape.
- Pre-limit `total`.
- Case-insensitive matching.
- Multi-tag AND filtering.
- WebSocket search route.
- Search validation errors.

---

## Slice 3 - Request IDs

### Summary
Add optional client-supplied `requestId` correlation across direct WebSocket responses while keeping broadcasts unchanged.

### Key Behavior
- Every inbound command accepts optional `requestId: string | number`.
- Direct responses and direct errors echo the exact value.
- Broadcasts never include `requestId`: `update`, `relation-update`, cross-agent `linked`, and `welcome`.
- Invalid request IDs return `invalid-requestId` without echoing the invalid value.

### Tests
- Success acks echo request IDs across command types.
- String, number, `0`, and empty-string IDs round trip exactly.
- Validation errors echo valid request IDs.
- Broadcasts omit request IDs.

---

## Slice 4 - Optional Token Auth

### Summary
Add optional single-token authentication for WebSocket commands and `/status`. Auth is disabled by default and enabled only through `MEMORY_TOKEN` or `createSharedMemoryServer({ authToken })`.

### Key Behavior
- `auth` command accepts `{ type: "auth", token, requestId }`.
- Valid auth returns `{ type: "authenticated", requestId }`.
- Invalid or missing tokens return `{ type: "error", message: "unauthorized", requestId }`.
- When auth is enabled, only `auth` is allowed before authentication.
- Unauthorized commands keep the socket open so clients can recover.
- `/status` requires `Authorization: Bearer <token>` only when auth is enabled.

### Tests
- Auth disabled flow remains backward compatible.
- Protected commands are blocked before auth.
- Valid auth unlocks the same socket.
- Invalid and missing tokens preserve request ID behavior.
- `/status` returns `401` for missing/wrong bearer tokens and normal status for valid bearer tokens.

---

## Slice 5 - TTL Expiry And Prune

### Summary
Add deterministic time-based lifecycle management for temporary memories. Reads stay side-effect-free; expired entries are hidden during reads and removed only by explicit `prune` or the background sweep.

### Key Behavior
- Entries include optional `expiresAt`.
- `set` accepts `ttlMs` or `expiresAt`, but not both.
- `ttlMs` is converted to `expiresAt = clock() + ttlMs`.
- `touch` updates expiry and `updatedAt` without changing `value`.
- `touch` with no expiry fields clears existing expiry.
- `prune` removes all expired entries and cascades inbound/outbound edges.
- `get`, `keys`, `count`, `map`, and `search` ignore expired entries.
- `map` skips edges touching expired nodes.
- `relate` treats expired endpoints as `missing-node`.
- Background pruning runs every `pruneIntervalMs` milliseconds by default; `0` disables it.
- Time is injectable with `clock` or `now` for deterministic tests.

### Notifications
- Pruned keys emit `update` with `entry: null` and `action: "expired"`.
- Edges removed by expiry emit `relation-update` with `action: "cascade-deleted"`.
- Background prune and explicit `prune` share the same notification path.

---

## Slice 6 - Safe Integration And Fault Report

### Summary
Document the current integration map, fix unsafe suggestion defaults, and align docs with the SQLite implementation.

### Key Behavior
- `docs/report.md` is the canonical integration/fault report.
- Semantic suggestions are opt-in by default through `MEMORY_SUGGEST_ENABLED=true` or explicit server options.
- Disabled suggestions return `suggest-result` with an empty array and do not enqueue embedding work.
- Node `>=24` is documented and declared because the store uses `node:sqlite`.
- Root shutdown flushes memory synchronously first, then closes server resources through the shared close path.

### Tests
- Default server keeps suggestions disabled without queueing embeddings.
- Explicitly enabled suggestions still index memory and return metadata-only suggestions.
- Suggestion engine unit tests cover disabled default and enabled queue behavior.

---

## Slice 7 - Official MCP Adapter And Real Suggestion Smoke

### Summary
Add an official stdio MCP adapter and a manual real-model smoke path for semantic suggestions.

### Key Behavior
- `npm run mcp` starts `mcp-server.mjs` over stdio using the official MCP server SDK.
- The MCP adapter uses the store modules directly and honors `MEMORY_FILE`.
- MCP tools are `memory_set`, `memory_get`, `memory_search`, `memory_suggest`, and `memory_map`.
- Tool outputs use stable JSON envelopes: `{ ok: true, ... }` and `{ ok: false, error }`.
- `memory_suggest` refreshes visible memory into the local suggestion index before ranking.
- `npm run smoke:suggest` runs a manual WebSocket smoke client against a server started with `MEMORY_SUGGEST_ENABLED=true`.
- `/status.suggestions.modelLoaded` shows whether the embedder has actually loaded.

### Tests
- MCP tool handlers cover set/get/search/map, validation, disabled suggestions, enabled suggestion refresh, and JSON result envelopes.
- MCP stdio integration covers initialize, initialized notification, tool discovery, core tool calls, disabled suggestions, and domain failures through real JSON-RPC.
- Server status covers `modelLoaded`.
- Real-model smoke is manual and opt-in, not part of `npm test`.

---

## Slice 8 - Snapshots / Export / Import

### Summary
Add operational safety tools before more advanced retrieval. Snapshots let developers inspect, back up, validate, restore, and migrate graph state after agent mistakes without introducing a separate database service.

### Key Behavior
- WebSocket commands `export`, `validate-import`, and `import` expose the full graph snapshot surface.
- MCP tools `memory_export`, `memory_validate_import`, and `memory_import` expose the same capability over stdio MCP.
- Snapshots contain full entry values, metadata, expiry timestamps, and relation edges.
- Public import is strict and replace-only. Validation must pass before the store mutates.
- Strict validation rejects malformed entries, missing values, invalid metadata, self-edges, duplicate edges, invalid relation types, invalid weights, and dangling endpoints.
- Low-level `importState()` remains forgiving for internal/test recovery paths.
- Successful WebSocket imports broadcast one compact `snapshot-update` event without `requestId`.
- `/status.snapshot` records last export/import timestamps and import stats.

### Tests
- Store coverage for export shape, strict validation, replace-mode import, and failed-import atomicity.
- WebSocket coverage for export, validate-import, import, invalid import, auth gating, suggestion-index refresh, and `snapshot-update` broadcasts.
- MCP handler and stdio integration coverage for snapshot tool discovery and import/export roundtrips.

---

## Slice 9 - Versioned Memory Writes

### Summary
Add per-entry revisions so agents can opt into stale-write protection without breaking legacy clients.

### Key Behavior
- Entries include `revision`, starting at `1` for new keys and incrementing on successful `set` and `touch`.
- WebSocket and MCP metadata responses include `revision` wherever entry metadata is returned.
- `set`, `touch`, and `delete` accept optional `ifRevision`.
- Omitted `ifRevision` keeps legacy last-write-wins behavior.
- `ifRevision: null` on `set` is create-only and treats expired entries as replaceable.
- Stale checks return `revision-conflict` with `key` and `currentRevision`.
- Snapshot export includes `revision`; strict import accepts missing revision as `1` for old snapshots.

### Tests
- Store coverage for revision increments, stale-write atomicity, create-only writes, lifecycle checks, and snapshot revision compatibility.
- WebSocket coverage for revision metadata, conflict errors with request IDs, invalid `ifRevision`, broadcasts, and legacy compatibility.
- MCP handler and stdio coverage for `memory_set` conflict behavior and revision metadata.

---

## Next Candidate Slice - Batch Transactions

### Summary
Build on versioned writes with an atomic multi-operation command so agents can store related memories and graph edges as one transaction.

### Candidate Behavior
- Add a WebSocket `batch` command for ordered `set`, `touch`, `delete`, `relate`, and `unrelate` operations.
- Add MCP `memory_batch` with the same domain envelope.
- Validate every operation before mutation, then commit all or none.
- Support `ifRevision` inside batch operations.

---

## Later Candidate Slice - Client SDK / CLI

### Summary
Wrap the stable WebSocket and MCP surfaces in developer tools so agents and humans stop hand-writing protocol envelopes.

### Candidate Behavior
- Add a small JavaScript client SDK for WebSocket commands with request ID correlation.
- Add CLI commands for `set`, `get`, `search`, `map`, `export`, `validate-import`, and `import`.
- Support `MEMORY_TOKEN`, `MEMORY_FILE`, and server URL configuration through environment variables and flags.
- Keep CLI import/export JSON-first so snapshots remain easy to inspect and version.

---

## Out Of Scope
- External vector databases.
- Multi-user auth, JWTs, roles, or hashed token storage.
- Archival history, soft delete, or audit log.
- Dashboard UI.
