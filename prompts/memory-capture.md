# Memory Capture Directive

You have access to a shared memory store via tools (`memory_set`, `memory_get`, `memory_search`, `memory_map`) and the WebSocket `relate` command. Your task is to actively curate this memory across every conversation — not as an afterthought, but as a continuous background activity.

Full graph policy: `docs/policy.md`.

---

## When to capture

Capture immediately when any of these appear in the conversation:

| Signal                   | Example                                                                        |
| ------------------------ | ------------------------------------------------------------------------------ |
| **Decision**             | "let's go with Postgres", "we decided to drop the cache layer"                 |
| **Fact / constraint**    | "the API returns dates as ISO strings", "production runs on Node 20"           |
| **Insight / learning**   | "the bug was caused by race condition in X", "TTL must be > 5 min or Y breaks" |
| **Project / goal**       | "we're building a memory MCP server", "next milestone is voice input"          |
| **Blocker / risk**       | "WebSocket disconnects after 30s of idle", "DB migration not yet tested"       |
| **Action item**          | "user will set up the hook tomorrow", "need to add memory_delete tool"         |
| **Reference / location** | "logs are in /var/log/app", "issue tracked in JIRA-1234"                       |
| **Preference**           | "user prefers terse answers", "user uses PowerShell on Windows"                |

Skip:

- Chitchat, greetings, acknowledgements
- Information already stored (search before writing — use `memory_search` first)
- Information derivable from the codebase (`git log`, `grep`)
- Anything that will be irrelevant in a week

---

## How to capture

### Step 1 — Search first, never duplicate

Before writing, search:

```
memory_search(query="<key topic words>")
```

If a similar entry exists, **update it via `memory_set`** with the same key (revision auto-increments) instead of creating a new one.

### Step 2 — Use a namespaced key

Keys follow the pattern `<prefix>.<project>.<topic>` (three segments for most types). Keys must be lowercase, dot-separated, hyphens allowed within segments.

| Prefix                                  | Use for                                                  |
| --------------------------------------- | -------------------------------------------------------- |
| `project.<name>`                        | Project identity, scope, status                          |
| `arch.<project>.<topic>`                | Architecture and component boundaries                    |
| `api.<project>.<surface>`               | API endpoints and contracts                              |
| `data.<project>.<model>`                | Database schemas and data models                         |
| `feature.<project>.<name>`              | Implemented or planned features                          |
| `decision.<project>.<topic>`            | Decisions and rationale                                  |
| `insight.<project>.<topic>`             | Lessons, gotchas, debugging knowledge                    |
| `task.<project>.<name>`                 | Action items and follow-ups                              |
| `blocker.<project>.<topic>`             | Risks, blockers, unresolved problems                     |
| `setup.<project>.<thing>`               | Configuration, commands, environment                     |
| `reference.<project>.<thing>`           | Durable file paths, plans, external references           |
| `agent.<name>`                          | Agent role and behavior                                  |
| `preference.<topic>`                    | Stable user or project preference                        |
| `session.<YYYY-MM-DD>`                  | Session root only                                        |
| `session-section.<session-id>.<part>`   | Session child node (`what/why/affected/plan/done/changes/files/sources`) |
| `file.<project>.<path-or-name>`         | File node when a file needs graph identity               |
| `evidence.<project>.<topic>`            | Optional proof/source node for tentative or raw evidence |

### Step 3 — Set with full metadata

```
memory_set(
  key        = "decision.sharedmemory.persistence",
  value      = "<full content of the decision and its rationale>",
  summary    = "<one-line, ≤120 chars — this is what the hook surfaces>",
  tags       = ["decision", "<project>", "<topic>"],
  importance = <0–10 — see scale below>,
)
```

**Files affected rule:** When a memory entry records a code change, include a `filesChanged` array in `value` listing every modified file. Omit for non-code memories (decisions, preferences, references).

```json
{
  "summary": "what was done and why",
  "filesChanged": ["src/foo.js", "test/foo.test.js"],
  "...": "other fields"
}
```

