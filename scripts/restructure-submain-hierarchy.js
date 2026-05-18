// Phase 1 of hierarchy restructure: create 2-segment submain nodes (e.g. arch.sharedmemory,
// decision.sharedmemory) and re-point each leaf's child_of edge from project root to its
// submain parent. Wire submain → project root.
//
// Effect: memory_map(project.X, depth=1) returns ~10 submain buckets instead of all leaves.
// Drill via memory_map(submain.X, depth=1) for the leaves under that bucket.
//
// Idempotent. Dry-run default. Pass --apply to write.
//
// Usage:
//   node scripts/restructure-submain-hierarchy.js [--db path] [--apply]

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

const KNOWN_LEAF_PREFIXES = new Set([
    'arch', 'api', 'data', 'decision', 'feature', 'file', 'insight',
    'preference', 'reference', 'setup', 'task', 'blocker', 'agent', 'evidence',
]);

const t = Date.now();

// ── Load state ────────────────────────────────────────────────────────────────
const entries = db.prepare('SELECT key, importance, summary FROM entries').all();
const keys = new Set(entries.map((e) => e.key));
const projectKeys = new Set(entries.filter((e) => e.key.startsWith('project.')).map((e) => e.key));

// ── Identify leaves and submain groups ────────────────────────────────────────
// leaf = 3+ segment key with known leaf prefix and non-project/session second seg
const leaves = entries.filter((e) => {
    const parts = e.key.split('.');
    if (parts.length < 3) return false;
    if (e.key.startsWith('session.') || e.key.startsWith('session-section.')) return false;
    if (e.key.startsWith('project.')) return false;
    return KNOWN_LEAF_PREFIXES.has(parts[0]);
});

// Group by (prefix, project)
const groups = new Map(); // submainKey → { project, prefix, children: [entry] }
for (const leaf of leaves) {
    const parts = leaf.key.split('.');
    const prefix = parts[0];
    const project = parts[1];
    const submainKey = `${prefix}.${project}`;
    if (!projectKeys.has(`project.${project}`)) continue; // no project root, skip
    if (!groups.has(submainKey)) {
        groups.set(submainKey, { prefix, project, children: [] });
    }
    groups.get(submainKey).children.push(leaf);
}

console.log(`Mode: ${apply ? 'LIVE (--apply)' : 'DRY RUN'}`);
console.log(`DB:   ${path.resolve(dbPath)}`);
console.log(`Total entries: ${entries.length}`);
console.log(`Project roots: ${projectKeys.size}`);
console.log(`Leaves: ${leaves.length}`);
console.log(`Submain groups: ${groups.size}\n`);

// ── Statements ────────────────────────────────────────────────────────────────
const upsertEntry = db.prepare(
    'INSERT OR REPLACE INTO entries (key, value_json, summary, importance, revision, expires_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)'
);
const getEntry = db.prepare('SELECT key, revision FROM entries WHERE key = ?');
const insertTag = db.prepare('INSERT OR IGNORE INTO tags (key, tag) VALUES (?, ?)');
const insertEdge = db.prepare(
    'INSERT OR IGNORE INTO edges (edge_id, from_key, to_key, relation, reason, weight, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);
const deleteEdgeExact = db.prepare(
    "DELETE FROM edges WHERE from_key = ? AND to_key = ? AND relation = 'child_of'"
);

function rollupSummary(children) {
    // Match src/memory-store.js computeRollupSummary format
    const top = children.slice().sort((a, b) => b.importance - a.importance).slice(0, 5);
    const parts = top.map((r) => {
        const subkey = r.key.split('.').pop();
        const snippet = r.summary ? r.summary.slice(0, 60) : '';
        return `${subkey}: ${snippet}`;
    });
    return `[${children.length} children] ${parts.join(' | ')}`;
}

let submainCreated = 0;
let submainExists = 0;
let leafEdgesDeleted = 0;
let leafEdgesCreated = 0;
let submainEdgesCreated = 0;

for (const [submainKey, { prefix, project, children }] of groups) {
    const projectKey = `project.${project}`;
    const existing = getEntry.get(submainKey);

    // ── 1. Create or update submain entry ─────────────────────────────────────
    const summary = rollupSummary(children);
    const maxChildImportance = children.reduce((m, c) => Math.max(m, c.importance), 0);
    const importance = Math.max(8, maxChildImportance);
    const valueJson = JSON.stringify({
        type: prefix,
        project,
        role: 'submain',
        childCount: children.length,
    });

    if (!existing) {
        submainCreated++;
        if (apply) {
            upsertEntry.run(submainKey, valueJson, summary, importance, 1, t, 'system:restructure');
            insertTag.run(submainKey, prefix);
            insertTag.run(submainKey, project);
            insertTag.run(submainKey, 'submain');
        }
        console.log(`  ${apply ? 'create' : '[dry] '}  submain  ${submainKey}  (${children.length} children, imp=${importance})`);
    } else {
        submainExists++;
        console.log(`  exists           submain  ${submainKey}  (${children.length} children)`);
    }

    // ── 2. Wire submain → project (child_of) ──────────────────────────────────
    const submainEdgeId = `${submainKey}child_of${projectKey}`;
    if (apply) {
        const r = insertEdge.run(submainEdgeId, submainKey, projectKey, 'child_of', 'restructure', 1, t, 'system:restructure');
        if (r.changes > 0) submainEdgesCreated++;
    } else {
        submainEdgesCreated++;
    }

    // ── 3. Re-point each leaf: delete leaf→project, create leaf→submain ──────
    for (const leaf of children) {
        if (apply) {
            const d = deleteEdgeExact.run(leaf.key, projectKey);
            leafEdgesDeleted += d.changes;
            const newEdgeId = `${leaf.key}child_of${submainKey}`;
            const c = insertEdge.run(newEdgeId, leaf.key, submainKey, 'child_of', 'restructure', 1, t, 'system:restructure');
            if (c.changes > 0) leafEdgesCreated++;
        } else {
            leafEdgesDeleted++;
            leafEdgesCreated++;
        }
    }
}

console.log(`\nSummary:`);
console.log(`  Submain created:     ${submainCreated}`);
console.log(`  Submain already existed: ${submainExists}`);
console.log(`  Submain → project edges created: ${submainEdgesCreated}`);
console.log(`  Leaf → project edges deleted: ${leafEdgesDeleted}`);
console.log(`  Leaf → submain edges created: ${leafEdgesCreated}`);
if (!apply) console.log('\n(Dry run — pass --apply to write changes)');
