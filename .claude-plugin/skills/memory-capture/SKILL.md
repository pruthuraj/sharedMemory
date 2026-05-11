---
name: memory-capture
description: >
  Sweep the current conversation, extract every important fact / decision / insight / blocker / action item / preference, store each one in the shared memory MCP server with proper metadata, and link them as a graph.
  Use when: the user says "remember this", "save this", "capture this", "store what we discussed", "/memory-capture", or at the end of a substantive conversation.
  Skip when: the conversation contained no decisions / insights / facts worth carrying forward, or the memory MCP server is unreachable.
---

# Memory Capture Skill

## Purpose

Force a structured, lossless capture pass over the current conversation. Extracts important knowledge, deduplicates against existing memory, stores with proper metadata, and links new entries into the graph.

## Required tools

- `memory_search` — dedup check before writing
- `memory_set` — store single entry (use for updates to existing keys)
- `memory_bulk_set` — store multiple new entries in one call
- `memory_get` — read existing entries when updating
- `memory_relate` — link a single entry
- `memory_bulk_relate` — link multiple entries in one call
- `memory_audit` — post-capture quality gate

If `memory-mcp` is not configured in the project's `.mcp.json`, abort and tell the user to add it (server lives at `${pluginDir}/../mcp-server.mjs`).

## Procedure

### Step 1 — Scan the conversation

Re-read the entire current conversation. Build a candidate list categorized by type:

| Type | Key prefix | Importance range |
|---|---|---|
| Decision (with rationale) | `decision.<topic>` | 7–8 |
| Insight / gotcha / lesson | `insight.<topic>` | 6–8 |
| Stable technical fact | `fact.<topic>` | 5–7 |
| Project info / scope | `project.<name>` | 8–10 |
| Action item / todo | `task.<name>` | 5–7 |
| Blocker / risk | `blocker.<topic>` | 6–8 |
| Setup / config | `setup.<thing>` | 6–8 |
| External reference | `reference.<system>` | 3–5 |
| User preference | `preference.<topic>` | 5–7 |

**Importance tiebreaker (within range):** Pick the higher end if the entry will constrain future decisions or must be recalled to avoid mistakes. Pick the lower end if it's context-only and missing it causes no harm.

**Split vs merge rule:** One entry per atomic decision or insight. If you write `and` more than twice in the summary, split it into two entries. If two candidates share the same key, merge them — don't create `insight.X` and `insight.X-detail`.

Skip:
- Chitchat, greetings, acknowledgements
- Information derivable from `git log` or by reading code
- Anything that will be irrelevant in a week
- Things the user explicitly said not to store

### Step 2 — Dedup pass

For each candidate, run `memory_search(query="<key topic words>")`. If a similar entry exists:
- If the candidate adds new information → `memory_set` with the SAME key (revision auto-increments).
- If the candidate is fully redundant → drop it from the list.

### Step 3 — Write entries and link immediately (per entry)

For each surviving candidate, write then link before moving to the next. Do not batch all writes then all links — if capture fails mid-way, already-written entries would have no graph edges.

**3a. Write the entry**

Use `memory_bulk_set` for all new entries in one call. Use `memory_set` only when updating an existing key (where `ifRevision` matters).

Each entry in `bulk_set.entries`:
- `key` — namespaced, lowercase, dot-separated (`decision.use-postgres`, NOT `Decision: Use Postgres`)
- `value` — full content including rationale; if the entry records a code change include `filesChanged: [...]`
- `summary` — one line ≤120 chars (this is what the hook surfaces)
- `tags` — array of 2–5 lowercase tags
- `importance` — see scale + tiebreaker above

**Files affected rule:** For any entry recording a code change (fix, implementation, refactor), include a `filesChanged` array in `value`:

```json
{
  "summary": "what was done and why",
  "filesChanged": ["src/foo.js", "test/foo.test.js"],
  "rationale": "..."
}
```

Omit `filesChanged` entirely for non-code entries (decisions, preferences, references).

**3b. Link each entry immediately after writing**

Use `memory_bulk_relate` to link all relations for the just-written entries in one call.

