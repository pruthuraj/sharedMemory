---
name: memory-search
description: Search sharedMemory metadata using the memory_search MCP tool. Use when Codex needs to find relevant keys by query text, tags, or importance without loading full values.
---

# Memory Search

Use `memory_search` before writing or when recalling related context.

## Inputs

At least one filter is required:

- `query`: non-empty search text.
- `tags`: array of tags; all tags must match.
- `minImportance`: integer from 0 to 10.
- `limit`: optional integer from 1 to 100.

## Safe Use

Search returns metadata only. Use `memory_get` for full values. Use specific queries and tags to avoid broad noisy results.

## Output

Success returns `{ ok: true, results, total }`. Missing filters return `{ ok: false, error: "missing-filter" }`.
