# Memory Graph Policy

## Core principle

The graph is project-centered. Durable knowledge belongs under a project root. Session nodes are work logs and must not become a second hub for durable memory.

```text
project.<name>
├── arch.<project>.<topic>
├── api.<project>.<surface>
├── data.<project>.<model>
├── feature.<project>.<name>
├── decision.<project>.<topic>
├── insight.<project>.<topic>
├── task.<project>.<name>
├── blocker.<project>.<topic>
├── setup.<project>.<thing>
├── reference.<project>.<thing>
├── agent.<name>
├── preference.<topic>
└── session.<YYYY-MM-DD>
    ├── what
    ├── why
    ├── affected
    ├── plan
    ├── done
    ├── changes
    ├── files
    │   └── file.<project>.<path-or-name>
    └── sources
```

## Key taxonomy

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
| `session-section.<session-id>.what`     | What happened in the session                             |
| `session-section.<session-id>.why`      | Why the work happened                                    |
| `session-section.<session-id>.affected` | What was affected                                        |
| `session-section.<session-id>.plan`     | Plan or intended direction                               |
| `session-section.<session-id>.done`     | What was completed                                       |
| `session-section.<session-id>.changes`  | Entries, changes, or updates produced                    |
| `session-section.<session-id>.files`    | Files changed or mentioned                               |
| `session-section.<session-id>.sources`  | Source entries, prompts, logs, or references             |
| `file.<project>.<path-or-name>`         | File node when a file needs graph identity               |
| `evidence.<project>.<topic>`            | Optional proof/source node for tentative or raw evidence |

## Visual naming rule for session children

Session children should display as short labels:

```text
what
why
affected
plan
done
changes
files
sources
```

Internally, keys must remain unique:

```text
session-section.2026-05-11.what
session-section.2026-05-11.why
session-section.2026-05-11.affected
session-section.2026-05-11.plan
session-section.2026-05-11.done
session-section.2026-05-11.changes
session-section.2026-05-11.files
session-section.2026-05-11.sources
```

## Relation rules

### Durable entries

Durable entries must link to their parent project.

```text
decision.sharedmemory.cytoscape-migration
  -> project.sharedmemory
  relation: supports
```

Durable entries may link to other durable entries only when the relationship is genuinely useful.

```text
feature.sharedmemory.node-card-ui
  -> decision.sharedmemory.cytoscape-migration
  relation: implements
```

### Session roots

A session root links only to its project root.

```text
session.2026-05-11
  -> project.sharedmemory
  relation: documents
```

Do not create durable-entry to session edges.

Bad:

```text
insight.sharedmemory.cytoscape-svg-background
  -> session.2026-05-11
```

Good:

```text
insight.sharedmemory.cytoscape-svg-background
  -> project.sharedmemory
```

### Session sections

Session-section nodes link to the session root.

```text
session-section.2026-05-11.what
  -> session.2026-05-11
  relation: documents
```

File nodes may link to the files section.

```text
file.sharedmemory.src-server-js
  -> session-section.2026-05-11.files
  relation: documents
```

## Entry schema

```json
{
  "key": "decision.sharedmemory.import-merge",
  "value": {
    "project": "sharedmemory",
    "type": "decision",
    "status": "active",
    "decision": "Dashboard JSON imports should merge into the existing graph by default.",
    "rationale": "Importing should preserve existing memory instead of replacing it unexpectedly.",
    "filesChanged": []
  },
  "summary": "Dashboard JSON upload merges into memory by default.",
  "tags": ["decision", "sharedmemory", "dashboard", "import"],
  "importance": 8,
  "expiresAt": null
}
```

## Session root schema

```json
{
  "key": "session.2026-05-11",
  "value": {
    "project": "sharedmemory",
    "type": "session",
    "date": "2026-05-11",
    "status": "closed",
    "sections": {
      "what": "session-section.2026-05-11.what",
      "why": "session-section.2026-05-11.why",
      "affected": "session-section.2026-05-11.affected",
      "plan": "session-section.2026-05-11.plan",
      "done": "session-section.2026-05-11.done",
      "changes": "session-section.2026-05-11.changes",
      "files": "session-section.2026-05-11.files",
      "sources": "session-section.2026-05-11.sources"
    }
  },
  "summary": "Session root for sharedMemory work on 2026-05-11.",
  "tags": ["session", "sharedmemory"],
  "importance": 5,
  "expiresAt": null
}
```

## Session-section schema

```json
{
  "key": "session-section.2026-05-11.done",
  "value": {
    "project": "sharedmemory",
    "type": "session-section",
    "section": "done",
    "items": [
      "Reclassified vague edges.",
      "Generated per-project splits.",
      "Added relation types."
    ]
  },
  "summary": "Done section for session.2026-05-11.",
  "tags": ["session-section", "done", "sharedmemory"],
  "importance": 5,
  "expiresAt": null
}
```

## Capture rules

Capture durable information when the conversation includes:

- decisions that constrain future work
- stable facts or constraints
- architecture or data-flow boundaries
- API contracts or schemas
- debugging insights or gotchas
- unresolved tasks
- blockers or risks
- durable setup commands or file paths
- stable user or project preferences
- session summaries that changed project direction

Skip:

- greetings and one-off wording edits
- facts already stored unless they changed
- raw logs when a summary is enough
- secrets, tokens, credentials, cookies, private keys, or unnecessary personal data
- information unlikely to matter after one week

## Search-first rule

Before writing, search the existing graph by project name, topic words, and likely namespace.

```text
memory_search(query="<project> <topic> <decision/fact/insight/task>")
```

Then:

- update the existing key if the topic already exists
- create a new key only for a genuinely different concept
- preserve unique facts when merging
- avoid `*.v2`, `*.new`, or `*.updated` keys unless a real versioned concept exists

## Duplicate handling

When duplicate project roots or duplicate facts exist:

1. Pick a canonical lowercase key.
2. Merge useful value content.
3. Add `mergedFrom` inside `value`.
4. Repoint edges to the canonical key.
5. Do not keep stale duplicate roots unless historical context is important.

## Importance scale

| Score | Meaning                                                          |
| ----- | ---------------------------------------------------------------- |
| 10    | Core project identity or fundamental architecture                |
| 9     | Major architecture, hard constraint, central decision            |
| 7-8   | Important decisions, reusable insights, setup future agents need |
| 5-6   | Current tasks, useful session context, medium-impact references  |
| 3-4   | Minor references or low-impact facts                             |
| 1-2   | Temporary note that should probably expire                       |
| 0     | Disposable/zombie only when the system explicitly needs it       |

## Security and privacy

Never store secrets, credentials, tokens, cookies, private keys, exact private addresses, or unnecessary personal identifiers. Store only a safe abstract summary when the raw data is sensitive or confidential.

## Final graph rule

```text
Durable nodes -> project.<name>
session.<YYYY-MM-DD> -> project.<name>
session-section.<session-id>.* -> session.<YYYY-MM-DD>
file.<project>.* -> session-section.<session-id>.files
```
