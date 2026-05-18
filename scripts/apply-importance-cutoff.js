// Apply importance-cutoff rule: delete direct edges from low-importance leaves to project
// root, and cache stats (count/sum/avg/threshold) on each project node's value_json.
//
// Rule: a leaf (3+ segment, non-session) whose importance is BELOW its project's average
// descendant importance must NOT have a direct edge (any relation except child_of and
// documents) to its project root. Submain nodes (2-segment) are exempt — structural backbone.
//
// Idempotent. Dry-run default. Pass --apply to write.
//
// Usage:
//   node scripts/apply-importance-cutoff.js [--db path] [--apply]

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

const PROTECTED_RELATIONS = new Set(['child_of', 'documents']);

const entries = db.prepare('SELECT key, value_json, importance, revision FROM entries').all();
const entryByKey = new Map(entries.map((e) => [e.key, e]));

const projectKeys = entries.filter((e) => e.key.startsWith('project.')).map((e) => e.key);

const updateEntry = db.prepare(
    'UPDATE entries SET value_json = ?, revision = ?, updated_at = ?, updated_by = ? WHERE key = ?'
);
const deleteEdge = db.prepare('DELETE FROM edges WHERE edge_id = ?');
const t = Date.now();

console.log(`Mode: ${apply ? 'LIVE (--apply)' : 'DRY RUN'}`);
console.log(`DB:   ${path.resolve(dbPath)}`);
console.log(`Project roots: ${projectKeys.length}\n`);

let totalEdgesDeleted = 0;
let totalProjectsUpdated = 0;

for (const projectKey of projectKeys) {
    const project = projectKey.split('.').slice(1).join('.');

    // Collect descendants by namespace: 2nd segment matches project, exclude project itself
    // and session/section nodes.
    const descendants = entries.filter((e) => {
        if (e.key === projectKey) return false;
        if (e.key.startsWith('session.') || e.key.startsWith('session-section.')) return false;
        const parts = e.key.split('.');
        if (parts.length < 2) return false;
        return parts.slice(1).join('.').startsWith(project + '.') || parts.slice(1).join('.') === project;
    });

    if (descendants.length === 0) {
        console.log(`  ${projectKey}: no descendants, skipping`);
        continue;
    }

    const sum = descendants.reduce((s, e) => s + e.importance, 0);
    const avg = sum / descendants.length;
    const threshold = avg;

    // Find direct edges to delete
    const directEdges = db.prepare(
        `SELECT edge_id, from_key, to_key, relation FROM edges
         WHERE (from_key = ? OR to_key = ?)
         AND relation NOT IN ('child_of', 'documents')`
    ).all(projectKey, projectKey);

    const toDelete = [];
    for (const ed of directEdges) {
        const other = ed.from_key === projectKey ? ed.to_key : ed.from_key;
        if (other.startsWith('project.')) continue;
        if (other.startsWith('session.') || other.startsWith('session-section.')) continue;
        const otherParts = other.split('.');
        if (otherParts.length < 3) continue; // submain — exempt
        const otherEntry = entryByKey.get(other);
        if (!otherEntry) continue;
        if (otherEntry.importance < threshold) {
            toDelete.push(ed);
        }
    }

    // Update project value_json with stats
    let projectValue;
    try {
        projectValue = JSON.parse(entryByKey.get(projectKey).value_json);
    } catch {
        projectValue = {};
    }
    if (typeof projectValue !== 'object' || projectValue === null) projectValue = {};

    projectValue.stats = {
        count: descendants.length,
        sum,
        avgImportance: Number(avg.toFixed(4)),
        threshold: Number(threshold.toFixed(4)),
        removedDirectEdges: toDelete.length,
        lastComputedAt: t,
    };

    console.log(`  ${projectKey}: count=${descendants.length} sum=${sum} avg=${avg.toFixed(2)} edges-to-delete=${toDelete.length}`);
    for (const ed of toDelete) {
        const other = ed.from_key === projectKey ? ed.to_key : ed.from_key;
        const otherImp = entryByKey.get(other).importance;
        console.log(`    ${apply ? 'delete' : '[dry] '}  ${ed.from_key} --${ed.relation}--> ${ed.to_key} (other imp=${otherImp})`);
    }

    if (apply) {
        for (const ed of toDelete) {
            const r = deleteEdge.run(ed.edge_id);
            totalEdgesDeleted += r.changes;
        }
        const newRevision = (entryByKey.get(projectKey).revision || 1) + 1;
        updateEntry.run(JSON.stringify(projectValue), newRevision, t, 'system:cutoff', projectKey);
    } else {
        totalEdgesDeleted += toDelete.length;
    }
    totalProjectsUpdated++;
}

console.log(`\nSummary:`);
console.log(`  Projects updated:    ${totalProjectsUpdated}`);
console.log(`  Edges deleted:       ${totalEdgesDeleted}`);
if (!apply) console.log('\n(Dry run — pass --apply to write changes)');
