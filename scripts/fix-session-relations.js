// Convert session/session-section edges from `related_to` to `documents` per naming policy.
// Policy rule: session.* → project.* and session-section.* → session.* must use `documents`.
//
// Usage:
//   node scripts/fix-session-relations.js [--db path/to/memory.db] [--apply]
//
// Default is dry-run. Pass --apply to write changes.

'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const args = process.argv.slice(2);
const dbIndex = args.indexOf('--db');
const dbPath = dbIndex !== -1 ? args[dbIndex + 1] : (process.env.MEMORY_FILE || 'data/memory.db');
const apply = args.includes('--apply');

if (!dbPath) {
    console.error('No database path. Set MEMORY_FILE or pass --db <path>.');
    process.exit(1);
}

const db = new DatabaseSync(path.resolve(dbPath));

const candidates = db.prepare(`
    SELECT edge_id, from_key, to_key, relation FROM edges
    WHERE relation = 'related_to'
    AND (
        (from_key LIKE 'session.%' AND to_key LIKE 'project.%')
        OR (from_key LIKE 'session-section.%' AND to_key LIKE 'session.%')
    )
`).all();

console.log(`Mode: ${apply ? 'LIVE (--apply)' : 'DRY RUN'}`);
console.log(`DB:   ${path.resolve(dbPath)}`);
console.log(`Candidates: ${candidates.length}\n`);

const updateEdge = db.prepare(
    `UPDATE edges SET relation = 'documents', edge_id = ?, updated_at = ?, updated_by = 'system:policy-fix' WHERE edge_id = ?`
);

let updated = 0;
let collisions = 0;

for (const e of candidates) {
    const newEdgeId = `${e.from_key}documents${e.to_key}`;
    // Check collision: target edge_id already exists
    const existing = db.prepare('SELECT 1 FROM edges WHERE edge_id = ?').get(newEdgeId);
    if (existing && newEdgeId !== e.edge_id) {
        console.log(`  COLLISION  ${e.from_key} → ${e.to_key} (target edge_id exists, skipping)`);
        collisions++;
        continue;
    }
    if (apply) {
        updateEdge.run(newEdgeId, Date.now(), e.edge_id);
        console.log(`  update  ${e.from_key} --documents--> ${e.to_key}`);
    } else {
        console.log(`  [dry]   ${e.from_key} --related_to--> ${e.to_key}  ⇒  --documents-->`);
    }
    updated++;
}

console.log(`\nSummary:`);
console.log(`  Updated:    ${updated}`);
console.log(`  Collisions: ${collisions}`);
if (!apply) console.log('\n(Dry run — pass --apply to write changes)');
