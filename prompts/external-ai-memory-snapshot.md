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
      "reason": "why these memories are connected",
      "weight": 0.5,
      "updatedAt": 1710000000000,
      "updatedBy": "<your-name>"
    }
  ]
}

Replace `<your-name>` everywhere with the actual identifier of the AI generating the snapshot (e.g. "gpt-5", "claude-opus-4-7", "gemini-2.5-pro"). It must be a non-empty ASCII string with no spaces.

Key rules:
- Use stable dot-separated keys: "project.<name>.overview", "decision.<topic>", "arch.<area>", "feature.<name>", "data.<area>", "api.<area>", "task.<name>", "session.<YYYY-MM-DD>".
- The first dot-separated segment of every key is treated as the entry's namespace. The dashboard derives node color, cluster placement, and grouping hulls from that prefix, so use a small, consistent set of top-level namespaces across the snapshot (e.g. `project`, `decision`, `arch`, `feature`, `data`, `api`, `task`, `session`, `insight`, `setup`, `reference`). Avoid one-off prefixes that would create singleton clusters.
- Every snapshot MUST include exactly one `project.<name>.overview` entry that acts as the root node, and one `session.<YYYY-MM-DD>` entry dated to the day the snapshot is generated.
- Every other entry MUST have at least one edge pointing to the project root (`related_to` or `depends_on`) and at least one edge from the session entry to it (`derived_from`). Aim for 2-4 total relations per entry.
- Edge relation must be one of: related_to, depends_on, supports, contradicts, mentions, derived_from, next_step.
- No self edges. No duplicate (from, relation, to) triples. Both endpoints must exist in `entries`.
- Edge weight is a number from 0 to 1; choose a value that reflects how tight the link is, do not default everything to 0.5.

Field rules:
- `value` may be string, number, boolean, object, array, or null. Within one snapshot, keep similar entries (e.g. all `feature.*`) shaped consistently.
- `summary` is a non-empty single sentence, plain ASCII.
- `tags` is an array of lowercase, hyphen-separated tokens and MUST contain at least 2 entries (target 2-5). Empty `tags` is a defect — the server's `memory_audit` flags such entries as zombies. Choose tags that describe the *topic* of the entry (e.g. `auth`, `cache`, `migration`, `oncall`), not the type — type is already encoded in the key prefix. Do not repeat tokens that already appear in the key (e.g. omit `"project"` and `"<name>"` when the key starts with `project.<name>.`). If you genuinely cannot think of two tags, the entry is probably too vague to keep — drop it.
- `importance` is 0-10 with this scale, applied conservatively:
    9-10 = core project identity / hard constraints (cap at ~2 per snapshot)
    7-8  = key architectural decisions, critical setup
    5-6  = useful context, current tasks
    3-4  = minor facts, references
    0-2  = ephemeral
  Do not give every entry 8+. The histogram should look like a pyramid.
- `expiresAt` is null unless the memory is genuinely time-bounded; otherwise a future Unix ms timestamp.
- `updatedAt` MUST be the actual Unix millisecond timestamp at the moment you generate the snapshot. Do NOT reuse one hardcoded value across all entries — vary by a few seconds across entries to reflect order of writing.
- `updatedBy` MUST be your own model identifier (the value you substituted for `<your-name>`) on every entry and edge you create or modify, unless the user explicitly tells you a different source name. Do not copy another model's name onto entries you authored.

Merging into an existing snapshot:
If the user provides an existing JSON snapshot file alongside this prompt, do NOT regenerate the whole graph. Instead:
- Treat the provided file as the source of truth for what already exists.
- Add ONLY new entries that are not already present (compare by `key`).
- For every new entry, add at least one edge connecting it to the existing graph (typically to `project.<name>.overview`, the existing `session.<YYYY-MM-DD>`, or a closely related existing key) plus any edges between your new entries.
- Do NOT rewrite, delete, or duplicate existing entries.
- You may update an existing entry ONLY if its `summary` is wrong, ambiguous, or outdated. In that case: keep the same `key` and `value`, edit only `summary` (and tags if needed), set `updatedAt` to now, set `updatedBy` to your name, and append a tag of the form `updated-by-<your-name>` so the change is attributable. Never escalate `importance`.
- Output the FULL merged JSON (existing + your additions) so it can be re-imported in one shot.

Hygiene rules (the server reports violations):
- An entry is flagged as a "zombie" by `memory_audit` if ANY of these are true: `importance` is 0, `tags` is empty, or `summary` is empty/missing. Such entries surface as a red "! N" badge in the dashboard. Treat zombies as a defect — every entry you produce should have a non-empty summary, at least one tag, and importance ≥ 1. Use `importance: 1` or `2` for genuinely ephemeral notes rather than `0`.
- An entry with no incoming or outgoing edges is flagged as an "orphan". The "every entry must connect to project root + session" rule above prevents this — do not skip it.
- Two entries with the same first 60 characters of summary (case-insensitive) are flagged as a "duplicate" group. Write distinct summaries even when entries are related.

Quality rules:
- Prefer fewer high-value memories over many low-value notes.
- Do not duplicate information across entries; cross-link instead.
- Each `summary` should stand on its own without reading the `value`.

Now convert the following conversation/project notes into that JSON snapshot:

<PASTE CONTEXT HERE>
```

After receiving the JSON, save it as a `.json` file and upload it in the dashboard using `Import JSON`. A minimal valid example is available at `examples/external-memory-snapshot.example.json`.

After import, open the dashboard and:
- Confirm the audit badge in the toolbar is hidden or near zero — non-zero means the snapshot tripped a zombie/orphan/duplicate rule, click the badge or run `memory_audit` over the WebSocket / MCP tool to inspect.
- Press `Ctrl+K` (`Cmd+K` on Mac) to fuzzy-search any imported entry by key or summary; Enter focuses and frames it.
