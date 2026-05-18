---
name: memory-bulk-set
description: Store multiple sharedMemory entries with one MCP call using memory_bulk_set. Use when Codex needs to import or capture several independent memories efficiently.
---

# Memory Bulk Set

Use `memory_bulk_set` for multiple entry writes in one round trip.

## Inputs

- `entries`: array of set items. Each item uses the `memory_set` fields: `key`, `value`, optional metadata, expiry, and `ifRevision`.

## Safe Use

Each item is isolated: one failure does not stop the others. Use this for independent writes, not all-or-nothing transactions. Search first when duplicate risk is high.

## Output

Success returns `{ ok: true, results }`, where each result has per-item `ok`, `key`, `revision`, or `error`.
