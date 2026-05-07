# Durability Audit — sharedMemory MCP Server

**Date:** 2026-05-07
**Auditor mood:** incandescent
**Total Faults:** 10
**Severity:** `FRAGILE`

---

## [1] Persistence

**STATUS: FRAGILE — one known durability gap, one outright lie in documentation**

### 1a — WAL + `synchronous=NORMAL` leaves a power-loss hole

**File:** `src/memory-store.js:588`

```javascript
db.exec(
  "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;",
);
```

`PRAGMA synchronous = NORMAL` tells SQLite: flush the WAL to the OS write buffer, but DO NOT issue an fsync before returning. Writes survive application crashes and OS crashes, but a hard power cut before the kernel flushes its write cache will corrupt or lose the last N writes. For a "shared memory coordination server," this is the exact failure mode that hurts. `PRAGMA synchronous = FULL` is the correct setting if power-loss safety is required. This tradeoff is completely undocumented — callers cannot make an informed decision.

### 1b — `flush()` is a no-op for actual bytes

**File:** `src/memory-store.js:934–942`

```javascript
async function flush() {
  if (!persistence.enabled) return false;
  clearPendingFlush();
  if (!dirty) return false;
  dirty = false;
  lastFlushedAt = Date.now();
  lastFlushError = null;
  return true; // ← no actual disk I/O whatsoever
}
```

`flush()` does **not** flush anything to disk. It clears a dirty flag and updates a timestamp. The comment at line 932 admits this, but the function name, the exported API, the MCP adapter's `close()` path, and the WebSocket server's `close()` path all call this as though it provides a durability guarantee. It doesn't. It's purely a status-reporting mechanism. This is only acceptable because `DatabaseSync` writes hit SQLite synchronously on every `set()`. Callers relying on `await memory.flush()` for durability are mistaken.

### 1c — `mcp-server.mjs` SIGINT path skips `flushSync()`

**File:** `mcp-server.mjs:201–211`

```javascript
const close = async () => {
  await app.close(); // calls memory.flush() — async no-op
};
process.once("SIGINT", () => {
  close().finally(() => process.exit(130));
});
process.once("SIGTERM", () => {
  close().finally(() => process.exit(143));
});
```

The WebSocket `server.js` shutdown at line 20 correctly calls `memory.flushSync()` before async cleanup. The MCP adapter does **not** call `flushSync()` anywhere. Both are no-ops for byte durability, but `flushSync()` at least clears the dirty flag and pending timer synchronously before exit. The MCP path skips this entirely.

### 1d — Persistence is configured and the DB file exists ✓

`.env` contains `MEMORY_FILE="data/memory.db"` and `data/memory.db` exists. Persistence is active.

---

## [2] TTL / Expiry

**STATUS: FAULT — wall-clock time is used everywhere**

### 2a — `Date.now()` throughout; NTP corrections can cause premature expiry

**File:** `src/memory-store.js:579`, `src/memory-store.js:899–909`

```javascript
const now = options.clock || options.now || Date.now;
```

Every expiry comparison uses `Date.now()` (wall clock). An NTP step correction of even −1 second will cause entries that should survive another second to be immediately pruned. A step forward will cause entries to linger past their TTL. The clock is injectable for tests (good), but there is no monotonic clock option at all.

### 2b — Background prune timer and lazy read filter are independent

**File:** `src/server.js:229–237`

Prune is eager (background timer, 600s interval) and reads also gate lazily via `getVisibleEntry`. Two separate `now()` calls, two separate paths. Architecturally fine, but an entry with a 10ms TTL sits in the DB for up to 10 minutes until the background sweep cleans it.

### 2c — `search` → `get` gap: expired entry disappears silently

**File:** `src/memory-store.js:1164` (search), `1210–1214` (get)

If an entry expires between `search()` returning its key and the caller calling `get(key)`, the `get()` returns `null` with no explanation of whether the key never existed or has expired. This distinction is undocumented in the protocol and MCP tool API.

---

## [3] ifRevision / Optimistic Locking

**STATUS: PASS (grudgingly)**

