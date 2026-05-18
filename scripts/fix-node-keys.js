// Fix misrouted memory node keys.
// Renames keys, updates value.project field in value_json, updates tags table,
// and re-wires all edges to/from each key.
//
// Usage:
//   node scripts/fix-node-keys.js [--db path/to/memory.db] [--apply]
//
// Default is dry-run. Pass --apply to write changes.

'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

// ── Rename table ──────────────────────────────────────────────────────────────

// Non-standard prefix nodes present in the live DB
const NON_STANDARD = [
    // analytics.* → data.*
    { oldKey: 'analytics.webreader.events',         newKey: 'data.webreader.events',         oldProject: 'webreader', newProject: 'webreader' },
    // backend.* → arch.*
    { oldKey: 'backend.webreader.scraping.policy',  newKey: 'arch.webreader.scraping.policy', oldProject: 'webreader', newProject: 'webreader' },
    { oldKey: 'backend.webreader.source.adapter',   newKey: 'arch.webreader.source.adapter',  oldProject: 'webreader', newProject: 'webreader' },
    // fact.* → reference.*  (missing project segment — infer from content tags/context)
    { oldKey: 'fact.dashboard.js-file-map',          newKey: 'reference.sharedmemory.dashboard.js-file-map',     oldProject: null, newProject: 'sharedmemory' },
    { oldKey: 'fact.hextts-timeline-data-contract',  newKey: 'reference.hextts.hextts-timeline-data-contract',   oldProject: null, newProject: 'hextts' },
    { oldKey: 'fact.mcp-tools-current',              newKey: 'reference.sharedmemory.mcp-tools-current',         oldProject: null, newProject: 'sharedmemory' },
    { oldKey: 'fact.portfolio-current-content',      newKey: 'reference.portfolio.portfolio-current-content',    oldProject: null, newProject: 'portfolio' },
    // mobile.* → arch.*
    { oldKey: 'mobile.webreader.modules',            newKey: 'arch.webreader.modules',         oldProject: 'webreader', newProject: 'webreader' },
    // testing.* → decision.*
    { oldKey: 'testing.webreader.strategy',          newKey: 'decision.webreader.strategy',    oldProject: 'webreader', newProject: 'webreader' },
];

// ECG MATLAB files misclassified under file.sharedmemory.* (snapshot only — may not exist in live DB)
const ECG_FILES = [
    'admit-patient-m', 'derive-alarm-config-from-patient-m', 'ensure-nurse-call-file-m',
    'get-last-line-m', 'load-ptbxl-record-no-wfdb-m', 'load-system-config-m', 'log-event-m',
    'mode-manager-m', 'nurse-call-path-m', 'pipeline-ack-alarm-m', 'pipeline-admit-from-csv-m',
    'pipeline-init-m', 'pipeline-step-m', 'read-nurse-call-event-m', 'resolve-nurse-call-event-m',
    'simple-hash-m', 'validate-scenario-m', 'watchdog-m', 'write-nurse-call-event-m',
];

// sharedMemory source files misclassified under file.webreader.* (snapshot only)
const SM_FILES = [
    'mcp-server-mjs', 'public-css-styles-css', 'public-index-html',
    'public-js-dashboard-edges-js', 'public-js-dashboard-graph-detail-js',
    'public-js-dashboard-identity-js', 'public-js-dashboard-layout-js',
    'public-js-dashboard-main-js', 'public-js-dashboard-nodes-js',
    'public-js-dashboard-realtime-js', 'public-js-dashboard-settings-palette-js',
    'public-js-dashboard-state-js', 'public-js-dashboard-utils-js',
    'public-js-dashboard-viewport-js', 'public-js-settings-schema-js',
    'src-mcp-tools-js', 'src-memory-store-js', 'src-protocol-js', 'src-server-js',
    'test-server-test-js',
];

const RENAMES = [
    ...NON_STANDARD,
    // ECG MATLAB files
    ...ECG_FILES.map(f => ({
        oldKey: `file.sharedmemory.${f}`,
        newKey: `file.ecg-digital-twin.${f}`,
        oldProject: 'sharedmemory',
        newProject: 'ecg-digital-twin',
    })),
    // sharedMemory source files
    ...SM_FILES.map(f => ({
        oldKey: `file.webreader.${f}`,
        newKey: `file.sharedmemory.${f}`,
        oldProject: 'webreader',
        newProject: 'sharedmemory',
    })),
    // Misrouted durable nodes
    {
        oldKey: 'decision.hextts.bulk-transaction-durability',
        newKey: 'decision.sharedmemory.bulk-transaction-durability',
        oldProject: 'hextts',
        newProject: 'sharedmemory',
    },
    {
        oldKey: 'reference.webreader.portfolio-current-content',
        newKey: 'reference.portfolio.portfolio-current-content',
        oldProject: 'webreader',
        newProject: 'portfolio',
    },
];

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dbIndex = args.indexOf('--db');
const dbPath = dbIndex !== -1 ? args[dbIndex + 1] : (process.env.MEMORY_FILE || 'data/memory.db');
const apply = args.includes('--apply');

