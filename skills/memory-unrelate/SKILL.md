---
name: memory-unrelate
description: Remove a typed relation between two sharedMemory keys using the memory_unrelate MCP tool. Use when Codex needs to detach graph edges without deleting memories.
---

# Memory Unrelate

Use `memory_unrelate` when a specific edge is wrong or stale but both memory entries should remain.

## Inputs

- `from`: source key.
- `to`: target key.
- `relation`: relation type to remove.

## Safe Use

This is idempotent. A missing edge returns success with `removed: false`. Do not use this to delete memory entries.

## Output

Success returns `{ ok: true, removed, edge }`.