The read-compare-write is inside `inTransaction()` (`src/memory-store.js:688–701`), which wraps the call in `BEGIN` / `COMMIT` / `ROLLBACK` using `DatabaseSync`. Since Node.js is single-threaded and `DatabaseSync` is synchronous, there is no concurrent writer window.

`validateRevisionCheck` handles `ifRevision === null` (create-only) correctly: if a visible row exists, it returns a conflict; if no row exists, returns null (success). First write with `ifRevision: null` succeeds. If `ifRevision` is a positive integer and the key does not exist, `revisionConflict(key, null)` is returned — the caller learns the current revision is null. Explicit enough.

No fault found here. Warrants a second look.

---

## [4] Graph Relations — Consistency on Delete

**STATUS: FAULT — minor TOCTOU in `map()`; CASCADE is correct**

### 4a — DELETE CASCADE correctly removes edges ✓

**File:** `src/memory-store.js:506–515` (schema)

```sql
from_key TEXT NOT NULL REFERENCES entries(key) ON DELETE CASCADE,
to_key   TEXT NOT NULL REFERENCES entries(key) ON DELETE CASCADE,
```

`PRAGMA foreign_keys = ON` is set at startup. When an entry is deleted, all incident edges are cascade-deleted by SQLite. No orphan edges. `doDelete` also manually collects removed edges before the cascade fires in order to broadcast them. Correct.

### 4b — `map()` uses `getEntry` instead of `getVisibleEntry` for post-BFS metadata

**File:** `src/memory-store.js:1059`, `1087–1089`, `1122`

```javascript
const aRow = stmts.getEntry.get(aNext); // line 1059 — no expiry check
visitedRows[visitedKey] = stmts.getEntry.get(visitedKey); // line 1087 — no expiry check
const row = visitedRows[nodeKey]; // line 1122 — used in nodeMetadata
```

BFS traversal uses `getIncidentVisibleEdges` which correctly filters expired endpoints. But after the BFS completes, metadata for all visited nodes is fetched using `getEntry` (no expiry filter). If a node expires between BFS and the metadata fetch, the map result will include expired metadata. This is a TOCTOU hole. It's narrow but it's wrong.

---

## [5] Bulk Operations

**STATUS: FAULT — THESE OPERATIONS DO NOT EXIST IN THE CODE**

The `CLAUDE.md` project instructions state:

> `memory_bulk_set({ entries })` and `memory_bulk_relate({ relations })` apply many writes in one round-trip with per-item failure isolation.

> `mcp-server.mjs`: official stdio MCP adapter exposing `memory_set`, `memory_get`, `memory_search`, `memory_suggest`, `memory_map`, **`memory_audit`**, **`memory_bulk_set`**, **`memory_bulk_relate`** ...

> `memory_audit({ staleMs? })` (MCP tool) and the **`audit`** WebSocket command return `{ zombies, orphans, duplicates, stale, expired, counts }`.

> `auditMetadata()` helper used by the `set` write path.

**None of these exist in the code:**

| Feature                       | `protocol.js` `COMMAND_TYPES` | `mcp-tools.js` | `mcp-server.mjs` |
| ----------------------------- | ----------------------------- | -------------- | ---------------- |
| `bulk_set` WS command         | ✗ missing                     | —              | —                |
| `bulk_relate` WS command      | ✗ missing                     | —              | —                |
| `audit` WS command            | ✗ missing                     | —              | —                |
| `memory_bulk_set` MCP tool    | —                             | ✗ missing      | ✗ missing        |
| `memory_bulk_relate` MCP tool | —                             | ✗ missing      | ✗ missing        |
| `memory_audit` MCP tool       | —                             | ✗ missing      | ✗ missing        |
| `auditMetadata()` helper      | ✗ missing                     | —              | —                |

The `/status` endpoint is also documented as exposing `audit: { zombieCount, orphanCount, duplicateGroupCount, staleCount, expiredCount }` — the actual response contains no `audit` field (`src/server.js:86–97`).

Clients and Claude agents reading `CLAUDE.md` that call `memory_bulk_set` or `memory_audit` will receive an `unknown-type` error or no response at all with no indication that the API simply does not exist.

---

## [6] Auth

