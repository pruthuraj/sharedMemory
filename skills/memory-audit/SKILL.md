---
name: memory-audit
description: Audit sharedMemory health using the memory_audit MCP tool. Use when Codex needs to find zombie, orphan, duplicate, stale, or expired memory entries before cleanup.
---

# Memory Audit

Use `memory_audit` for read-only memory hygiene checks.

## Inputs

- `staleMs`: optional positive age threshold in milliseconds.

## Safe Use

Audit does not mutate the store. Report findings first. Only use write tools after explicit cleanup authorization.

## Output

Success returns `{ ok: true, zombies, orphans, duplicates, stale, expired, counts }`.
