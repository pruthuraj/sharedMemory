// Phase 2 of memory graph fault remediation: insert canonical arch/api/data/setup nodes
// so a fresh agent can orient on each project without reading source code.
//
// Content is hardcoded from CLAUDE.md, src/protocol.js, src/memory-store.js, mcp-server.mjs
// at the time of writing. This is a one-time snapshot; the graph should be re-audited and
// updated when the architecture changes.
//
// Idempotent: skips entries that already exist (won't overwrite manual edits).
// Default dry-run; pass --apply to write.
//
// Usage:
//   node scripts/backfill-canonical-nodes.js [--db path] [--apply]

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

// ── Canonical node definitions ───────────────────────────────────────────────
const NODES = [
    // ── sharedmemory: arch ───────────────────────────────────────────────────
    {
        key: 'arch.sharedmemory.overview',
        value: {
            type: 'arch',
            project: 'sharedmemory',
            role: 'system overview',
            summary: 'Local shared-memory service for multi-agent coordination. Express HTTP + WebSocket on port 3000, SQLite-backed key/value/graph store with metadata, and an official stdio MCP adapter. Single-process Node.js 24+ (uses node:sqlite). Auto-flush + graceful shutdown.',
            entryPoint: 'server.js → createSharedMemoryServer',
            tech: ['Node.js 24+', 'node:sqlite (WAL)', 'Express', 'ws', '@modelcontextprotocol/sdk'],
        },
        summary: 'Express + WebSocket + SQLite + MCP stdio adapter on port 3000. Multi-agent coordination service.',
        importance: 9,
        tags: ['arch', 'sharedmemory', 'overview'],
        parent: 'arch.sharedmemory',
    },
    {
        key: 'arch.sharedmemory.modules',
        value: {
            type: 'arch',
            project: 'sharedmemory',
            role: 'module map',
            modules: {
                'src/server.js': 'Express, HTTP, WebSocket setup, auth gating, /status, protocol routing, background prune, notification orchestration',
                'src/memory-store.js': 'SQLite-backed store: metadata, TTL expiry, graph relations, FTS5 search, import/export',
                'src/protocol.js': 'JSON parsing/validation for all command types; requestId; auditMetadata() soft-warn',
                'src/agent-registry.js': 'Temporary + stable agent IDs, subscriptions, links, reconnect placeholders',
                'src/delivery.js': 'Safe WebSocket sends; fan-out for update / relation-update / linked-agent broadcasts',
                'src/suggestion-engine.js': 'Optional semantic suggestion queue and ranking pipeline',
                'src/vector-index.js': 'In-memory vector index',
                'src/suggestion-ranking.js': 'Deterministic ranking helpers',
                'src/embedding-adapter.js': 'Lazy Hugging Face embedding adapter',
                'src/mcp-tools.js': 'Transport-independent MCP tool handlers',
                'mcp-server.mjs': 'Stdio MCP adapter exposing 13 memory_* tools',
                'scripts/smoke-suggest.js': 'Manual WS smoke client for Transformers.js suggestion path',
            },
        },
        summary: '11 src files: server, memory-store, protocol, agent-registry, delivery, suggestion-engine, vector-index, mcp-tools.',
        importance: 9,
        tags: ['arch', 'sharedmemory', 'modules', 'file-map'],
        parent: 'arch.sharedmemory',
    },
    {
        key: 'arch.sharedmemory.message-flow',
        value: {
            type: 'arch',
            project: 'sharedmemory',
            role: 'request lifecycle',
            flow: 'WebSocket JSON → parseMessage (protocol.js) → server.js switch → memory/registry/suggestion module → direct response + optional broadcasts',
            requestIdRule: 'Transport-only. Direct responses and direct errors echo a valid requestId; broadcasts do not.',
            broadcasts: ['update', 'relation-update', 'linked-agent fan-out'],
        },
        summary: 'WS JSON → parseMessage → server switch → memory module → response + optional broadcasts. requestId on responses only.',
        importance: 8,
        tags: ['arch', 'sharedmemory', 'message-flow', 'websocket'],
        parent: 'arch.sharedmemory',
    },
    {
        key: 'arch.sharedmemory.dashboard',
        value: {
            type: 'arch',
            project: 'sharedmemory',
            role: 'dashboard',
            served: 'Static HTML/JS at / by src/server.js',
            renderer: 'Cytoscape.js 3.30.2 canvas (no DOM nodes)',
            bundler: 'none — plain `use strict` JS files communicating via globals',
            cdnDeps: ['dagre@0.8.5', 'cytoscape@3.30.2', 'cytoscape-dagre@2.5.0'],
            jsLayout: 'public/js/dashboard/{state,layout,nodes,edges,graph-detail,identity,viewport,realtime,import,export,settings-palette,main,utils}.js + public/js/settings/{schema,store,profiles,apply,panel,index}.js',
            cardSize: '168×78 px round-rectangle, SVG data-URI background',
            layouts: { force: 'Cytoscape cose (default)', hierarchical: 'cytoscape-dagre LR' },
            note: 'Adding a setting requires both a schema entry AND a handler in settings-palette.js',
        },
        summary: 'Static dashboard at /. Cytoscape canvas renderer, no bundler, two layouts (cose default, dagre hierarchical).',
        importance: 8,
        tags: ['arch', 'sharedmemory', 'dashboard', 'cytoscape'],
        parent: 'arch.sharedmemory',
    },

    // ── sharedmemory: api ────────────────────────────────────────────────────
    {
        key: 'api.sharedmemory.websocket',
        value: {
            type: 'api',
            project: 'sharedmemory',
            surface: 'ws://localhost:3000',
            commands: [
                'auth', 'register', 'set', 'get', 'subscribe', 'unsubscribe', 'touch',
                'link', 'unlink', 'list', 'relate', 'unrelate', 'delete', 'map',
                'search', 'suggest', 'prune', 'export', 'validate-import', 'import',
                'audit', 'bulk_set', 'bulk_relate',
            ],
            relationTypes: [
                'related_to', 'depends_on', 'supports', 'contradicts', 'mentions',
                'derived_from', 'next_step', 'implements', 'documents', 'blocks', 'child_of',
            ],
            auth: 'MEMORY_TOKEN env var enables single-token auth; required for WS commands and /status when set',
            requestId: 'Optional; echoed on direct responses and direct errors only (not broadcasts)',
            source: 'src/protocol.js COMMAND_TYPE_LIST + RELATION_TYPE_LIST',
        },
        summary: '23 WS command types + 11 relation types. Token auth via MEMORY_TOKEN. requestId echoed only on direct responses.',
        importance: 9,
        tags: ['api', 'sharedmemory', 'websocket', 'protocol'],
        parent: 'api.sharedmemory',
    },
    {
        key: 'api.sharedmemory.mcp',
        value: {
            type: 'api',
            project: 'sharedmemory',
            surface: 'stdio JSON-RPC (npm run mcp)',
            tools: [
                'memory_set', 'memory_get', 'memory_search', 'memory_suggest', 'memory_map',
                'memory_relate', 'memory_unrelate', 'memory_export', 'memory_validate_import',
                'memory_import', 'memory_audit', 'memory_bulk_set', 'memory_bulk_relate',
            ],
            envelope: '{ ok: boolean, ...result } or { ok: false, error }',
            authNote: 'MEMORY_TOKEN is NOT used by stdio MCP — stdio is local process transport',
            suggestionsDefault: 'Disabled. Enable via MEMORY_SUGGEST_ENABLED=true (first call downloads ~25 MB model)',
            source: 'mcp-server.mjs',
        },
        summary: '13 MCP tools via stdio JSON-RPC. No auth (local transport). Suggestions opt-in via MEMORY_SUGGEST_ENABLED.',
        importance: 9,
        tags: ['api', 'sharedmemory', 'mcp', 'stdio'],
        parent: 'api.sharedmemory',
    },
    {
        key: 'api.sharedmemory.http',
        value: {
            type: 'api',
            project: 'sharedmemory',
            surface: 'http://localhost:3000',
            routes: {
                'GET /': 'Static dashboard (public/index.html)',
                'GET /status': 'Health JSON including memory persistence + audit counts (zombieCount, orphanCount, duplicateGroupCount, staleCount, expiredCount); cached 5s',
                'GET /protocol': 'Self-describing: command names, relation types, response mappings, broadcasts, MCP tool names, protocol version',
            },
            authNote: 'MEMORY_TOKEN required for /status when set',
        },
        summary: 'GET / dashboard, /status (+ audit, cached 5s), /protocol (self-describing). Token-gated when MEMORY_TOKEN set.',
        importance: 7,
        tags: ['api', 'sharedmemory', 'http'],
        parent: 'api.sharedmemory',
    },

    // ── sharedmemory: data ───────────────────────────────────────────────────
    {
        key: 'data.sharedmemory.schema',
        value: {
            type: 'data',
            project: 'sharedmemory',
            engine: 'node:sqlite (WAL mode, synchronous=FULL)',
            tables: {
                entries: 'key TEXT PK, value_json TEXT, summary TEXT, importance INTEGER, revision INTEGER, expires_at INTEGER, updated_at INTEGER, updated_by TEXT',
                tags: 'key TEXT FK→entries(key) ON DELETE CASCADE, tag TEXT, PK (key, tag)',
                edges: 'edge_id TEXT PK, from_key TEXT FK, to_key TEXT FK, relation TEXT, reason TEXT, weight REAL, updated_at INTEGER, updated_by TEXT — both FKs CASCADE on delete',
                fts_entries: 'FTS5 virtual table over (key, summary, tags_csv) for full-text search',
            },
            edgeIdRule: 'edge_id = from_key + relation + to_key (computed in JS, stored in column)',
            persistenceFlags: 'wal_autocheckpoint=1000, PASSIVE checkpoint on async flush, TRUNCATE checkpoint on flushSync',
            source: 'src/memory-store.js createTables()',
        },
        summary: 'SQLite WAL. Tables: entries (PK key), tags (PK key+tag, FK cascade), edges (PK edge_id, FK cascade), fts_entries (FTS5).',
        importance: 9,
        tags: ['data', 'sharedmemory', 'schema', 'sqlite'],
        parent: 'data.sharedmemory',
    },
    {
        key: 'data.sharedmemory.metadata',
        value: {
            type: 'data',
            project: 'sharedmemory',
            role: 'entry metadata semantics',
            fields: {
                summary: 'TEXT, ≤120 chars recommended. Auto-cascaded to parents via child_of (max 2 hops). Format on cascade: `[N children] subkey: snippet | ...` (top 5 by importance).',
                importance: 'INTEGER 0–10. 9–10 = core architecture/project identity. 7–8 = key decisions/critical setup. 5–6 = useful context. 3–4 = minor. 0–2 = ephemeral.',
                tags: 'Array (separate tags table). Used for FTS body, filtering, and ranking bonuses in suggestions.',
                expiresAt: 'INTEGER (ms epoch) or NULL. Background prune removes expired rows.',
                revision: 'INTEGER. Auto-increments on each set. ifRevision parameter on set provides optimistic locking.',
                updatedBy: 'TEXT. Free-form; conventional values: agent ID, system:<source>, mcp.',
            },
            zombieDefinition: 'importance=0 OR no tags OR empty summary. Reported by audit.zombies; expired entries are reported separately.',
            soft_warn: 'src/protocol.js auditMetadata() emits warnings array on set when summary/tags/importance are missing — write still succeeds.',
        },
        summary: 'Entry metadata: summary (cascaded), importance (0–10), tags, expiresAt, revision (optimistic locking), updatedBy.',
        importance: 8,
        tags: ['data', 'sharedmemory', 'metadata', 'semantics'],
        parent: 'data.sharedmemory',
    },

    // ── sharedmemory: setup ──────────────────────────────────────────────────
    {
        key: 'setup.sharedmemory.run',
        value: {
            type: 'setup',
            project: 'sharedmemory',
            commands: {
                start: 'npm start  — boots HTTP + WS on PORT (default 3000)',
                test: 'npm test  — node:test runner against all files in test/',
                mcp: 'npm run mcp  — runs stdio MCP adapter (mcp-server.mjs)',
                smoke_suggest: 'npm run smoke:suggest  — manual end-to-end test of Transformers.js suggestion path',
                example: 'node example_agent.js <agentId>  — sample multi-agent client',
                health: 'curl http://localhost:3000/status',
            },
            envVars: {
                PORT: 'overrides HTTP/WS port (default 3000)',
                MEMORY_FILE: 'enables file-backed SQLite persistence (e.g. data/memory.db). Omit for in-memory.',
                MEMORY_TOKEN: 'enables single-token auth for WS + /status',
                MEMORY_SUGGEST_ENABLED: 'true|false (default false). Enables semantic suggestions; first call downloads ~25 MB ONNX model.',
                MEMORY_EMBED_MODEL: 'override HF Transformers.js model (default onnx-community/all-MiniLM-L6-v2-ONNX)',
            },
            requires: 'Node.js 24 or newer (uses node:sqlite — experimental warning is normal)',
        },
        summary: 'npm start (port 3000) / npm test / npm run mcp. Env: PORT, MEMORY_FILE, MEMORY_TOKEN, MEMORY_SUGGEST_ENABLED. Node 24+.',
        importance: 9,
        tags: ['setup', 'sharedmemory', 'run', 'commands'],
        parent: 'setup.sharedmemory',
    },

    // ── portfolio: priority 2 ────────────────────────────────────────────────
    {
        key: 'arch.portfolio.overview',
        value: {
            type: 'arch',
            project: 'portfolio',
            role: 'system overview',
            stack: 'React + Vite (single-page static site)',
            location: 'D:\\Pruthu\\cv projects\\portfolio',
            theme: 'dark editorial CV portfolio',
            showcasedProjects: ['sharedmemory', 'hextts', 'webreader', 'ecg-digital-twin'],
        },
        summary: 'React/Vite dark editorial CV portfolio showcasing 4 projects. Source at D:\\Pruthu\\cv projects\\portfolio.',
        importance: 8,
        tags: ['arch', 'portfolio', 'overview', 'react', 'vite'],
        parent: 'arch.portfolio',
    },

    // ── cross-project: priority 2 ────────────────────────────────────────────
    {
        key: 'arch.cross-project.relationships',
        value: {
            type: 'arch',
            project: 'cross-project',
            role: 'project topology',
            projects: ['sharedmemory', 'webreader', 'hextts', 'ecg-digital-twin', 'portfolio'],
            relationships: {
                portfolio: 'showcases all other 4 projects as CV pieces',
                hextts: 'paired with webreader as ML/backend duo',
                webreader: 'paired with hextts; consumes TTS for novel reading',
                sharedmemory: 'tooling/infra used across all projects for agent coordination',
                ecg_digital_twin: 'standalone safety-critical MATLAB project',
            },
            scopeAnchor: 'decision.cross-project.portfolio-scope',
        },
        summary: 'Portfolio showcases 4 projects (sharedmemory, hextts, webreader, ecg-digital-twin). hextts↔webreader paired.',
        importance: 8,
        tags: ['arch', 'cross-project', 'topology', 'relationships'],
        parent: 'arch.cross-project',
    },
];