**STATUS: PASS WITH ONE OBSERVATION**

Token check is per-message (`src/server.js:269–272`). Unauthenticated clients cannot read data — every non-`auth` message hits the `!isAuthenticated` guard and receives `{ type: 'error', message: 'unauthorized' }`. Correct.

The `/status` endpoint checks the `Authorization` header (`src/server.js:81`). Memory keys are not leaked to unauthenticated callers. Fine.

**Observation:** `app.use(express.static(...))` at `src/server.js:78` serves the entire `public/` dashboard with no auth check. The full dashboard JavaScript — including WebSocket protocol details and all tool names — is public regardless of `MEMORY_TOKEN`. Acceptable for a localhost-only server; an info-disclosure fault for anything exposed beyond localhost.

No token-bypass path found. Remaining suspicious.

---

## [7] Import / Merge

**STATUS: FAULT — merge mode silently discards higher-revision snapshot data**

### 7a — Dangling edge detection works correctly for replace mode ✓

**File:** `src/memory-store.js:210–215`

Both `validateSnapshotReplace` and `validateSnapshotMerge` check that edge endpoints exist in `validKeys`. Dangling edges are caught and reported as `dangling-edge` errors. A snapshot with dangling edges is rejected before touching live memory. Correct.

### 7b — Merge mode: existing entry always wins, no revision comparison

**File:** `src/memory-store.js:424–427`

```javascript
if (existingKeys.has(key)) {
    entriesSkipped += 1;
    continue;
}
```

In merge mode, if a key already exists in the live store, the snapshot version is skipped unconditionally — regardless of revision numbers. If the snapshot contains revision 5 of a key and the live store has revision 2 (stale), the stale revision 2 wins silently. There is no conflict detection, no revision comparison, and no warning beyond the `entriesSkipped` counter in stats. A merge import cannot be used to propagate updates to existing keys. This behavior is not documented in the WebSocket protocol or MCP tool descriptions. Callers expecting "last-writer-wins" semantics will silently lose data.

### 7c — `doMerge` uses `upsertEntry` with `ON CONFLICT DO UPDATE` internally

**File:** `src/memory-store.js:870`

`doMerge` calls `upsertEntry` (an `INSERT ... ON CONFLICT DO UPDATE`) for every entry in the pre-filtered `validation.snapshot`. Since `validateSnapshotMerge` strips existing keys, the UPDATE branch should never trigger in practice. However, `doMerge` has no internal guard — it trusts the validation output completely. If the validate/merge split is ever refactored or `doMerge` is called directly, existing data could be silently overwritten with no error.

---

## Summary

| #   | Area                                                       | Status       | Severity |
| --- | ---------------------------------------------------------- | ------------ | -------- |
| 1a  | WAL + synchronous=NORMAL power-loss gap                    | Fault        | Medium   |
| 1b  | flush() is a status no-op, not a durability guarantee      | Fault        | Low      |
| 1c  | mcp-server.mjs skips flushSync() on shutdown               | Fault        | Low      |
| 2a  | Wall-clock TTL, NTP-sensitive expiry                       | Fault        | Medium   |
| 2c  | search→get expiry gap undocumented                         | Observation  | Low      |
| 4b  | map() TOCTOU: getEntry instead of getVisibleEntry          | Fault        | Low      |
| 5   | bulk_set / bulk_relate / audit / auditMetadata don't exist | **Critical** | **High** |
| 6   | Static dashboard served without auth                       | Observation  | Low      |
| 7b  | Merge silently discards higher-revision snapshot entries   | Fault        | Medium   |
| 7c  | doMerge trusts validation output, no internal guard        | Fault        | Low      |

---

## Overall Verdict

**`FRAGILE`**

The core SQLite machinery is sound. WAL with foreign keys and synchronous transactions is a reasonable foundation. The code that exists works. The problem is what doesn't exist.

**Single most critical fix:**

Remove or implement `memory_bulk_set`, `memory_bulk_relate`, `memory_audit`, and the `audit` WebSocket command from `CLAUDE.md` immediately. Every Claude agent in this project is being told to use APIs that return nothing, and they have no way to know these calls are silently failing.
