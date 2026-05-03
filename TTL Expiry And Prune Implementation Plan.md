# TTL Expiry And Prune Implementation Plan

## Summary

Implement TTL-based lifecycle management before snapshots/export/import. Memory entries can expire, reads remain side-effect-free, and expired entries are removed only by explicit `prune` or background sweep. The implementation uses injected time via `clock`/`now` for deterministic tests.

## Key Changes

- Extend entries with optional `expiresAt`.
  - `set` accepts `ttlMs` or `expiresAt`, not both.
  - `ttlMs` becomes `expiresAt = clock() + ttlMs`.
  - Missing expiry means no expiry.
  - `touch` with no expiry fields clears existing expiry.
- Add commands:
  - `touch`: update expiry and `updatedAt` without changing `value`.
  - `prune`: remove all expired entries and cascade edges.
- Add read-time expiry filtering:
  - `get`, `keys`, `count`, `map`, and `search` ignore expired entries.
  - `map` skips edges touching expired nodes.
  - `relate` treats expired endpoints as missing.
- Add background pruning:
  - `pruneIntervalMs` default `600000`.
  - `pruneIntervalMs: 0` disables the background sweep.
  - Scheduler remains injectable for deterministic tests.
- Extend status:
  - `expiredMemoryCount`
  - `pruneIntervalMs`
  - `lastPrunedAt`

## Notifications

- `prune` and background sweep return removed keys/edges to `src/server.js`.
- Subscribers to expired keys receive:

```json
{ "type": "update", "key": "keyA", "entry": null, "action": "expired" }
```

- Edges removed due to expiry emit existing:

```json
{ "type": "relation-update", "action": "cascade-deleted", "edge": { ... } }
```

## Implementation Notes

- Keep expiry logic inside `src/memory-store.js`.
- Use injected time as `options.clock || options.now || Date.now`.
- Add store methods/helpers:
  - `isExpired(key)`
  - `expiredCount()`
  - `expiryStatus()`
  - `touch(key, metadata)`
  - `pruneExpired()`
- `pruneExpired()` is the only expiry path that mutates state and marks persistence dirty.
- `flush`/persistence export includes `expiresAt`; import preserves valid expiry timestamps.
- `src/protocol.js` validation:
  - `ttlMs`: positive integer.
  - `expiresAt`: positive finite integer.
  - `set` and `touch`: reject both together with `invalid-expiry`.
  - `touch` may omit both to clear expiry.
- `src/server.js`:
  - Route `touch` and `prune`.
  - Call notification helpers after `prune`.
  - Start background sweep only from server wiring, not from plain store construction unless configured through server options.

## Test Plan

- Existing tests continue passing.
- Store tests:
  - `set` with `ttlMs` and `expiresAt`.
  - expired entries hidden from `get`, `keys`, `count`, `map`, and `search`.
  - map skips phantom edges touching expired nodes.
  - `relate` rejects expired endpoints.
  - `touch` extends expiry and clears expiry when no expiry fields are provided.
  - `pruneExpired()` removes expired nodes and cascades edges.
  - persistence saves/reloads `expiresAt`.
- Server tests:
  - `touch` and `prune` request/response shapes with `requestId`.
  - validation rejects invalid expiry fields.
  - prune emits `expired` updates and `cascade-deleted` relation notifications.
  - background prune runs through injected scheduler/clock.
  - `/status` includes expiry/prune fields.
- Verify with:
  - `node --check server.js`
  - `node --check example_agent.js`
  - `node --check src/*.js`
  - `node --check test/*.js`
  - `npm test`

## Assumptions

- Reads are side-effect-free and never flush persistence.
- Expiry is deterministic through injected `clock`/`now`.
- No snapshots/export/import in this slice.
- No archival history or soft delete.
