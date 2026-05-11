---
name: memory-relate
description: Create or update a typed relation between two sharedMemory keys using the memory_relate MCP tool. Use when Codex needs to connect memories into the graph.
---

# Memory Relate

Use `memory_relate` after creating or updating memories so recall can traverse the graph.

## Inputs

- `from`: existing source key.
- `to`: existing target key.
- `relation`: one of `related_to`, `depends_on`, `supports`, `contradicts`, `mentions`, `derived_from`, `next_step`.
- `reason`: optional non-empty explanation.
- `weight`: optional numeric strength. Prefer 0 to 1.

## Safe Use

Both endpoints must exist and be visible. Self-relations are rejected. Prefer specific relation types over `related_to` when meaning is clear.

## Output

Success returns `{ ok: true, action, edge }`. Common failures are `missing-node`, `invalid-relation`, and `self-relation-not-allowed`.
