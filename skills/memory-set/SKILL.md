---
name: memory-set
description: Store or update a sharedMemory entry with metadata using the memory_set MCP tool. Use when Codex needs to save project facts, decisions, tasks, preferences, or durable context for future agents.
---

# Memory Set

Use `memory_set` to write one memory entry.

## Inputs

- `key`: non-empty dot-separated string.
- `value`: JSON value to store.
- `summary`: optional short recall sentence. Prefer <=120 characters.
- `tags`: optional string array. Prefer 2-6 lowercase tags.
- `importance`: optional integer from 0 to 10.
- `ttlMs` or `expiresAt`: optional expiry, never both.
- `ifRevision`: optional compare-and-set guard. Use `null` for create-only.

## Safe Use

Search first when duplicate risk is high. Prefer updating an existing key over creating `v2` or `new` keys. Use structured objects for `value` when practical. Do not store secrets, private keys, tokens, cookies, or unnecessary personal data.

## Output

Success returns `{ ok: true, key, entry }` with metadata only. Revision conflicts return `{ ok: false, error: "revision-conflict", key, currentRevision }`.
