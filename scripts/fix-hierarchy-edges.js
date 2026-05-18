// Fix incorrect child_of edges created by migrate-hierarchy.js.
// That script wired every node to project.sharedmemory regardless of actual project.
// This script deletes those edges and re-wires each node to its correct project root.
//
// Usage:
//   node scripts/fix-hierarchy-edges.js [--db path/to/memory.db] [--apply]
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

const allKeys = db.prepare('SELECT key FROM entries WHERE expires_at IS NULL OR expires_at > ?')
    .all(Date.now())
    .map(r => r.key);

const projectKeys = new Set(allKeys.filter(k => k.startsWith('project.')));

// Count existing broken edges
const brokenEdges = db.prepare(
    "SELECT COUNT(*) AS n FROM edges WHERE relation = 'child_of' AND updated_by IN ('system:migrate', 'system:fix')"
).get().n;

console.log(`Mode: ${apply ? 'LIVE (--apply)' : 'DRY RUN'}`);
console.log(`Total entries: ${allKeys.length}`);
console.log(`Project roots found: ${[...projectKeys].join(', ')}`);
console.log(`Broken child_of edges to delete: ${brokenEdges}\n`);

let deleted = 0;
let created = 0;
let warned = 0;

// Step 1: delete broken edges
if (apply) {
    const result = db.prepare(
        "DELETE FROM edges WHERE relation = 'child_of' AND updated_by IN ('system:migrate', 'system:fix')"
    ).run();
    deleted = result.changes;
    console.log(`Deleted ${deleted} broken child_of edges.\n`);
} else {
    console.log(`[dry] Would delete ${brokenEdges} broken child_of edges.\n`);
    deleted = brokenEdges;
}

// Step 2: re-wire each non-root, non-session node to its correct project
const insertEdge = db.prepare(
    'INSERT OR IGNORE INTO edges (edge_id, from_key, to_key, relation, reason, weight, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);

const t = Date.now();

for (const key of allKeys) {
    // Skip project roots — they have no parent
    if (key.startsWith('project.')) continue;

    // Skip session/session-section — they link to projects via 'documents', not child_of
    if (key.startsWith('session.') || key.startsWith('session-section.')) continue;

    const parts = key.split('.');
    if (parts.length < 2) continue;

    const projectKey = 'project.' + parts[1];

    if (!projectKeys.has(projectKey)) {
        console.warn(`  WARN: ${key} → no project root found for "${projectKey}"`);
        warned++;
        continue;
    }

    const edgeId = `${key}child_of${projectKey}`;

    if (apply) {
        insertEdge.run(edgeId, key, projectKey, 'child_of', 'fix-hierarchy', 1, t, 'system:fix');
        console.log(`  create  ${key} --child_of--> ${projectKey}`);
    } else {
        console.log(`  [dry]   ${key} --child_of--> ${projectKey}`);
    }
    created++;
}

console.log(`\nSummary:`);
console.log(`  Deleted (broken):  ${deleted}`);
console.log(`  Created (correct): ${created}`);
console.log(`  Warnings:          ${warned}`);
if (!apply) console.log('\n(Dry run — pass --apply to write changes)');
