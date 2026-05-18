---
name: memory-bulk-relate
description: Create or update multiple sharedMemory graph relations with one MCP call using memory_bulk_relate. Use when Codex needs to link several memories efficiently.
---

# Memory Bulk Relate

Use `memory_bulk_relate` after bulk memory capture or graph import.

## Inputs

- `relations`: array of relation items. Each item uses `from`, `to`, an official relation type, optional `reason`, and optional `weight` from 0 to 1 inclusive. Official relation types are `related_to`, `depends_on`, `supports`, `contradicts`, `mentions`, `derived_from`, `next_step`, `implements`, `documents`, and `blocks`.

## Safe Use

Each relation is isolated: one failure does not stop the others. Both endpoints must exist for each relation. Prefer meaningful relation types and reasons.

## Output

Success returns `{ ok: true, results }`, where each result has per-item `ok`, `action`, `edge`, or `error`.