Mandatory links for every new entry:
1. **To the parent project** — `memory_relate(new_key, project.<name>, "related_to", ...)`
2. **To today's session log** — `memory_relate(new_key, session.<YYYY-MM-DD>, "derived_from", "captured during this session")`

Optional but encouraged:
3. **To prerequisite entries** — `depends_on` if the new entry relies on something
4. **To contradicted entries** — `contradicts` if the new entry overrides a prior decision

Relation types: `related_to`, `depends_on`, `supports`, `contradicts`, `mentions`, `derived_from`, `next_step`.

### Step 4 — Write/update the session log

Always create or update `session.<YYYY-MM-DD>` with this structure:

```json
{
  "summary": "one paragraph describing what was discussed",
  "entriesCaptured": ["decision.X", "insight.Y"],
  "filesChanged": ["src/foo.js"]
}
```

- `entriesCaptured` — keys of every entry written or updated this session
- `filesChanged` — union of all `filesChanged` arrays across entries this session; omit if no code was touched
- If the session entry already exists: `memory_get` it, merge in new keys and files, write back with same key

### Step 5 — Post-capture audit

After all entries are written, call `memory_audit()` and check `counts.zombieCount`. If > 0, inspect the zombies — if any were just written by this capture pass, fix them before reporting (add missing tags/importance). Surface the audit result in the report.

### Step 6 — Report back

Output a concise summary in this format:

```
Captured N entries:
  + decision.X        — <summary>  [linked to: project.Y, session.Z]
  + insight.A         — <summary>  [linked to: B, C, D]
  ↻ project.sharedMemory (updated, rev 3) — <what changed>

Skipped: <count> redundant, <count> low-value

Audit: <zombieCount> zombies, <orphanCount> orphans
```

## Anti-patterns

- ❌ Writing without searching first → creates duplicates
- ❌ Writing without `summary` → useless in the hook context
- ❌ Writing without `importance` → all entries default to 0 and never surface
- ❌ Creating an entry but not linking it → wasted memory, no graph value
- ❌ Linking after all writes → unlinked entries if capture fails mid-way
- ❌ Capturing chitchat ("user said hi") → noise pollutes future recalls
- ❌ Verbose `value` fields → keep them tight; the summary is what gets seen
- ❌ Over-namespacing keys (`decision.api.auth.jwt.refresh.token.lifetime`) → 2–3 segments max
- ❌ Omitting `filesChanged` on code-change entries → future sessions can't locate what was touched without re-grepping
- ❌ Writing `and` more than twice in a summary → split into two entries

## Example invocations

### Non-code session

> User: `/memory-capture`

```
Captured 3 entries:
  + decision.use-cross-env  — Use cross-env for Windows-compatible npm scripts  [→ project.sharedMemory, → session.2026-05-05]
  + insight.mcp-no-delete-tool  — memory-mcp lacks delete tool; use WS protocol instead  [→ arch.mcp, → session.2026-05-05]
  + setup.global-hook  — UserPromptSubmit hook in ~/.claude/settings.json fires for every project  [→ setup.claude-code-hook, → session.2026-05-05]

↻ session.2026-05-05 updated (rev 2) — 3 entries captured.

Skipped: 1 redundant (project.sharedMemory already current), 4 low-value (chitchat).

Audit: 0 zombies, 0 orphans.
```

### Code-change session

> User: `/memory-capture` (after implementing audit + bulk ops)

```
Captured 2 entries:
  + insight.sharedMemory.audit-was-missing  — audit/bulk ops in docs but absent from code; re-implemented 2026-05-11
      filesChanged: [src/protocol.js, src/memory-store.js, src/server.js, src/mcp-tools.js, mcp-server.mjs, test/server.test.js]
      [→ project.sharedMemory, → session.2026-05-11, → decision.sharedMemory.curation-tools]
  + insight.sharedMemory.welcome-auth-leak  — welcome message leaked agentId pre-auth; agentId moved to authenticated response
      [→ project.sharedMemory, → session.2026-05-11]

↻ session.2026-05-11 updated (rev 2) — filesChanged added, 2 entries captured.

Skipped: 2 redundant, 1 low-value.

Audit: 0 zombies, 1 orphan (task.sharedMemory.zombie-cleanup — already resolved, safe to ignore).
```
