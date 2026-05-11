#!/usr/bin/env node
// Curates a memory graph snapshot: standardizes updatedBy, fixes empty edge
// reasons, parses stringified JSON values, adds task statuses, adds project
// fields, archives stale session nodes, reports vague edges, and optionally
// splits into per-project files.
//
// Usage:
//   node scripts/memory-curator.js <input.json> [--out <output.json>] [--split] [--import] [--dry-run]
//
// Flags:
//   --out <file>   Write curated snapshot to file (default: curated-snapshot.json)
//   --split        Also write per-project snapshot files
//   --import       Validate and import into running server (PORT env, default 3000)
//   --dry-run      Transform + report only, no file writes, no import
//   --session-days <n>  Archive sessions older than n days (default: 14)

'use strict';

const { readFileSync, writeFileSync } = require('node:fs');
const { argv } = require('node:process');

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = argv.slice(2);

function flag(name) {
    return args.includes(name);
}
function option(name, def) {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : def;
}

const inputFile = args.find((a) => !a.startsWith('--'));
const outFile = option('--out', 'curated-snapshot.json');
const doSplit = flag('--split');
const doImport = flag('--import');
const dryRun = flag('--dry-run');
const sessionDays = Number(option('--session-days', '14'));

if (!inputFile) {
    console.error('Usage: node scripts/memory-curator.js <input.json> [--out <file>] [--split] [--import] [--dry-run]');
    process.exit(1);
}

// ── Load snapshot ─────────────────────────────────────────────────────────────

let raw;
try {
    raw = JSON.parse(readFileSync(inputFile, 'utf8'));
} catch (e) {
    console.error(`Failed to read/parse ${inputFile}: ${e.message}`);
    process.exit(1);
}

const entries = raw.entries ?? {};
const edges = (raw.edges ?? []).map((e) => ({ ...e }));

// ── Transform helpers ─────────────────────────────────────────────────────────

const UPDATER_MAP = {
    'Open-Ai': 'gpt-5.5-thinking',
    'OpenAi': 'gpt-5.5-thinking',
    'open-ai': 'gpt-5.5-thinking',
    'openai': 'gpt-5.5-thinking',
};
const AGENT_ID_RE = /^agent_[a-z0-9]+$/;

function normalizeUpdater(v) {
    if (v == null) return v;
    if (UPDATER_MAP[v]) return UPDATER_MAP[v];
    if (AGENT_ID_RE.test(v)) return 'mcp';
    return v;
}

const PROJECT_MAP = {
    webreader: 'webreader',
    hextts: 'hextts',
    sharedMemory: 'sharedMemory',
    sharedmemory: 'sharedMemory',
    ecg: 'ecg-digital-twin',
    portfolio: 'portfolio',
};

function inferProject(key) {
    const parts = key.split('.');
    // namespace.project.subkey pattern (e.g. decision.webreader.foo)
    for (const part of parts) {
        if (PROJECT_MAP[part]) return PROJECT_MAP[part];
    }
    return null;
}

function tryParseJson(v) {
    if (typeof v !== 'string') return v;
    const trimmed = v.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return v;
    try {
        return JSON.parse(trimmed);
    } catch {
        return v;
    }
}

const STALE_MS = sessionDays * 24 * 60 * 60 * 1000;
const NOW = Date.now();

// ── Step 2a: Standardize updatedBy ───────────────────────────────────────────

let updaterFixes = 0;
for (const [key, entry] of Object.entries(entries)) {
    const fixed = normalizeUpdater(entry.updatedBy);
    if (fixed !== entry.updatedBy) {
        entry.updatedBy = fixed;
        updaterFixes++;
    }
}
for (const edge of edges) {
    const fixed = normalizeUpdater(edge.updatedBy);
    if (fixed !== edge.updatedBy) {
        edge.updatedBy = fixed;
    }
}

// ── Step 2b: Fix empty edge reasons ──────────────────────────────────────────

let reasonFixes = 0;
for (const edge of edges) {
    if (edge.reason == null || edge.reason.trim() === '') {
        edge.reason = `${edge.from} ${edge.relation.replace(/_/g, ' ')} ${edge.to} (auto-filled by curator)`;
        reasonFixes++;
    }
}

// ── Step 2c: Convert stringified JSON values ──────────────────────────────────

