# Persistent Memory Graph Implementation Plan

## Summary
Implement optional JSON persistence for the memory graph. Runtime operations stay RAM-first, while debounced atomic flushes make entries and relationships durable when `MEMORY_FILE` is configured.

## Key Changes
- Add optional persistence via `createMemoryStore({ persistence })` and `MEMORY_FILE`.
- Load existing state at startup; missing files start empty and invalid JSON fails clearly.
- Persist `entries` and graph `edges` in a deterministic JSON shape.
- Drop dangling loaded edges so graph integrity is restored at boot.
- Mark state dirty after `set`, `relate`, `unrelate`, and `delete`.
- Flush dirty state with debounced atomic writes: temp file next to target, then rename.
- Add `flush()`, `flushSync()`, `persistenceStatus()`, and export/import helpers to the store.
- Extend `/status` with `persistence`.
- Force final flush on `appServer.close()`, `SIGINT`, and `SIGTERM`.

## Persistence Behavior
- RAM remains the source of truth while the server is running.
- Flush failures are caught inside timer callbacks, recorded in `lastFlushError`, and leave `dirty: true`.
- Async flush is used for normal operation; sync flush is reserved for shutdown paths.
- Persistence is optional and disabled unless a file path is provided.
- Request IDs, search, auth, embeddings, and dashboards stay out of this slice.

## Test Plan
- Existing graph and protocol tests continue passing.
- Add persistence coverage for:
  - Missing files, invalid JSON, defensive dangling-edge load, restart recovery, cascade delete persistence, debounced scheduling, flush failure state, sync flush, `/status.persistence`, and close-time flushing.
- Verify with:
  - `node --check server.js`
  - `node --check example_agent.js`
  - `node --check src/*.js`
  - `node --check test/*.js`
  - `npm test`

## Assumptions
- Persistence is local JSON only.
- Runtime operations stay RAM-first and non-blocking.
- Search and request IDs remain out of scope.
- Synchronous file writes are used only for shutdown/final-flush paths.
