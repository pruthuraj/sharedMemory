# External AI Memory Snapshot Prompt

Use this prompt with an AI that cannot connect to the sharedMemory MCP server. It asks the AI to return a strict JSON snapshot file that can be uploaded through the dashboard Import JSON workflow.

The rules below match `ref/key-naming-policy.md` and `ref/memory-graph-faults.md` (the canonical naming + coverage policy in this repo).

```text
You are exporting useful project memory for a shared memory graph database.

Return only valid JSON. No markdown, no prose before or after. Use straight ASCII quotes only inside string values — no curly quotes, em-dashes, or other smart punctuation.

The output must be one JSON object with this shape:

{
  "entries": {
    "memory.key": {
      "value": {},
      "summary": "human readable one sentence summary",
      "tags": ["tag-one", "tag-two"],
      "importance": 0,
      "revision": 1,
      "expiresAt": null,
      "updatedAt": 1710000000000,
      "updatedBy": "<your-name>"
    }
  },
  "edges": [
    {
      "from": "memory.key",
      "to": "other.memory.key",
      "relation": "child_of",
      "reason": "why these memories are connected — one full sentence, not a label",
      "weight": 0.5,
      "updatedAt": 1710000000000,
      "updatedBy": "<your-name>"
    }
  ]
}

Replace `<your-name>` everywhere with the actual identifier of the AI generating the snapshot (e.g. "gpt-5", "claude-opus-4-7", "gemini-2.5-pro"). It must be a non-empty ASCII string with no spaces.

## Key format

Format: `<prefix>.<project>.<topic>[.<subtopic>...]`

- Minimum 2 segments (root nodes); durable entries use 3+ segments.
- All lowercase. Hyphen-separated words within each segment. No camelCase, no underscores, no spaces.
- The SECOND segment must be the canonical project name (see below) for every non-session entry.

## Allowed prefixes (only these — do not invent new ones)

- `project`       — project root node, one per project
- `arch`          — architecture, components, layers, constraints
- `api`           — API endpoints and contracts (REST, WebSocket, MCP, gRPC, etc.)
- `data`          — database schemas, data models, storage
- `decision`      — choices made and the rationale
- `feature`       — implemented or planned features
- `file`          — a specific source file that needs graph identity
- `insight`       — non-obvious lessons, root causes, debugging gotchas
- `preference`    — stable user or workflow preferences
- `reference`     — pointers to external resources, durable file paths
- `setup`         — configuration, CLI commands, environment variables
- `task`          — action items, follow-ups, open work
- `blocker`       — known blockers, risks
- `agent`         — agent role/behavior definitions
- `evidence`      — raw data or proof nodes for tentative claims
- `session`       — session root (date as second segment, e.g. `session.2026-05-18`)
- `session-section` — session child (e.g. `session-section.2026-05-18.what`, parts: what/why/done/changes/files)

DO NOT use `fact.*`, `analytics.*`, `backend.*`, `mobile.*`, `testing.*`. Map them to the correct prefix above:
- `fact.*` → `reference.*`
- `analytics.*` → `data.*`
- `backend.*` → `arch.*` or `api.*`
- `mobile.*` → `arch.*` or `feature.*`
- `testing.*` → `decision.*` or `insight.*`

## Canonical project names (use the exact lowercase string)

If the snapshot is for one of the known projects, the second segment of every key MUST be one of:
`sharedmemory`, `webreader`, `hextts`, `ecg-digital-twin`, `portfolio`, `cross-project`.

If it is a new project, pick a lowercase hyphen-separated name and use it consistently. Never write `sharedMemory`, `WebReader`, `HexTTs`, or `ECG-Digital-Twin`.

## File-node project rule

The project segment in `file.<project>.*` must be the project where the file LIVES, not the project the current session is about. If a sharedmemory session mentions an ECG MATLAB file, write `file.ecg-digital-twin.<filename>`.

## Required entries (every snapshot)

1. Exactly one `project.<project>` root entry. Value should describe scope, status, and key constraints.
2. Exactly one `session.<YYYY-MM-DD>` entry dated to the day of generation.
3. AT MINIMUM these submain category buckets when leaves exist below them: `arch.<project>`, `decision.<project>`, etc. — one 2-segment entry per prefix that has children. Value can be small: `{ "type": "<prefix>", "project": "<project>", "role": "submain" }`.

For agent-orientation completeness, prefer to also include these canonical nodes (skip if content is unknown — never fabricate):
- `arch.<project>.overview` — what the system is, tech stack, entry points
- `setup.<project>.run` — how to start it locally, env vars
- Backend projects also need: `api.<project>.<surface>`, `data.<project>.schema`
- Frontend projects also need: `arch.<project>.component-tree`, `data.<project>.client-cache`
- Library/CLI also needs: `api.<project>.public`

## Hierarchy edges (REQUIRED — this is the most important rule)

The graph uses 3 levels: `project → submain (2-segment) → leaf (3+ segment)`.

Wire it with `child_of` edges:
- Every leaf (3+ segment, non-session) → its submain via `child_of`
- Every submain (2-segment, non-project, non-session) → its `project.<project>` root via `child_of`
- `project.*` roots have NO outgoing `child_of`
- Sessions and session-sections use `documents` (NOT `child_of`):
  - `session.<date>` → `project.<project>` via `documents`
  - `session-section.<date>.<part>` → `session.<date>` via `documents`

Beyond hierarchy, every leaf should have 1-3 semantic edges to other related entries (e.g. `supports`, `depends_on`, `mentions`).

## All allowed relation types

`related_to`, `depends_on`, `supports`, `contradicts`, `mentions`, `derived_from`, `next_step`, `implements`, `documents`, `blocks`, `child_of`

Specific edge requirements:
- Hierarchy: use `child_of` (leaf → submain, submain → project)
- Session documentation: use `documents` (session → project, section → session) — never `related_to`
- Causal/architectural support: use `supports` or `depends_on`
- Free association: use `related_to` only when nothing more specific fits

No self edges. No duplicate `(from, relation, to)` triples. Both endpoints MUST exist in `entries`.

Edge weight is a number from 0 to 1 reflecting tightness of the link. 0.9 for tight causal links, 0.3-0.5 for loose topical links. Do not default everything to 0.5.

## Field rules

- `revision` is a positive integer. Set to 1 for all new entries. Do not omit it.
- `value` may be string, number, boolean, object, array, or null. Within one snapshot, keep similar entries (e.g. all `feature.*`) shaped consistently. If an entry records a code change, include a `filesChanged` array in the value object listing every file substantively modified:
    `{ "summary": "...", "filesChanged": ["src/foo.js", "test/foo.test.js"], "rationale": "..." }`
  Omit `filesChanged` for non-code entries.
- `summary` is a non-empty single sentence, plain ASCII, ≤120 characters. It must stand alone without reading `value`. For submain entries, use the rollup format `[N children] subkey: snippet | ...` (the server auto-cascades this on writes, but include it for static snapshots).
- `tags` is an array of lowercase, hyphen-separated tokens. Always include the prefix (e.g. `decision`) and the project name (e.g. `sharedmemory`) so the dashboard identity panel groups correctly. Add 1-3 topical tags beyond that. Do not repeat tokens that already appear in the key.
- `importance` is 0-10, applied conservatively:
    9-10 = core project identity / hard constraints / canonical architecture (cap at ~3 per snapshot — the project root, arch.overview, key invariants)
    7-8  = key architectural decisions, critical setup, reusable insights, canonical api/data nodes
    5-6  = useful context, current tasks
    3-4  = minor facts, references, individual file nodes
    0-2  = ephemeral — avoid unless temporary
  The histogram should look like a pyramid — do not give every entry 8+.

  Zombie definition (server will flag these): importance=0 OR empty tags OR empty summary. Avoid creating zombies.

- `expiresAt` is null unless the memory is genuinely time-bounded; otherwise a future Unix ms timestamp.
- `updatedAt` MUST be the actual Unix millisecond timestamp at the moment you generate the snapshot. Do NOT reuse one hardcoded value across all entries — vary by a few seconds across entries to reflect order of writing.
- `updatedBy` MUST be your own model identifier on every entry AND every edge you create. Do not copy another model's name onto entries or edges you authored.
- `reason` on edges MUST be a full sentence explaining why the two entries are connected — not a label like "related" or "context". Example: "The TTL constraint documented here was discovered while implementing the expiry feature in this session."

## Split vs merge rule

- One entry per atomic decision or insight.
- If you find yourself writing "and" more than twice in a summary, split the entry into two.
- If two candidates would share the same key, merge them into one entry — do not create `insight.X` and `insight.X-detail`.

## Merging into an existing snapshot

If the user provides an existing JSON snapshot file alongside this prompt, do NOT regenerate the whole graph. Instead:
- Treat the provided file as the source of truth for what already exists.
- Add ONLY new entries that are not already present (compare by `key`).
- For every new entry, add at least one `child_of` edge to its submain parent (creating the submain if missing, wired with `child_of` to the project root), plus 1-2 semantic edges to closely related existing keys. Set `updatedBy` to your name on all new edges.
- If a relevant session node already exists, link any new leaves derived from that session via `derived_from`.
- Do NOT rewrite, delete, or duplicate existing entries.
- You may update an existing entry ONLY if its `summary` is wrong, ambiguous, or outdated. In that case: keep the same `key` and `value`, edit only `summary` (and tags if needed), increment `revision` by 1, set `updatedAt` to now, set `updatedBy` to your name, and append a tag of the form `updated-by-<your-name>` so the change is attributable. Never escalate `importance`.
- Output the FULL merged JSON (existing + your additions) so it can be re-imported in one shot.

## Quality rules

- Prefer fewer high-value memories over many low-value notes.
- Do not duplicate information across entries; cross-link instead.
- Each `summary` should stand on its own without reading `value`.
- If two entries say nearly the same thing, merge them rather than linking them.
- Cover the universal minimum (project root, arch overview, setup run, plus per-project-type extras) before adding leaves.

Now convert the following conversation/project notes into that JSON snapshot:

<PASTE CONTEXT HERE>
```

After receiving the JSON, save it as a `.json` file and upload it in the dashboard using `Import JSON`. A minimal valid example is available at `examples/external-memory-snapshot.example.json`.

## Related policy documents in this repo

- `ref/key-naming-policy.md` — canonical rulebook for keys, prefixes, project names, hierarchy.
- `ref/memory-graph-faults.md` — what every project type needs in the graph for cold-onboarding agents.
- `CLAUDE.md` — project-level instructions including the `child_of` hierarchy design and auto-cascade behavior.
