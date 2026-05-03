# Memory Graph Implementation Plan

## Status
- **Slice 1 — Persistent Memory Graph**: implemented and tested (10 dedicated tests).
- **Slice 2 — Search**: implemented and tested (6 dedicated tests; 4 unit + 2 integration).
- Total suite: 26/26 passing.

---

## Slice 1 — Persistent Memory Graph

### Summary
Implement optional JSON persistence for the memory graph. Runtime operations stay RAM-first, while debounced atomic flushes make entries and relationships durable when `MEMORY_FILE` is configured.

### Key Changes
- Add optional persistence via `createMemoryStore({ persistence })` and `MEMORY_FILE`.
- Load existing state at startup; missing files start empty and invalid JSON fails clearly.
- Persist `entries` and graph `edges` in a deterministic JSON shape.
- Drop dangling loaded edges so graph integrity is restored at boot.
- Mark state dirty after `set`, `relate`, `unrelate`, and `delete`.
- Flush dirty state with debounced atomic writes: temp file next to target, then rename.
- Add `flush()`, `flushSync()`, `persistenceStatus()`, and export/import helpers to the store.
- Extend `/status` with `persistence`.
- Force final flush on `appServer.close()`, `SIGINT`, and `SIGTERM`.

### Persistence Behavior
- RAM remains the source of truth while the server is running.
- Flush failures are caught inside timer callbacks, recorded in `lastFlushError`, and leave `dirty: true`.
- Async flush is used for normal operation; sync flush is reserved for shutdown paths.
- Persistence is optional and disabled unless a file path is provided.
- Request IDs, search, auth, embeddings, and dashboards stay out of this slice.

### Test Plan
- Existing graph and protocol tests continue passing.
- Add persistence coverage for:
  - Missing files, invalid JSON, defensive dangling-edge load, restart recovery, cascade delete persistence, debounced scheduling, flush failure state, sync flush, `/status.persistence`, and close-time flushing.
- Verify with:
  - `node --check server.js`
  - `node --check example_agent.js`
  - `node --check src/*.js`
  - `node --check test/*.js`
  - `npm test`

### Assumptions
- Persistence is local JSON only.
- Runtime operations stay RAM-first and non-blocking.
- Request IDs, auth, embeddings, and dashboards remain out of scope.
- Synchronous file writes are used only for shutdown/final-flush paths.

---

## Slice 2 — Search

### Summary
Add a `search` WebSocket command so agents can discover memories without knowing exact keys. Search is a pure read: no notifications, no persistence side effects, no subscriptions. Filters compose with AND semantics; results are metadata-only and sorted by the same `(importance desc, updatedAt desc, key asc)` order `map` already uses.

### Filter Shape
- `query` — optional non-empty string. Case-insensitive substring match against key, summary, and any tag.
- `tags` — optional non-empty array of non-empty strings. Entry must contain every requested tag (case-insensitive).
- `minImportance` — optional integer 0–10. Matches entries with `importance >= minImportance`.
- `limit` — optional integer 1–100, default 20. Applied after sort.
- At least one of `query` / non-empty `tags` / `minImportance` is required, else `missing-filter`.

### Response Shape
- `{ type: 'search-result', results: [...metadata], total }`.
- `results` are `nodeMetadata`-shaped (`key`, `summary`, `tags`, `importance`, `updatedAt`, `updatedBy`) — no `value`. Agents call `get` to retrieve full values, mirroring `map`.
- `total` is the **pre-limit** match count, so callers can detect truncation and widen `limit` if needed.

### Validation Errors
- `invalid-query`, `invalid-tags`, `invalid-importance`, `invalid-limit`, `missing-filter`.
- Whitespace-only `query` is rejected by the existing `isNonEmptyString` helper as `invalid-query`.
- `tags: []` is treated as absent for the missing-filter check (no friction for clients passing optional empty arrays); each element of a non-empty `tags` array must still pass `isNonEmptyString`.

### Implementation Notes
- Logic lives in `src/memory-store.js` as a `search(filters)` method on the returned object, slotted between `map` and `exportState`. Reuses `sortNodeRecords` and `nodeMetadata` so ordering and result shape stay consistent across `map` and `search`.
- Validation lives in `src/protocol.js`: `'search'` added to `COMMAND_TYPES`, plus a `case 'search':` after the `'map'` case in `validateMessage`.
- Routing lives in `src/server.js`: a `case 'search':` after `'map'` that calls `memory.search(...)` and `safeSend`s the `search-result` envelope. No `notify*` calls, no agent-registry interaction.

### Test Plan
- 4 unit tests in `test/memory-store.test.js`:
  - Metadata-only matches sorted by importance/recency/key.
  - Limit applied but pre-limit `total` reported.
  - Case-insensitive matching across key, summary, and tags.
  - AND-semantics for multi-tag filters.
- 2 integration tests in `test/server.test.js`:
  - End-to-end filtered search via WebSocket; `value` absent from results.
  - Validation rejects missing filters, whitespace-only query, and out-of-range importance.

### Assumptions
- Substring matching is enough; full-text indexing, ranking, and embeddings stay out of scope.
- Search is stateless — no saved searches, no subscriptions for "matches changed" events.
- Results are bounded by `limit`; clients widen via `total` rather than streaming pagination.
- Empty store legitimately returns `{ results: [], total: 0 }`; not an error.

---

## Out of Scope (Both Slices)
Request IDs, token auth, embeddings, dashboards, TTL/expiry, full-text ranking, saved searches.