// Submain parents for keys whose parent submain doesn't exist yet need to be created
// inline before linking. We rely on Phase 1 having created the standard ones.

// ── Statements ───────────────────────────────────────────────────────────────
const getEntry = db.prepare('SELECT key FROM entries WHERE key = ?');
const upsertEntry = db.prepare(
    'INSERT INTO entries (key, value_json, summary, importance, revision, expires_at, updated_at, updated_by) VALUES (?, ?, ?, ?, 1, NULL, ?, ?)'
);
const insertTag = db.prepare('INSERT OR IGNORE INTO tags (key, tag) VALUES (?, ?)');
const insertEdge = db.prepare(
    'INSERT OR IGNORE INTO edges (edge_id, from_key, to_key, relation, reason, weight, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);
const deleteEntry = db.prepare('DELETE FROM entries WHERE key = ?');

const t = Date.now();
let created = 0;
let skipped = 0;
let edgesCreated = 0;

console.log(`Mode: ${apply ? 'LIVE (--apply)' : 'DRY RUN'}`);
console.log(`DB:   ${path.resolve(dbPath)}`);
console.log(`Canonical nodes planned: ${NODES.length}\n`);

let submainAutoCreated = 0;

function ensureSubmain(submainKey, project) {
    if (getEntry.get(submainKey)) return;
    const [prefix] = submainKey.split('.');
    const valueJson = JSON.stringify({ type: prefix, project, role: 'submain', childCount: 0 });
    const summary = `[0 children] ${prefix} bucket for ${project}`;
    if (apply) {
        upsertEntry.run(submainKey, valueJson, summary, 8, t, 'system:backfill');
        insertTag.run(submainKey, prefix);
        insertTag.run(submainKey, project);
        insertTag.run(submainKey, 'submain');
        const edgeId = `${submainKey}child_of${`project.${project}`}`;
        insertEdge.run(edgeId, submainKey, `project.${project}`, 'child_of', 'backfill', 1, t, 'system:backfill');
    }
    console.log(`  ${apply ? 'create  ' : '[dry]   '}submain ${submainKey} → child_of → project.${project}`);
    submainAutoCreated++;
}

let missingRoot = 0;

for (const node of NODES) {
    const existing = getEntry.get(node.key);
    if (existing) {
        console.log(`  exists   ${node.key} (skipping)`);
        skipped++;
        continue;
    }

    // Skip if project root doesn't exist (FK would fail)
    if (!getEntry.get(`project.${node.value.project}`)) {
        console.log(`  no-root  ${node.key} (project.${node.value.project} missing, skipping)`);
        missingRoot++;
        continue;
    }

    // Auto-create missing submain parent so canonical leaves wire correctly
    if (node.parent) ensureSubmain(node.parent, node.value.project);
    const parent = node.parent || `project.${node.value.project}`;

    if (apply) {
        upsertEntry.run(node.key, JSON.stringify(node.value), node.summary, node.importance, t, 'system:backfill');
        for (const tag of node.tags) {
            insertTag.run(node.key, tag);
        }
        const edgeId = `${node.key}child_of${parent}`;
        const r = insertEdge.run(edgeId, node.key, parent, 'child_of', 'backfill', 1, t, 'system:backfill');
        if (r.changes > 0) edgesCreated++;
    } else {
        edgesCreated++;
    }
    console.log(`  ${apply ? 'create  ' : '[dry]   '}${node.key} → child_of → ${parent} (imp=${node.importance})`);
    created++;
}

// ── Drop redundant reference.sharedmemory.mcp-tools-current ───────────────────
const redundantKey = 'reference.sharedmemory.mcp-tools-current';
const redundant = getEntry.get(redundantKey);
if (redundant) {
    if (apply) {
        deleteEntry.run(redundantKey);
        console.log(`  drop    ${redundantKey} (replaced by api.sharedmemory.mcp)`);
    } else {
        console.log(`  [dry]   drop ${redundantKey} (replaced by api.sharedmemory.mcp)`);
    }
}

console.log(`\nSummary:`);
console.log(`  Created:           ${created}`);
console.log(`  Skipped (exists):  ${skipped}`);
console.log(`  Skipped (no root): ${missingRoot}`);
console.log(`  Submain auto-made: ${submainAutoCreated}`);
console.log(`  Edges created:     ${edgesCreated}`);
console.log(`  Dropped:           ${redundant ? 1 : 0}`);
if (!apply) console.log('\n(Dry run — pass --apply to write changes)');