if (!dbPath) {
    console.error('No database path. Set MEMORY_FILE or pass --db <path>.');
    process.exit(1);
}

const db = new DatabaseSync(path.resolve(dbPath));

console.log(`Mode: ${apply ? 'LIVE (--apply)' : 'DRY RUN'}`);
console.log(`DB:   ${path.resolve(dbPath)}`);
console.log(`Renames planned: ${RENAMES.length}\n`);

const selectEntry = db.prepare(
    'SELECT key, value_json, summary, importance, revision, expires_at, updated_at, updated_by FROM entries WHERE key = ?'
);
const selectTags = db.prepare('SELECT tag FROM tags WHERE key = ?');
const insertEntry = db.prepare(
    'INSERT OR REPLACE INTO entries (key, value_json, summary, importance, revision, expires_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);
const insertTag = db.prepare('INSERT OR IGNORE INTO tags (key, tag) VALUES (?, ?)');
const deleteEntry = db.prepare('DELETE FROM entries WHERE key = ?');
const deleteTags = db.prepare('DELETE FROM tags WHERE key = ?');
const updateEdgeFrom = db.prepare('UPDATE edges SET from_key = ?, edge_id = replace(edge_id, ?, ?) WHERE from_key = ?');
const updateEdgeTo   = db.prepare('UPDATE edges SET to_key = ?, edge_id = replace(edge_id, ?, ?) WHERE to_key = ?');

let renamed = 0;
let notFound = 0;
let errors = 0;

for (const { oldKey, newKey, oldProject, newProject } of RENAMES) {
    const row = selectEntry.get(oldKey);

    if (!row) {
        console.log(`  NOT FOUND  ${oldKey} (skipping)`);
        notFound++;
        continue;
    }

    // Patch value_json: update project field if present and matches oldProject
    let valueJson = row.value_json;
    try {
        const parsed = JSON.parse(valueJson);
        if (parsed && typeof parsed === 'object') {
            if (oldProject && parsed.project === oldProject) {
                parsed.project = newProject;
            } else if (!parsed.project) {
                parsed.project = newProject;
            }
        }
        valueJson = JSON.stringify(parsed);
    } catch {
        // not JSON or not an object — leave as-is
    }

    // Get current tags and patch: replace oldProject with newProject in tags
    const currentTags = selectTags.all(oldKey).map(r => r.tag);
    const newTags = currentTags.map(t => (oldProject && t === oldProject) ? newProject : t);
    // Also replace old prefix tag if present (e.g. 'analytics' → 'data')
    const oldPrefix = oldKey.split('.')[0];
    const newPrefix = newKey.split('.')[0];
    const patchedRaw = newTags.map(t => t === oldPrefix ? newPrefix : t);
    // Deduplicate while preserving order
    const seen = new Set();
    const patchedTags = patchedRaw.filter(t => seen.has(t) ? false : seen.add(t));

    if (apply) {
        try {
            db.exec('BEGIN');
            insertEntry.run(newKey, valueJson, row.summary, row.importance, row.revision, row.expires_at, Date.now(), row.updated_by);
            // Re-insert tags under new key
            deleteTags.run(newKey); // clear any leftovers
            for (const tag of patchedTags) {
                insertTag.run(newKey, tag);
            }
            // Re-wire edges
            updateEdgeFrom.run(newKey, oldKey, newKey, oldKey);
            updateEdgeTo.run(newKey, oldKey, newKey, oldKey);
            // Delete old entry and tags
            deleteTags.run(oldKey);
            deleteEntry.run(oldKey);
            db.exec('COMMIT');
            console.log(`  rename  ${oldKey}`);
            console.log(`        → ${newKey}  [tags: ${patchedTags.join(', ')}]`);
            renamed++;
        } catch (err) {
            db.exec('ROLLBACK');
            console.error(`  ERROR   ${oldKey}: ${err.message}`);
            errors++;
        }
    } else {
        console.log(`  [dry]  ${oldKey}`);
        console.log(`       → ${newKey}`);
        if (oldProject !== newProject || oldPrefix !== newPrefix) {
            console.log(`         project: ${oldProject || '(none)'} → ${newProject}`);
            console.log(`         tags: [${currentTags.join(', ')}] → [${patchedTags.join(', ')}]`);
        }
        renamed++;
    }
}

console.log(`\nSummary:`);
console.log(`  Renamed:   ${renamed}`);
console.log(`  Not found: ${notFound}`);
console.log(`  Errors:    ${errors}`);
if (!apply) console.log('\n(Dry run — pass --apply to write changes)');
