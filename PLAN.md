# Memory Graph Implementation Plan

## Status
- **Slice 1 - Persistent Memory Graph**: implemented and tested.
- **Slice 2 - Search**: implemented and tested.
- **Slice 3 - Request IDs**: implemented and tested.
- **Slice 4 - Optional Token Auth**: implemented and tested.
- **Slice 5 - TTL Expiry And Prune**: implemented and tested.
- Current verification target: `node --check` for runtime/test files and `npm test`.

---

## Slice 1 - Persistent Memory Graph

### Summary
Implement optional JSON persistence for the memory graph. Runtime operations stay RAM-first, while debounced atomic flushes make entries and relationships durable when `MEMORY_FILE` is configured.

### Key Behavior
- `createMemoryStore({ persistence })` and `MEMORY_FILE` enable local JSON persistence.
- Missing persistence files start empty; invalid JSON fails startup clearly.
- Loaded dangling edges are dropped to preserve graph integrity.
- Dirty state is flushed with debounced atomic writes: temp file beside target, then rename.
- `flush()` is async for normal operation; `flushSync()` is reserved for shutdown paths.
- `/status.persistence` exposes enabled state, dirty state, load/flush timestamps, and last flush error.

### Tests
- Missing file startup.
- Invalid JSON startup failure.
- Entries and edges persist and reload.
- Dangling edges are dropped on load.
- Cascade delete persists removed edges.
- Debounced scheduler keeps one active timer.
- Flush failures keep `dirty: true`.
- `flushSync()` writes a valid snapshot.
- `/status.persistence` and close-time flushing.

---

## Slice 2 - Search

### Summary
Add a metadata-only `search` command so agents can discover memories without knowing exact keys or loading full values into context.

### Key Behavior
- `query` matches key, summary, and tags case-insensitively.
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

### Status Fields
- `expiredMemoryCount`
- `pruneIntervalMs`
- `lastPrunedAt`

### Tests
- `set` with `ttlMs` and `expiresAt`.
- Expired entries hidden from `get`, `keys`, `count`, `map`, and `search`.
- Map skips phantom edges touching expired nodes.
- `relate` rejects expired endpoints.
- `touch` extends expiry and clears expiry.
- `pruneExpired()` removes expired nodes and cascades edges.
- Persistence saves and reloads `expiresAt`.
- WebSocket `touch` and `prune` request/response shapes.
- Validation rejects invalid expiry fields.
- Prune notifications and background prune through injected scheduler/clock.
- `/status` includes expiry/prune fields.

---

## Next Candidate Slice - Snapshots / Export / Import

### Summary
Add operational safety tools before more advanced retrieval. Snapshots let developers inspect, back up, and restore graph state after agent mistakes without introducing a database.

### Candidate Behavior
- Export the full graph snapshot as JSON.
- Import a snapshot with the same defensive validation used by persistence loading.
- Reject or drop dangling edges deterministically.
- Optionally support dry-run import validation.
- Keep auth checks in the transport layer.

---

## Out Of Scope
- Official MCP protocol conversion.
- Embeddings and vector databases.
- Full-text indexing or fuzzy ranking.
- Multi-user auth, JWTs, roles, or hashed token storage.
- Archival history, soft delete, or audit log.
- Dashboard UI.
