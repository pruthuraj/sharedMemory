# Memory Graph Implementation Plan

## Status
- **Slice 1 — Persistent Memory Graph**: implemented and tested (10 dedicated tests).
- **Slice 2 — Search**: implemented and tested (6 dedicated tests; 4 unit + 2 integration).
- **Slice 3 — Request IDs**: implemented and tested (4 integration tests).
- **Slice 4 — Optional Token Auth**: implemented and tested (4 integration tests).
- Total suite: 34/34 passing.

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

## Slice 3 — Request IDs

### Summary
Add optional client-supplied `requestId` correlation across the WebSocket protocol. Pure transport-layer concern: stores and registries are unchanged. Direct responses and validation errors echo the `requestId`; subscriber and cross-agent broadcasts never carry one. Backward compatible — clients that never send a `requestId` observe identical wire output as before.

### Wire Contract
- **Inbound**: every command accepts an optional `requestId: string | number` (any string including `''`; any finite number including `0`, negatives, decimals).
- **Outbound (direct)**: every ack/result/error sent in response to a single command echoes the `requestId` verbatim. Covers `registered`, `ok`, `result`, `subscribed`, `unsubscribed`, `linked` (ack with `target`), `unlinked`, `list`, `related`, `unrelated`, `deleted`, `map-result`, `search-result`, and `error` payloads from validation or per-handler failures (e.g. `missing-node`, `duplicate-agent`, `self-relation-not-allowed`).
- **Outbound (broadcasts)**: server-initiated and cross-agent messages never carry `requestId`. Covers `update` (subscriber notifications, including the initial replay after `subscribe`), `relation-update` (cross-edge subscribers), the cross-agent `linked` broadcast (`{ from, payload }` shape), and `welcome`.
- **Pre-parse errors** (`invalid-json`, `invalid-message`, `invalid-requestId`) carry no `requestId` since none can be safely recovered.

### Validation Errors
- `invalid-requestId` — `null`, booleans, `NaN`, `±Infinity`, objects, and arrays are rejected. The bad value itself is **not** echoed in the error response.

### Implementation Notes
- `src/protocol.js` — adds `isValidRequestId` helper. `parseMessage` validates `requestId` immediately after the `isPlainObject` check, captures it once, and spreads it onto every failure return (`unknown-type` and any `validateMessage` failure via `{ ...result, requestId }`). On success the requestId rides along on `parsed.message` and the server reads it directly.
- `src/server.js` — captures `const requestId = data.requestId;` once per message and adds the field to every direct `safeSend` ack/result/error site. Notification helpers (`notifyKeyUpdate`, `notifyRelationUpdate`, `notifyLinkedAgents`) are unchanged. The initial `update` after `subscribe` intentionally does **not** carry a requestId so the `update` envelope shape stays uniform across initial and subsequent updates.
- Stores and registries (`src/memory-store.js`, `src/agent-registry.js`, `src/delivery.js`) are untouched — request IDs are purely a transport concern.

### Test Plan
- 4 integration tests in `test/server.test.js`:
  - `requestId echoes on success acks across every command type` — exercises every direct ack/result handler with a distinct string requestId.
  - `requestId preserves type and value, including 0 and empty string` — uses `assert.strictEqual` so `0` round-trips as number `0`, not string `'0'`.
  - `errors echo the requestId, but invalid-requestId omits it` — covers a `validateMessage` failure, `unknown-type`, and the `invalid-requestId` rejection where the bad value is not echoed.
  - `broadcasts (update, relation-update, cross-agent linked) carry no requestId` — two-agent setup; confirms subscriber `update`, cross-edge `relation-update`, and the cross-agent `linked` broadcast all omit `requestId` while the originator's own ack still carries it.

### Assumptions
- Purely additive on the wire: `JSON.stringify` drops `undefined`, so clients that never send a `requestId` see identical bytes as before.
- After the protocol layer, the server trusts `data.requestId` to be `string | number | undefined`.
- Server-generated correlation IDs, monotonic sequence numbers, idempotency keys, and per-message timeouts remain out of scope.

---

## Out of Scope (All Slices)
Embeddings, dashboards, TTL/expiry, full-text ranking, saved searches, server-generated correlation IDs, idempotency keys, multi-user auth, JWTs, roles.

---

## Slice 4 — Optional Token Auth

### Summary
Add optional single-token authentication for the WebSocket protocol and `/status`. Auth is disabled by default and enabled only with `MEMORY_TOKEN` or `createSharedMemoryServer({ authToken })`.

### Wire Contract
- `auth`: `{ type: 'auth', token: 'secret', requestId }`.
- Success: `{ type: 'authenticated', requestId }`.
- Failure: `{ type: 'error', message: 'unauthorized', requestId }`.
- When auth is enabled, all commands except `auth` return `unauthorized` until the socket authenticates.
- When auth is disabled, sockets behave as authenticated and `auth` is accepted as a no-op success.

### HTTP Status Auth
- When auth is enabled, `/status` requires `Authorization: Bearer <token>`.
- Missing or wrong bearer token returns HTTP `401` with `{ error: 'unauthorized' }`.
- When auth is disabled, `/status` remains open.

### Implementation Notes
- Auth state is per WebSocket connection in `src/server.js`.
- The token is exact string equality and is never stored in the memory graph.
- `src/protocol.js` recognizes `auth`; token validation happens in the router so bad/missing tokens produce `unauthorized`.
- Request ID semantics remain unchanged: direct auth responses/errors echo it, broadcasts omit it.

### Test Plan
- Auth disabled flow remains compatible.
- Auth enabled blocks protected commands until valid auth.
- Invalid and missing tokens return `unauthorized` without closing the socket.
- `/status` enforces bearer auth only when enabled.
