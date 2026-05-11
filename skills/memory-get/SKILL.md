---
name: memory-get
description: Read a full sharedMemory entry by key using the memory_get MCP tool. Use when Codex needs the complete stored value, revision, expiry, or metadata for one known memory key.
---

# Memory Get

Use `memory_get` when the key is already known and the full value is needed.

## Inputs

- `key`: non-empty memory key.

## Safe Use

Use `memory_search` first if the exact key is uncertain. Treat `entry: null` as missing or expired. Preserve `revision` if a follow-up write should use `ifRevision`.

## Output

Success returns `{ ok: true, key, entry }`. `entry` is the full memory entry or `null`.
