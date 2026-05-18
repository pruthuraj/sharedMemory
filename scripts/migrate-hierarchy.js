// One-time migration: wire existing nodes into project → submain → leaf hierarchy
// using child_of edges. Safe to re-run — uses INSERT OR IGNORE semantics via relate.
// Usage: node scripts/migrate-hierarchy.js [--db path/to/memory.db] [--dry-run]

'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const SUBMAIN_PREFIXES = ['arch', 'feature', 'decision', 'blocker', 'api', 'data', 'setup', 'reference'];
const LEAF_PREFIXES    = ['task', 'insight', 'evidence', 'file', 'agent', 'preference'];

const args = process.argv.slice(2);
const dbIndex = args.indexOf('--db');
const dbPath = dbIndex !== -1 ? args[dbIndex + 1] : (process.env.MEMORY_FILE || 'data/memory.db');
const dryRun = args.includes('--dry-run');

if (!dbPath) {
    console.error('No database path. Set MEMORY_FILE or pass --db <path>.');
    process.exit(1);
}

const db = new DatabaseSync(path.resolve(dbPath));

const allKeys = db.prepare('SELECT key FROM entries WHERE expires_at IS NULL OR expires_at > ?')
    .all(Date.now())
    .map(r => r.key);

const projectKeys = allKeys.filter(k => k.startsWith('project.'));

function getPrefix(key) {
    return key.split('.')[0];
}

function findProjectParent(keys) {
    return keys.find(k => k.startsWith('project.')) || null;
}

let created = 0;
let skipped = 0;

function edgeExists(from, relation, to) {
    const id = `${from}${relation}${to}`;
    return Boolean(db.prepare('SELECT 1 FROM edges WHERE edge_id = ?').get(id));
}

function createEdge(from, to) {
    const id = `${from}child_of${to}`;
    const t = Date.now();
    if (edgeExists(from, 'child_of', to)) {
        console.log(`  skip  ${from} → ${to} (exists)`);
        skipped++;
        return;
    }
    if (dryRun) {
        console.log(`  [dry] ${from} --child_of--> ${to}`);
        created++;
        return;
    }
    db.prepare(
        'INSERT OR IGNORE INTO edges (edge_id, from_key, to_key, relation, reason, weight, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, from, to, 'child_of', 'migrate-hierarchy', 1, t, 'system:migrate');
    console.log(`  create ${from} --child_of--> ${to}`);
    created++;
}

// Find or infer the single project node to use as root
const projectKey = projectKeys.length === 1
    ? projectKeys[0]
    : projectKeys.find(k => k === 'project.sharedmemory') || projectKeys[0];

if (!projectKey) {
    console.error('No project.* node found in store. Create one first.');
    process.exit(1);
}

console.log(`Root project node: ${projectKey}`);
console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

for (const key of allKeys) {
    const prefix = getPrefix(key);
    if (key.startsWith('project.') || key.startsWith('session') || key.startsWith('preference.')) continue;

    if (SUBMAIN_PREFIXES.includes(prefix)) {
        // submain → project
        createEdge(key, projectKey);
    } else if (LEAF_PREFIXES.includes(prefix)) {
        // Infer submain parent: match a submain node with EXACTLY 2 segments
        // (e.g. feature.auth) whose second segment equals this leaf's second segment.
        // Deeper submain keys like decision.sharedmemory.curation-tools are excluded
        // to avoid false matches across sibling topics.
        const segments = key.split('.');
        if (segments.length >= 2) {
            const topic = segments[1];
            const submainParent = allKeys.find(k =>
                SUBMAIN_PREFIXES.includes(getPrefix(k)) &&
                k.split('.').length === 2 &&
                k.split('.')[1] === topic
            );
            if (submainParent) {
                createEdge(key, submainParent);
            } else {
                // No clean 2-segment submain found — connect directly to project
                createEdge(key, projectKey);
            }
        } else {
            createEdge(key, projectKey);
        }
    }
}

console.log(`\nDone. Created: ${created}, Skipped (already existed): ${skipped}`);
if (dryRun) console.log('(Dry run — no changes written)');