let jsonFixes = 0;
for (const [key, entry] of Object.entries(entries)) {
    const parsed = tryParseJson(entry.value);
    if (parsed !== entry.value) {
        entry.value = parsed;
        jsonFixes++;
    }
}

// ── Step 2d: Add status to task entries ───────────────────────────────────────

let taskFixes = 0;
for (const [key, entry] of Object.entries(entries)) {
    if (!key.startsWith('task.')) continue;
    if (typeof entry.value === 'string') {
        const u = entry.value.toUpperCase();
        let status = 'open';
        if (u.includes('RESOLVED') || u.includes('DONE') || u.includes('COMPLETE')) status = 'resolved';
        else if (u.includes('BLOCKED')) status = 'blocked';
        else if (u.includes('IN PROGRESS') || u.includes('IN_PROGRESS') || u.includes('WIP')) status = 'in_progress';
        entry.value = { status, details: entry.value };
        taskFixes++;
    } else if (entry.value && typeof entry.value === 'object' && !entry.value.status) {
        entry.value.status = 'open';
        taskFixes++;
    }
}

// ── Step 2e: Add project to every entry value ─────────────────────────────────

let projectFixes = 0;
for (const [key, entry] of Object.entries(entries)) {
    const project = inferProject(key);
    if (!project) continue;
    if (entry.value && typeof entry.value === 'object' && !Array.isArray(entry.value)) {
        if (!entry.value.project) {
            entry.value.project = project;
            projectFixes++;
        }
    }
}

// ── Step 2f: Archive stale session nodes ──────────────────────────────────────

const renamedKeys = new Map(); // oldKey → newKey
const archivedKeys = [];
for (const key of Object.keys(entries)) {
    if (!key.startsWith('session.')) continue;
    const entry = entries[key];
    const age = NOW - (entry.updatedAt ?? 0);
    if (age > STALE_MS) {
        const newKey = key.replace(/^session\./, 'archive.session.');
        renamedKeys.set(key, newKey);
        entries[newKey] = entry;
        delete entries[key];
        archivedKeys.push({ from: key, to: newKey });
    }
}

// Rewrite edges referencing renamed keys
for (const edge of edges) {
    if (renamedKeys.has(edge.from)) edge.from = renamedKeys.get(edge.from);
    if (renamedKeys.has(edge.to)) edge.to = renamedKeys.get(edge.to);
}

// ── Step 2g: Report vague edges ───────────────────────────────────────────────

const VAGUE_RELATIONS = new Set(['related_to', 'mentions']);
const vagueEdges = edges
    .filter((e) => VAGUE_RELATIONS.has(e.relation))
    .map((e) => ({
        from: e.from,
        to: e.to,
        relation: e.relation,
        reason: e.reason,
        fromSummary: entries[e.from]?.summary ?? '(missing)',
        toSummary: entries[e.to]?.summary ?? '(missing)',
        suggestion: e.relation === 'mentions'
            ? 'Consider: documents, supports, derived_from'
            : 'Consider: depends_on, supports, implements, derived_from, documents, blocks',
    }));

// ── Step 2h: Add schema version ───────────────────────────────────────────────

const curated = {
    schemaVersion: '1.1',
    curatedAt: new Date().toISOString(),
    entries,
    edges,
};

// ── Step 3: Project splitting ─────────────────────────────────────────────────

function buildProjectSnapshot(projectId) {
    const projectEntries = {};
    for (const [key, entry] of Object.entries(entries)) {
        if (inferProject(key) === projectId) {
            projectEntries[key] = entry;
        }
    }
    const projectKeySet = new Set(Object.keys(projectEntries));
    const projectEdges = [];
    const crossEdges = [];
    for (const edge of edges) {
        const fromIn = projectKeySet.has(edge.from);
        const toIn = projectKeySet.has(edge.to);
        if (fromIn && toIn) projectEdges.push(edge);
        else if (fromIn || toIn) crossEdges.push(edge);
    }
    return { snapshot: { schemaVersion: '1.1', curatedAt: curated.curatedAt, entries: projectEntries, edges: projectEdges }, crossEdges };
}

const ALL_PROJECTS = ['webreader', 'hextts', 'sharedMemory', 'ecg-digital-twin', 'portfolio'];

