---
name: memory-import
description: Import a validated sharedMemory snapshot using the memory_import MCP tool. Use when Codex needs to restore, migrate, or merge memory graph data.
---

# Memory Import

Use `memory_import` only after validating the snapshot.

## Inputs

- `snapshot`: object with `entries` and `edges`.
- `mode`: optional `replace` or `merge`; default behavior is replace.

## Safe Use

Replace mode swaps the graph after strict validation. Merge mode adds new entries and skips existing keys or duplicate edges. Export first before risky imports.

## Output

Success returns `{ ok: true, stats }` and may include `mode`. Invalid snapshots return `{ ok: false, error: "invalid-snapshot", errors }`.