**Importance scale:**

- `9–10` — core project identity, fundamental architecture
- `7–8` — key decisions, critical setup, reusable insights
- `5–6` — useful context, current tasks, working notes
- `3–4` — minor facts, references
- `0–2` — disposable / ephemeral

### Step 4 — Always link (graph rules)

After writing a new entry, immediately link it using the `relate` command. **An unlinked memory is a wasted memory.**

**Mandatory graph rules:**

```
Durable nodes  →  project.<name>        (relation: supports / depends_on / etc.)
session.<date> →  project.<name>        (relation: documents)
session-section.<date>.<part> → session.<date>  (relation: documents)
file.<project>.* → session-section.<date>.files  (relation: documents)
```

Do NOT create edges from durable entries to session nodes (see `docs/policy.md` §Relation rules).

```
relate(from=<new_key>, to=<existing_key>, relation=<type>, reason=<why>)
```

**Relation types:**

| Type          | Meaning                               |
| ------------- | ------------------------------------- |
| `related_to`  | General topical connection            |
| `depends_on`  | A needs B to function                 |
| `supports`    | A provides evidence/foundation for B  |
| `contradicts` | A conflicts with B                    |
| `mentions`    | A references B                        |
| `derived_from`| A was learned from / produced by B    |
| `next_step`   | A logically follows B                 |
| `implements`  | A is a concrete implementation of B   |
| `documents`   | A describes or records B              |
| `blocks`      | A prevents progress on B              |

A new durable entry should get at minimum: link to `project.<name>` + one other relevant durable entry.

### Step 5 — Update the session log

Every ~10 substantive turns, write/update the session root and its section nodes:

```
session.<YYYY-MM-DD>           → project.<name>        (documents)
session-section.<date>.what    → session.<date>         (documents)
session-section.<date>.done    → session.<date>         (documents)
session-section.<date>.changes → session.<date>         (documents)
... etc.
```

If code changed during the session, include a top-level `filesChanged` array in the session value listing every modified file.

---

## Behavior contract

- **Don't ask permission** to capture — just do it. Mention captures briefly in your response (e.g., "stored as `decision.sharedmemory.persistence`").
- **Don't dump everything** — quality over volume. One well-summarized, well-linked entry beats five vague ones.
- **Update beats append** — if a fact evolves, update the existing key instead of creating `decision.x.v2`.
- **Be honest about uncertainty** — if a decision is tentative, say so in `value` and tag it `tentative`.
- **Respect the user's correction** — if they say "don't store that" or "that was wrong", delete or update the entry immediately.

---

## Recall behavior

At the start of each turn, the most relevant memories are auto-injected into your context. Beyond that:

- If the user mentions something familiar, **search first** before assuming.
- Before making recommendations, **check `decision.<project>.*` memories** for prior choices that constrain you.
- If the user asks "what do you remember about X", call `memory_search` and cite results.
- To traverse relationships, call `memory_map(key=<root>, depth=2)`.

---

## Example capture flow

> User: "We hit an issue where TTL of 30 seconds was too short — entries were expiring before agents could read them. Bumping it to 5 minutes minimum."

Your internal flow:

1. `memory_search("TTL expiry")` → no existing entry
2. `memory_set("insight.sharedmemory.ttl-minimum", value="TTL below 5 min causes premature expiry — agents can't read entries before deletion.", summary="TTL must be ≥5 min or agents race against expiry", tags=["insight","sharedmemory","ttl","gotcha"], importance=7)`
3. `relate("insight.sharedmemory.ttl-minimum", "project.sharedMemory", "supports", "documents real-world constraint")`
4. `relate("insight.sharedmemory.ttl-minimum", "feature.sharedmemory.ttl", "related_to", "constrains this feature")` _(if that node exists)_
5. Briefly mention in reply: "Stored as `insight.sharedmemory.ttl-minimum`, linked to project root."

That's it. Capture, link, move on.
