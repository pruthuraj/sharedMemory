Plan: Importance Cutoff Rule + Project Stats Caching + Dashboard Display

Context

Current state of child_of hierarchy is clean (project → submain → leaf), but project root nodes still carry direct semantic edges to
low-importance leaves. Example: task.sharedmemory.zombie-cleanup (importance=3) has a direct supports edge to project.hextts. These edges clutter
the project node's neighborhood and let minor work (importance 3-5 cleanup tasks, individual file mentions, etc.) visually dominate the project
root the same way as core architecture nodes do.

Counts of direct semantic edges (any relation except child_of and documents) between project roots and 3+ segment leaves in the live DB:

┌──────────────────────────┬────────────────┬───────────────────┬───────────────────────┐
│ Project │ Avg (children) │ Direct leaf edges │ Below-avg with direct │
├──────────────────────────┼────────────────┼───────────────────┼───────────────────────┤
│ project.sharedmemory │ 6.55 │ 59 │ 20 │
├──────────────────────────┼────────────────┼───────────────────┼───────────────────────┤
│ project.hextts │ 6.88 │ 24 │ 14 │
├──────────────────────────┼────────────────┼───────────────────┼───────────────────────┤
│ project.webreader │ 8.24 │ 15 │ 11 │
├──────────────────────────┼────────────────┼───────────────────┼───────────────────────┤
│ project.portfolio │ 7.50 │ 7 │ 5 │
├──────────────────────────┼────────────────┼───────────────────┼───────────────────────┤
│ project.cross-project │ 7.73 │ 5 │ 3 │
├──────────────────────────┼────────────────┼───────────────────┼───────────────────────┤
│ project.ecg-digital-twin │ 5.86 │ 13 │ 0 │
├──────────────────────────┼────────────────┼───────────────────┼───────────────────────┤
│ total │ — │ 123 │ 53 │
└──────────────────────────┴────────────────┴───────────────────┴───────────────────────┘

User-stated rule: a node whose importance is below its project's average importance should not have a direct edge to the project root. A minor
fix or file-mention shouldn't visually weight the project's neighborhood the same as a top decision.

Make the threshold readable without recomputation by caching count, sum, avgImportance, threshold, and lastComputedAt on the project node's
value_json. Dashboard project detail panel displays the cached stats.

---

Phase 1 — Apply Cutoff + Cache Stats (script)

New file: scripts/apply-importance-cutoff.js

Behavior:

