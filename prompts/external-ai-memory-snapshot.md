# External AI Memory Snapshot Prompt

Use this prompt with an AI that cannot connect to the sharedMemory MCP server. It asks the AI to return a strict JSON snapshot file that can be uploaded through the dashboard Import JSON workflow.

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
      "relation": "related_to",
      "reason": "why these memories are connected — one full sentence, not a label",
      "weight": 0.5,
      "updatedAt": 1710000000000,
      "updatedBy": "<your-name>"
    }
  ]
}

Replace `<your-name>` everywhere with the actual identifier of the AI generating the snapshot (e.g. "gpt-5", "claude-opus-4-7", "gemini-2.5-pro"). It must be a non-empty ASCII string with no spaces.

Key rules:
- Use stable dot-separated keys from this taxonomy:
    project.<name>.overview   — project identity, scope, status
    decision.<topic>          — choices made and why
    insight.<topic>           — lessons, gotchas, non-obvious truths
    fact.<topic>              — stable technical facts
    arch.<area>               — architecture descriptions
    feature.<name>            — feature-level detail
    data.<area>               — data models, schemas
    api.<area>                — API contracts, endpoints
    task.<name>               — action items, todos
    blocker.<topic>           — known risks, blockers
    setup.<thing>             — configs, install steps
    reference.<system>        — external links, dashboards, ticket IDs
    preference.<topic>        — user/team preferences
    session.<YYYY-MM-DD>      — per-session summary
- Keys must be lowercase, dot-separated, hyphens allowed within segments. 2-3 segments max.
- Every snapshot MUST include exactly one `project.<name>.overview` entry that acts as the root node, and one `session.<YYYY-MM-DD>` entry dated to the day the snapshot is generated.
- Every other entry MUST have at least one edge pointing to the project root (`related_to` or `depends_on`) and at least one edge from the session entry to it (`derived_from`). Aim for 2-4 total relations per entry.
- Edge relation must be one of: related_to, depends_on, supports, contradicts, mentions, derived_from, next_step.
- No self edges. No duplicate (from, relation, to) triples. Both endpoints must exist in `entries`.
- Edge weight is a number from 0 to 1; choose a value that reflects how tight the link is. Do not default everything to 0.5 — use 0.9 for tight causal links, 0.3-0.5 for loose topical links.

Field rules:
- `revision` is a positive integer. Set to 1 for all new entries. Do not omit it.
- `value` may be string, number, boolean, object, array, or null. Within one snapshot, keep similar entries (e.g. all `feature.*`) shaped consistently. If an entry records a code change (fix, refactor, implementation), include a `filesChanged` array in the value object listing every file that was substantively modified:
    { "summary": "...", "filesChanged": ["src/foo.js", "test/foo.test.js"], "rationale": "..." }
  Omit `filesChanged` for non-code entries.
- `summary` is a non-empty single sentence, plain ASCII. It must stand alone without reading `value`.
- `tags` is an array of lowercase, hyphen-separated tokens. Do not repeat tokens that already appear in the key. Use [] if nothing useful applies.
- `importance` is 0-10, applied conservatively:
    9-10 = core project identity / hard constraints (cap at ~2 per snapshot)
    7-8  = key architectural decisions, critical setup, reusable insights
    5-6  = useful context, current tasks
    3-4  = minor facts, references
    0-2  = ephemeral
  Tiebreaker within a range: pick the higher end if the entry will constrain future decisions or is needed to avoid repeating a mistake. Pick the lower end if it is context-only and missing it causes no harm. The histogram should look like a pyramid — do not give every entry 8+.
- `expiresAt` is null unless the memory is genuinely time-bounded; otherwise a future Unix ms timestamp.
- `updatedAt` MUST be the actual Unix millisecond timestamp at the moment you generate the snapshot. Do NOT reuse one hardcoded value across all entries — vary by a few seconds across entries to reflect order of writing.
- `updatedBy` MUST be your own model identifier on every entry AND every edge you create. Do not copy another model's name onto entries or edges you authored.
- `reason` on edges MUST be a full sentence explaining why the two entries are connected — not a label like "related" or "context". Example: "The TTL constraint documented here was discovered while implementing the expiry feature in this session."

Split vs merge rule:
- One entry per atomic decision or insight.
- If you find yourself writing "and" more than twice in a summary, split the entry into two.
- If two candidates would share the same key, merge them into one entry — do not create `insight.X` and `insight.X-detail`.

Merging into an existing snapshot:
If the user provides an existing JSON snapshot file alongside this prompt, do NOT regenerate the whole graph. Instead:
- Treat the provided file as the source of truth for what already exists.
- Add ONLY new entries that are not already present (compare by `key`).
- For every new entry, add at least one edge connecting it to the existing graph (typically to `project.<name>.overview`, the existing `session.<YYYY-MM-DD>`, or a closely related existing key) plus any edges between your new entries. Set `updatedBy` to your name on all new edges.
- Do NOT rewrite, delete, or duplicate existing entries.
- You may update an existing entry ONLY if its `summary` is wrong, ambiguous, or outdated. In that case: keep the same `key` and `value`, edit only `summary` (and tags if needed), increment `revision` by 1, set `updatedAt` to now, set `updatedBy` to your name, and append a tag of the form `updated-by-<your-name>` so the change is attributable. Never escalate `importance`.
- Output the FULL merged JSON (existing + your additions) so it can be re-imported in one shot.

Quality rules:
- Prefer fewer high-value memories over many low-value notes.
- Do not duplicate information across entries; cross-link instead.
- Each `summary` should stand on its own without reading `value`.
- If two entries say nearly the same thing, merge them rather than linking them.

Now convert the following conversation/project notes into that JSON snapshot:

<PASTE CONTEXT HERE>
```

After receiving the JSON, save it as a `.json` file and upload it in the dashboard using `Import JSON`. A minimal valid example is available at `examples/external-memory-snapshot.example.json`.