// ── Output ────────────────────────────────────────────────────────────────────

const report = {
    stats: {
        totalEntries: Object.keys(entries).length,
        totalEdges: edges.length,
        updaterFixes,
        reasonFixes,
        jsonFixes,
        taskFixes,
        projectFixes,
        archivedSessions: archivedKeys.length,
        vagueEdges: vagueEdges.length,
    },
    archivedSessions: archivedKeys,
    vagueEdges,
};

console.log('\n── Curation Report ──────────────────────────────────────');
console.log(`Entries:          ${report.stats.totalEntries}`);
console.log(`Edges:            ${report.stats.totalEdges}`);
console.log(`updatedBy fixes:  ${updaterFixes}`);
console.log(`Empty reasons:    ${reasonFixes} (auto-filled)`);
console.log(`JSON parses:      ${jsonFixes}`);
console.log(`Task statuses:    ${taskFixes}`);
console.log(`Project fields:   ${projectFixes}`);
console.log(`Sessions archived:${archivedKeys.length} (older than ${sessionDays} days)`);
console.log(`Vague edges:      ${vagueEdges.length} (see curator-report.json)`);
console.log('─────────────────────────────────────────────────────────\n');

if (!dryRun) {
    writeFileSync(outFile, JSON.stringify(curated, null, 2), 'utf8');
    console.log(`Curated snapshot → ${outFile}`);

    writeFileSync('curator-report.json', JSON.stringify(report, null, 2), 'utf8');
    console.log('Vague edge report → curator-report.json');

    if (doSplit) {
        const allCrossEdges = [];
        for (const projectId of ALL_PROJECTS) {
            const slug = projectId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const { snapshot: ps, crossEdges } = buildProjectSnapshot(projectId);
            const entryCount = Object.keys(ps.entries).length;
            if (entryCount === 0) {
                console.log(`${projectId}: 0 entries, skipping`);
                continue;
            }
            const fname = `${slug}-memory.json`;
            writeFileSync(fname, JSON.stringify(ps, null, 2), 'utf8');
            console.log(`${projectId}: ${entryCount} entries, ${ps.edges.length} edges → ${fname}`);
            allCrossEdges.push(...crossEdges.map((e) => ({ ...e, _project: projectId })));
        }
        if (allCrossEdges.length > 0) {
            writeFileSync('cross-project-edges.json', JSON.stringify(allCrossEdges, null, 2), 'utf8');
            console.log(`Cross-project edges → cross-project-edges.json (${allCrossEdges.length})`);
        }
    }
} else {
    console.log('[dry-run] No files written.');
}

// ── Step 4: Import (spawned subprocess to avoid CJS async/WS quirks) ─────────

if (doImport && !dryRun) {
    const { execFileSync } = require('node:child_process');
    const port = Number(process.env.PORT ?? 3000);
    const importScript = `
const fs = require('fs');
const snap = JSON.parse(fs.readFileSync(${JSON.stringify(outFile)},'utf8'));
const snapshot = { entries: snap.entries, edges: snap.edges };
async function wsCmd(cmd, expectedType) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:${port}');
    const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 30000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({...cmd, requestId:'curator'})));
    ws.addEventListener('message', e => { const m=JSON.parse(e.data); if(m.type!==expectedType)return; clearTimeout(timer); ws.close(); resolve(m); });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('ws error')); });
  });
}
(async () => {
  console.log('Validating...');
  const val = await wsCmd({type:'validate-import',snapshot,mode:'replace'},'import-validation');
  if (!val.ok) { fs.writeFileSync('curator-errors.json',JSON.stringify(val.errors,null,2)); console.error('Validation failed:',val.errors.length,'error(s). See curator-errors.json'); process.exit(1); }
  console.log('Valid. Importing...');
  const imp = await wsCmd({type:'import',snapshot,mode:'replace'},'import-result');
  if (!imp.ok) { console.error('Import failed:',JSON.stringify(imp)); process.exit(1); }
  console.log('Import complete:',imp.stats.entryCount,'entries,',imp.stats.edgeCount,'edges');
})().catch(e=>{ console.error('Import error:',e.message); process.exit(1); });
`;
    try {
        execFileSync(process.execPath, ['-e', importScript], { stdio: 'inherit' });
    } catch {
        process.exit(1);
    }
}