1.  For each project._ entry:
    a. Collect descendants by namespace: every entry whose 2nd key segment matches the project name, excluding the project node itself and excluding
    session._ / session-section.\* (those use documents and are meta, not project content).
    b. Compute count, sum, avgImportance (mean), threshold = avgImportance over descendants.
    c. Identify direct edges to delete: any edge where (from = project OR to = project) AND the other endpoint is a leaf (3+ segment, non-session,
    project's namespace) AND entries[leaf].importance < threshold AND relation NOT IN ('child_of', 'documents').

- Submain nodes (2-segment) are exempt (they're the structural backbone — keep child_of always).
- child_of and documents are exempt (hierarchy + meta).
  d. Delete the identified edges.
  e. Update project's value_json by merging in:
  {
  "stats": {
  "count": <int>,
  "sum": <int>,
  "avgImportance": <float>,
  "threshold": <float>,
  "removedDirectEdges": <int>,
  "lastComputedAt": <ms epoch>
  }
  }
  Preserve existing value_json fields (scope, type, status, mergedFrom). Bump revision by 1.

2.  Idempotent. Dry-run default. --apply writes.

Reused logic: none (this is new shape). Stat math matches the in-memory audit script from ref/memory-graph-faults.md Appendix.

Expected outcome on live DB: ~53 direct semantic edges removed; 6 project nodes get stats block in their value_json.

---

Phase 2 — Dashboard Display

Modify: public/js/dashboard/graph-detail.js

In buildDetailBodyHtml(key, entry, recencyColor), add a stats block when the entry is a project node and entry.value.stats is present.

Insert after hierarchyHtml, before dp-summary:

const stats = (entry.value && entry.value.stats) || null;
const statsHtml = stats ? `

 <div class="dp-project-stats">
   <div class="dp-stats-title">Project descendants</div>
   <div class="dp-stats-grid">
     <span class="dp-stats-label">Count</span><span class="dp-stats-value">${stats.count}</span>
     <span class="dp-stats-label">Avg importance</span><span class="dp-stats-value">${Number(stats.avgImportance).toFixed(2)}</span>
     <span class="dp-stats-label">Sum</span><span class="dp-stats-value">${stats.sum}</span>
     <span class="dp-stats-label">Threshold</span><span class="dp-stats-value">${Number(stats.threshold).toFixed(2)}</span>
   </div>
   <div class="dp-stats-note">Leaves below threshold have no direct edges to this project root.</div>
 </div>` : '';

Render ${statsHtml} between the meta row and summary.

Modify: public/css/styles.css

Add minimal styles for the new classes:

.dp-project-stats {
margin: 8px 0;
padding: 8px 10px;
background: var(--surface-bg-2);
border-left: 3px solid var(--accent-2);
border-radius: 4px;
}
.dp-stats-title { font-size: 10px; text-transform: uppercase; color: var(--text-faint); margin-bottom: 4px; }
.dp-stats-grid { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; font-size: 12px; }
.dp-stats-label { color: var(--text-faint); }
.dp-stats-value { color: var(--accent-2); font-weight: 600; }
.dp-stats-note { font-size: 10px; color: var(--text-faint); margin-top: 4px; font-style: italic; }

No JS wiring changes needed — entry.value already arrives parsed in realtime.js from server.

---

Phase 3 — Policy Documentation

Modify: ref/key-naming-policy.md

Add new section "Importance cutoff rule":

▎ A leaf node (3+ segment, non-session) must NOT have a direct edge (any relation except child_of and documents) to its project root if its
▎ importance is below the project's average descendant importance. The project root's value_json.stats.threshold caches this average. Submain
▎ nodes (2-segment) are always exempt — they are the structural backbone.

Modify: ref/memory-graph-faults.md

Add to Part 4 (How to Stay Clean):

▎ 6. After bulk writes: re-run scripts/apply-importance-cutoff.js --apply to refresh project stats and prune any newly-introduced below-threshold
▎ direct edges.

---

Files to Create / Modify

┌─────────────────────────────────────┬─────────────────────────────────────┐
│ Path │ Action │
├─────────────────────────────────────┼─────────────────────────────────────┤
│ scripts/apply-importance-cutoff.js │ NEW │
├─────────────────────────────────────┼─────────────────────────────────────┤
│ public/js/dashboard/graph-detail.js │ EDIT — insert statsHtml block │
├─────────────────────────────────────┼─────────────────────────────────────┤
│ public/css/styles.css │ EDIT — add .dp-project-stats styles │
├─────────────────────────────────────┼─────────────────────────────────────┤
│ ref/key-naming-policy.md │ EDIT — add cutoff rule section │
├─────────────────────────────────────┼─────────────────────────────────────┤
│ ref/memory-graph-faults.md │ EDIT — add re-run reminder │
└─────────────────────────────────────┴─────────────────────────────────────┘

No src/ changes. The rule is script-enforced; server-side memory_relate guard could be a future task but is out of scope.

---

Verification

1.  Phase 1 dry-run, both DBs:
    node scripts/apply-importance-cutoff.js --db data/memory.db
    node scripts/apply-importance-cutoff.js --db C:\sharedMemory\data\memory.db
1.  Expected output: per-project stats + ~53 edges to delete on live DB, lower count on dev (smaller graph).
1.  Apply Phase 1: --apply on both DBs.
1.  Verify stats cached:
    node -e "const {DatabaseSync}=require('node:sqlite');const db=new
    DatabaseSync('C:/sharedMemory/data/memory.db');console.log(JSON.parse(db.prepare(\"SELECT value_json FROM entries WHERE
    key='project.sharedmemory'\").get().value_json).stats)"
1.  Expected: { count, sum, avgImportance, threshold, removedDirectEdges, lastComputedAt }.
1.  Verify edges removed: re-run the count query from Context. Expect below-avg-with-direct = 0 for every project; total direct-leaf-edges reduced
    by ~53.
1.  Dashboard smoke:

- npm start, open http://localhost:3000.
- Click project.sharedmemory. Detail panel shows "Project descendants" block with count / avg / sum / threshold.
- Click on a low-importance leaf (e.g. file.sharedmemory.test-server-test-js, imp=4). Confirm its detail panel still shows its child_of parent
  (file.sharedmemory submain) but it no longer has direct edges to project.sharedmemory in the rendered graph.

6.  Re-audit policy compliance (ref/memory-graph-faults.md Appendix script): expect 0 new violations.
7.  Test suite: npm test — server tests unaffected (no source-code changes).

---

Out of Scope

- Server-side enforcement on memory_relate (would block direct edges from low-imp leaves to project at write time). Future enhancement.
- Recomputing threshold on every memory_set (auto-cascade). Currently the threshold is refreshed only when the script is re-run.
- Changing documents or child_of edges — these are structural/meta and always preserved.
  ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
