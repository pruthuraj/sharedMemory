---
name: memory-export
description: Export the full sharedMemory graph snapshot using the memory_export MCP tool. Use when Codex needs backup, migration, review, or offline analysis of memory data.
---

# Memory Export

Use `memory_export` to capture the complete graph state.

## Inputs

No input is required.

## Safe Use

Export includes full stored values, not just metadata. Treat the snapshot as sensitive project data. Use it before risky imports or bulk cleanup.

## Output

Success returns `{ ok: true, snapshot, stats }`, where `snapshot` contains `entries` and `edges`.
