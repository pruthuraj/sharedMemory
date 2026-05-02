# Persistent Memory Graph Implementation Plan

## Summary
Implement persistence inside-out, starting with `src/memory-store.js`. The store remains the runtime source of truth, while optional JSON persistence uses debounced atomic async flushing during normal operation and synchronous atomic flushing during shutdown.

## Key Changes
- Add optional persistence to `createMemoryStore({ persistence })`.
  - `persistence.file`: JSON file path.
  - `persistence.debounceMs`: default `500`.
  - `persistence.scheduler`: injectable `{ setTimeout, clearTimeout }` for deterministic tests.
- Load persisted state at store creation:
  - Missing file starts empty.
  - Invalid JSON fails store creation clearly.
  - Dangling edges are dropped during load.
  - Loaded entries and valid edges preserve metadata and timestamps.
- Add store persistence methods:
  - `flush()`: async atomic write if dirty.
  - `flushSync()`: synchronous atomic write for process shutdown.
  - `persistenceStatus()`: `{ enabled, file, dirty, lastLoadedAt, lastFlushedAt, lastFlushError }`.
  - Internal export/import helpers for tests and disk state.
- Debounced dirty tracking:
  - `set`, `relate`, `unrelate`, and `delete` mark the store dirty.
  - Rapid mutations keep only one active pending timer.
  - Timer flush catches errors, stores `lastFlushError`, keeps `dirty: true`, and logs `console.error`.
- Atomic write behavior:
  - Ensure the target directory exists.
  - Write JSON to a temp file next to the target.
  - Rename temp file over the target.
  - Async flush uses async fs APIs.
  - Shutdown flush uses `fs.writeFileSync` and `fs.renameSync`.

## Server Integration
- In `src/server.js`, create the store with persistence when `MEMORY_FILE` or an explicit server option is provided.
- Extend `/status` with `persistence`.
- Ensure `appServer.close()` forces `await memory.flush()` before resolving.
- In root `server.js`, install `SIGINT` and `SIGTERM` handlers for the started server instance:
  - call `memory.flushSync()`;
  - close the server if practical;
  - exit with the correct signal code.
- Do not add request IDs in this slice.

## Test Plan
- Add store-level tests for:
  - Missing file starts empty.
  - Invalid JSON fails startup.
  - Entries and edges persist after `flush()`.
  - Restart reloads entries and valid relations.
  - Dangling persisted edges are dropped.
  - Cascade delete persists removed edges.
  - Debounce scheduler keeps one active timer for rapid mutations.
  - Async flush failure keeps `dirty: true` and records `lastFlushError`.
  - `flushSync()` writes a valid atomic snapshot.
- Add server-level tests for:
  - `/status.persistence` when disabled and enabled.
  - `appServer.close()` flushes pending dirty state.
- Keep all existing graph and protocol tests passing.
- Verify with:
  - `node --check server.js`
  - `node --check example_agent.js`
  - `node --check src/*.js`
  - `node --check test/*.js`
  - `npm test`

## Assumptions
- Persistence is local JSON only.
- Runtime operations stay RAM-first and non-blocking.
- Search and request IDs remain out of scope for this slice.
- Synchronous persistence is used only for shutdown/final-flush paths.
