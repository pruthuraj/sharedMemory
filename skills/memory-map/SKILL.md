---
name: memory-map
description: Traverse the sharedMemory graph around one key using the memory_map MCP tool. Use when Codex needs nearby related memories, dependencies, decisions, or next steps.
---

# Memory Map

Use `memory_map` to inspect graph neighborhood metadata around a known key.

## Inputs

- `key`: non-empty root key.
- `depth`: optional integer from 0 to 10.
- `limit`: optional integer from 1 to 100.

## Safe Use

Traversal is bidirectional and metadata-only. Use `memory_get` for full values. Treat `{ ok: false, error: "missing-node" }` as missing or expired root memory.

## Output

Success returns `{ ok: true, key, nodes, edges }`.
