# External AI Memory Snapshot Prompt

Use this prompt with an AI that cannot connect to the sharedMemory MCP server. It asks the AI to return a strict JSON snapshot file that can be uploaded through the dashboard Import JSON workflow.

```text
You are exporting useful project memory for a shared memory graph database.

Return only valid JSON. Do not wrap it in markdown. Do not include explanations before or after the JSON.

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
      "updatedBy": "external-ai"
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
      "updatedBy": "external-ai"
    }
  ]
}

Rules:
- Use stable dot-separated keys, for example "project.overview", "decision.database", "task.next-step".
- Every entry must include value, summary, tags, importance, expiresAt, updatedAt, and updatedBy.
- value can be a string, number, boolean, object, array, or null.
- summary must be a non-empty human-readable string.
- tags must be an array of non-empty strings. Use [] if there are no useful tags.
- importance must be a number from 0 to 10.
- expiresAt must be null unless the memory should expire; if expiring, use a future Unix millisecond timestamp.
- updatedAt must be a Unix millisecond timestamp.
- updatedBy should be "external-ai" unless you know a better source name.
- Edge relation must be one of:
  related_to, depends_on, supports, contradicts, mentions, derived_from, next_step
- Edge from and to must both exist in entries.
- No self edges: from and to cannot be the same key.
- Edge weight must be a number from 0 to 1.
- Edge reason can be an empty string, but a useful explanation is better.
- Do not create duplicate edges with the same from + relation + to.
- Keep the snapshot compact. Prefer fewer high-value memories over many low-value notes.

Now convert the following conversation/project notes into that JSON snapshot:

<PASTE CONTEXT HERE>
```

After receiving the JSON, save it as a `.json` file and upload it in the dashboard using `Import JSON`. A minimal valid example is available at `examples/external-memory-snapshot.example.json`.
