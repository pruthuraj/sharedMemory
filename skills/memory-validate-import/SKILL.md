---
name: memory-validate-import
description: Validate a sharedMemory snapshot before import using the memory_validate_import MCP tool. Use when Codex needs to check snapshot shape without mutating the database.
---

# Memory Validate Import

Use `memory_validate_import` before importing external or generated snapshots.

## Inputs

- `snapshot`: object with `entries` and `edges`.
- `mode`: optional `replace` or `merge`; default behavior is replace.

## Safe Use

Validation does not mutate memory. Public imports are strict, so fix all validation errors before calling `memory_import`.

## Output

Valid snapshots return `{ ok: true, errors: [], stats }`. Invalid snapshots return `{ ok: false, error: "invalid-snapshot", errors }`.
