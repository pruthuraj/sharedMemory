---
name: memory-suggest
description: Retrieve semantic sharedMemory suggestions using the memory_suggest MCP tool. Use when Codex has task context and wants relevant memories without knowing exact keys.
---

# Memory Suggest

Use `memory_suggest` for context-based recall.

## Inputs

- `context`: non-empty task or question text.
- `tags`: optional tag filter.
- `limit`: optional integer from 1 to 20.

## Safe Use

Suggestions are disabled by default unless `MEMORY_SUGGEST_ENABLED=true`. If disabled, the tool returns an empty result without loading a model. Results are metadata only; call `memory_get` for full values.

## Output

Success returns `{ ok: true, enabled, suggestions }`. Disabled mode returns `{ ok: true, enabled: false, suggestions: [] }`.
