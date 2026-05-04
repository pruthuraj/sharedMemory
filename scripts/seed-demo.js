// Seeds the running server with demo memory entries and relations.
// Usage: node scripts/seed-demo.js

const WebSocket = require('ws');

const WS_URL = process.env.SMOKE_WS_URL || 'ws://localhost:3000';
const TOKEN = process.env.MEMORY_TOKEN || '';

const ENTRIES = [
    {
        key: 'project.overview',
        value: { name: 'SharedMemory', version: '0.1.0', status: 'active' },
        summary: 'Top-level project description and status',
        tags: ['project', 'meta'],
        importance: 9,
    },
    {
        key: 'arch.websocket',
        value: 'WebSocket JSON protocol for real-time agent coordination',
        summary: 'Core WS protocol — agents connect, set/get memory, subscribe to keys',
        tags: ['architecture', 'websocket'],
        importance: 8,
    },
    {
        key: 'arch.mcp',
        value: 'stdio MCP adapter exposing memory_set, memory_get, memory_search, memory_suggest, memory_map',
        summary: 'Official MCP stdio adapter for Claude/MCP tool ecosystem',
        tags: ['architecture', 'mcp'],
        importance: 8,
    },
    {
        key: 'arch.sqlite',
        value: { engine: 'node:sqlite', fts: 'FTS5', persistence: 'optional' },
        summary: 'SQLite-backed store with FTS5 search and optional file persistence',
        tags: ['architecture', 'storage'],
        importance: 7,
    },
    {
        key: 'feature.suggestions',
        value: { enabled: false, model: 'Xenova/all-MiniLM-L6-v2' },
        summary: 'Semantic suggestion engine using HuggingFace Transformers.js embeddings',
        tags: ['feature', 'ml', 'embeddings'],
        importance: 6,
    },
    {
        key: 'feature.graph',
        value: ['related_to', 'depends_on', 'supports', 'contradicts', 'mentions', 'derived_from', 'next_step'],
        summary: 'Typed graph relations between memory keys with weight and reason',
        tags: ['feature', 'graph'],
        importance: 7,
    },
    {
        key: 'feature.ttl',
        value: { defaultPruneIntervalMs: 600000 },
        summary: 'TTL expiry — entries can have expiresAt or ttlMs; background prune runs every 10 min',
        tags: ['feature', 'expiry'],
        importance: 5,
    },
    {
        key: 'agent.planner',
        value: { role: 'planner', status: 'idle' },
        summary: 'Planning agent that breaks down tasks and writes to shared memory',
        tags: ['agent'],
        importance: 7,
    },
    {
        key: 'agent.executor',
        value: { role: 'executor', status: 'idle' },
        summary: 'Executor agent that reads plans from memory and carries them out',
        tags: ['agent'],
        importance: 7,
    },
    {
        key: 'agent.observer',
        value: { role: 'observer', status: 'watching' },
        summary: 'Observer agent that monitors memory changes and logs anomalies',
        tags: ['agent', 'monitoring'],
        importance: 4,
    },
    {
        key: 'config.auth',
        value: { envVar: 'MEMORY_TOKEN', type: 'bearer' },
        summary: 'Optional single-token Bearer auth for WebSocket and /status endpoint',
        tags: ['config', 'security'],
        importance: 6,
    },
    {
        key: 'config.persistence',
        value: { envVar: 'MEMORY_FILE', example: 'data/memory.db' },
        summary: 'File-backed SQLite persistence enabled via MEMORY_FILE env var',
        tags: ['config', 'storage'],
        importance: 5,
    },
    {
        key: 'task.current',
        value: { title: 'Build memory graph UI', status: 'in-progress' },
        summary: 'Add a web-based graph visualisation page to the server',
        tags: ['task', 'ui'],
        importance: 8,
    },
    {
        key: 'decision.no-live-updates',
        value: 'Refresh-button only for v1; live updates need per-key subscriptions = protocol extension',
        summary: 'Decided against live graph updates in v1 due to protocol complexity',
        tags: ['decision', 'ui'],
        importance: 4,
    },
];

const RELATIONS = [
    { from: 'arch.websocket',        to: 'project.overview',       relation: 'supports',     weight: 0.9, reason: 'Primary transport layer' },
    { from: 'arch.mcp',              to: 'project.overview',       relation: 'supports',     weight: 0.9, reason: 'Secondary interface for MCP clients' },
    { from: 'arch.sqlite',           to: 'arch.websocket',         relation: 'supports',     weight: 0.8, reason: 'Backing store for all memory served over WS' },
    { from: 'arch.sqlite',           to: 'arch.mcp',               relation: 'supports',     weight: 0.8, reason: 'Same store used by MCP tools' },
    { from: 'feature.suggestions',   to: 'arch.websocket',         relation: 'depends_on',   weight: 0.7, reason: 'Exposed via WS suggest command' },
    { from: 'feature.suggestions',   to: 'arch.sqlite',            relation: 'depends_on',   weight: 0.6, reason: 'Reads memory keys to build vector index' },
    { from: 'feature.graph',         to: 'arch.sqlite',            relation: 'depends_on',   weight: 0.9, reason: 'Edges stored in SQLite' },
    { from: 'feature.ttl',           to: 'arch.sqlite',            relation: 'depends_on',   weight: 0.7, reason: 'expires_at stored per row' },
    { from: 'feature.graph',         to: 'feature.suggestions',    relation: 'related_to',   weight: 0.5, reason: 'Both enrich memory beyond raw key/value' },
    { from: 'agent.planner',         to: 'agent.executor',         relation: 'next_step',    weight: 1.0, reason: 'Planner writes; executor reads and acts' },
    { from: 'agent.observer',        to: 'agent.planner',          relation: 'mentions',     weight: 0.4, reason: 'Observer reports anomalies back to planner' },
    { from: 'agent.executor',        to: 'arch.websocket',         relation: 'depends_on',   weight: 0.9, reason: 'All agents communicate over WebSocket' },
    { from: 'agent.planner',         to: 'arch.websocket',         relation: 'depends_on',   weight: 0.9 },
    { from: 'config.auth',           to: 'arch.websocket',         relation: 'related_to',   weight: 0.6, reason: 'Auth gates the WS protocol' },
    { from: 'config.persistence',    to: 'arch.sqlite',            relation: 'related_to',   weight: 0.8, reason: 'Persistence is controlled by MEMORY_FILE' },
    { from: 'task.current',          to: 'feature.graph',          relation: 'derived_from', weight: 0.9, reason: 'Graph UI task exists because graph feature exists' },
    { from: 'task.current',          to: 'project.overview',       relation: 'mentions',     weight: 0.5 },
    { from: 'decision.no-live-updates', to: 'task.current',        relation: 'related_to',   weight: 0.7, reason: 'Design decision made during this task' },
    { from: 'decision.no-live-updates', to: 'arch.websocket',      relation: 'mentions',     weight: 0.4, reason: 'Per-key subscribe is the WS mechanic that makes live updates hard' },
];

async function seed() {
    const ws = new WebSocket(WS_URL);

    await new Promise((res, rej) => {
        ws.once('open', res);
        ws.once('error', rej);
    });

    const pending = new Map();
    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        if (msg.requestId && pending.has(msg.requestId)) {
            const { resolve } = pending.get(msg.requestId);
            pending.delete(msg.requestId);
            resolve(msg);
        }
    });

    function rpc(obj) {
        return new Promise((resolve) => {
            pending.set(obj.requestId, { resolve });
            ws.send(JSON.stringify(obj));
        });
    }

    // welcome (no requestId)
    await new Promise((res) => {
        const orig = ws.onmessage;
        const handler = (raw) => {
            let msg;
            try { msg = JSON.parse(typeof raw === 'object' && raw.data !== undefined ? raw.data : raw); } catch { return; }
            if (msg.type === 'welcome') { ws.off('message', handler); res(); }
        };
        ws.on('message', handler);
    });

    if (TOKEN) {
        const r = await rpc({ type: 'auth', token: TOKEN, requestId: 'auth-1' });
        if (r.type === 'error') { console.error('Auth failed:', r.message); ws.close(); return; }
        console.log('Authenticated.');
    }

    console.log(`Setting ${ENTRIES.length} memory entries…`);
    for (let i = 0; i < ENTRIES.length; i++) {
        const e = ENTRIES[i];
        const r = await rpc({ type: 'set', requestId: `set-${i}`, ...e });
        if (r.type === 'error') { console.error(`  ✗ ${e.key}: ${r.message}`); }
        else { console.log(`  ✓ ${e.key} (rev ${r.revision})`); }
    }

    console.log(`\nCreating ${RELATIONS.length} relations…`);
    for (let i = 0; i < RELATIONS.length; i++) {
        const rel = RELATIONS[i];
        const r = await rpc({ type: 'relate', requestId: `rel-${i}`, ...rel });
        if (r.type === 'error') { console.error(`  ✗ ${rel.from} -[${rel.relation}]-> ${rel.to}: ${r.message}`); }
        else { console.log(`  ✓ ${rel.from} -[${rel.relation}]-> ${rel.to}`); }
    }

    ws.close();
    console.log('\nDone. Open http://localhost:3000 and click Connect.');
}

seed().catch(console.error);
