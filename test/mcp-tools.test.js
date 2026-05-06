const assert = require('node:assert/strict');
const test = require('node:test');

const { createSharedMemoryToolHandlers, mcpToolResult } = require('../src/mcp-tools');
const { createMemoryStore } = require('../src/memory-store');

function createFakeSuggestionEngine(enabled = true) {
    const calls = {
        upserts: [],
        removes: [],
        flushes: 0,
        suggests: [],
    };

    return {
        calls,
        status() {
            return {
                enabled,
                modelId: 'fake',
                modelLoaded: enabled,
                activeIndexedCount: calls.upserts.length,
                queuedUpdateCount: 0,
                processing: false,
                lastIndexedAt: enabled ? 1000 : null,
                lastIndexError: null,
            };
        },
        async upsertMemory(key, entry) {
            calls.upserts.push({ key, entry });
            return enabled;
        },
        async removeMemory(key) {
            calls.removes.push(key);
            return enabled;
        },
        async flushQueue() {
            calls.flushes += 1;
            return enabled;
        },
        async suggest(request) {
            calls.suggests.push(request);
            return [{
                key: 'project.database',
                summary: 'Database summary',
                tags: ['database'],
                importance: 8,
                score: 0.9,
                reasons: ['semantic-match'],
            }];
        },
    };
}

test('MCP handlers set, get, search, and map memory with stable envelopes', async () => {
    const memory = createMemoryStore();
    const suggestionEngine = createFakeSuggestionEngine(false);
    const handlers = createSharedMemoryToolHandlers({
        memory,
        suggestionEngine,
        updatedBy: 'mcp-test',
    });

    const setResult = await handlers.memory_set({
        key: 'project.database',
        value: { engine: 'sqlite' },
        summary: 'Database summary',
        tags: ['database'],
        importance: 8,
    });
    assert.equal(setResult.ok, true);
    assert.equal(setResult.key, 'project.database');
    assert.equal(setResult.entry.summary, 'Database summary');
    assert.equal(setResult.entry.revision, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(setResult.entry, 'value'), false);

    const getResult = await handlers.memory_get({ key: 'project.database' });
    assert.equal(getResult.ok, true);
    assert.deepEqual(getResult.entry.value, { engine: 'sqlite' });
    assert.equal(getResult.entry.revision, 1);

    const updateResult = await handlers.memory_set({
        key: 'project.database',
        value: { engine: 'sqlite', version: 2 },
        summary: 'Database summary v2',
        tags: ['database'],
        importance: 8,
        ifRevision: 1,
    });
    assert.equal(updateResult.ok, true);
    assert.equal(updateResult.entry.revision, 2);

    assert.deepEqual(await handlers.memory_set({
        key: 'project.database',
        value: { engine: 'stale' },
        summary: 'Stale update',
        ifRevision: 1,
    }), {
        ok: false,
        error: 'revision-conflict',
        key: 'project.database',
        currentRevision: 2,
    });

    const searchResult = await handlers.memory_search({ tags: ['database'] });
    assert.equal(searchResult.ok, true);
    assert.equal(searchResult.total, 1);
    assert.deepEqual(searchResult.results.map((entry) => entry.key), ['project.database']);
    assert.equal(searchResult.results[0].revision, 2);

    const mapResult = await handlers.memory_map({ key: 'project.database' });
    assert.equal(mapResult.ok, true);
    assert.deepEqual(mapResult.nodes.map((node) => node.key), ['project.database']);
    assert.equal(mapResult.nodes[0].revision, 2);
});

test('MCP handlers validate inputs with protocol-compatible domain errors', async () => {
    const handlers = createSharedMemoryToolHandlers({
        memory: createMemoryStore(),
        suggestionEngine: createFakeSuggestionEngine(false),
    });

    assert.deepEqual(await handlers.memory_set({ key: '', value: true }), {
        ok: false,
        error: 'missing-key',
    });
    assert.deepEqual(await handlers.memory_set({ key: 'x', value: true, ttlMs: 1, expiresAt: 2 }), {
        ok: false,
        error: 'invalid-expiry',
    });
    assert.deepEqual(await handlers.memory_set({ key: 'x', value: true, ifRevision: 0 }), {
        ok: false,
        error: 'invalid-ifRevision',
    });
    assert.deepEqual(await handlers.memory_search({}), {
        ok: false,
        error: 'missing-filter',
    });
    assert.deepEqual(await handlers.memory_suggest({ context: '   ' }), {
        ok: false,
        error: 'invalid-context',
    });
    assert.deepEqual(await handlers.memory_map({ key: 'missing' }), {
        ok: false,
        error: 'missing-node',
    });
    assert.deepEqual(await handlers.memory_validate_import({}), {
        ok: false,
        error: 'missing-snapshot',
    });
});

test('MCP handlers export, validate, and import strict snapshots', async () => {
    const memory = createMemoryStore();
    const suggestionEngine = createFakeSuggestionEngine(true);
    const handlers = createSharedMemoryToolHandlers({
        memory,
        suggestionEngine,
        updatedBy: 'mcp-test',
    });

    await handlers.memory_set({
        key: 'project.database',
        value: { engine: 'sqlite' },
        summary: 'Database summary',
        tags: ['database'],
        importance: 8,
    });
    await handlers.memory_set({
        key: 'project.architecture',
        value: { pattern: 'modules' },
        summary: 'Architecture summary',
        tags: ['architecture'],
        importance: 7,
    });
    memory.relate('project.database', 'project.architecture', 'depends_on', 'mcp-test', {
        reason: '',
        weight: 0.8,
    });

    const exported = await handlers.memory_export();
    assert.equal(exported.ok, true);
    assert.deepEqual(exported.stats, { entryCount: 2, edgeCount: 1 });
    assert.deepEqual(Object.keys(exported.snapshot.entries), ['project.architecture', 'project.database']);

    assert.deepEqual(await handlers.memory_validate_import({ snapshot: exported.snapshot }), {
        ok: true,
        errors: [],
        stats: { entryCount: 2, edgeCount: 1 },
    });

    const invalid = await handlers.memory_import({
        snapshot: {
            entries: exported.snapshot.entries,
            edges: [{ from: 'project.database', to: 'missing', relation: 'depends_on', reason: '', weight: 1, updatedAt: 1, updatedBy: null }],
        },
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error, 'invalid-snapshot');
    assert.ok(invalid.errors.some((error) => error.message === 'dangling-edge'));
    assert.notEqual(memory.get('project.database'), null);

    const replacement = {
        entries: {
            imported: {
                value: 'imported',
                summary: 'Imported summary',
                tags: ['imported'],
                importance: 6,
                expiresAt: null,
                updatedAt: 100,
                updatedBy: 'mcp-test',
            },
        },
        edges: [],
    };
    assert.deepEqual(await handlers.memory_import({ snapshot: replacement }), {
        ok: true,
        stats: { entryCount: 1, edgeCount: 0 },
    });
    assert.deepEqual(memory.keys(), ['imported']);
    assert.ok(suggestionEngine.calls.removes.includes('project.database'));
    assert.ok(suggestionEngine.calls.upserts.some((call) => call.key === 'imported'));
});

test('MCP handlers validate and import merge snapshots without deleting existing memory', async () => {
    const memory = createMemoryStore();
    const suggestionEngine = createFakeSuggestionEngine(true);
    const handlers = createSharedMemoryToolHandlers({
        memory,
        suggestionEngine,
        updatedBy: 'mcp-test',
    });

    await handlers.memory_set({
        key: 'project.database',
        value: { engine: 'sqlite' },
        summary: 'Database summary',
        tags: ['database'],
        importance: 8,
    });
    await handlers.memory_set({
        key: 'project.architecture',
        value: { pattern: 'modules' },
        summary: 'Architecture summary',
        tags: ['architecture'],
        importance: 7,
    });
    memory.relate('project.database', 'project.architecture', 'depends_on', 'mcp-test', {
        reason: '',
        weight: 0.8,
    });

    const mergeSnapshot = {
        entries: {
            'project.database': {
                value: { engine: 'ignored' },
                summary: 'Database replacement',
                tags: ['database'],
                importance: 8,
                expiresAt: null,
                updatedAt: 100,
                updatedBy: 'external',
            },
            'project.notes': {
                value: { body: 'notes' },
                summary: 'Notes summary',
                tags: ['notes'],
                importance: 6,
                expiresAt: null,
                updatedAt: 200,
                updatedBy: 'external',
            },
        },
        edges: [
            {
                from: 'project.notes',
                to: 'project.database',
                relation: 'depends_on',
                reason: 'Notes depend on the existing database work.',
                weight: 0.7,
                updatedAt: 300,
                updatedBy: 'external',
            },
            {
                from: 'project.notes',
                to: 'project.database',
                relation: 'depends_on',
                reason: 'Duplicate edge should be skipped.',
                weight: 0.7,
                updatedAt: 301,
                updatedBy: 'external',
            },
        ],
    };

    assert.deepEqual(await handlers.memory_validate_import({ snapshot: mergeSnapshot, mode: 'merge' }), {
        ok: true,
        errors: [],
        mode: 'merge',
        stats: { entriesAdded: 1, entriesSkipped: 1, edgesAdded: 1, edgesSkipped: 1 },
    });

    assert.deepEqual(await handlers.memory_import({ snapshot: mergeSnapshot, mode: 'merge' }), {
        ok: true,
        mode: 'merge',
        stats: { entriesAdded: 1, entriesSkipped: 1, edgesAdded: 1, edgesSkipped: 1 },
    });
    assert.equal(memory.get('project.database').value.engine, 'sqlite');
    assert.equal(memory.get('project.notes').value.body, 'notes');
    assert.equal(memory.relationCount(), 2);
    assert.ok(suggestionEngine.calls.upserts.some((call) => call.key === 'project.notes'));
    assert.equal(suggestionEngine.calls.removes.length, 0);
});

test('MCP merge import rejects invalid snapshots without mutation', async () => {
    const memory = createMemoryStore();
    const handlers = createSharedMemoryToolHandlers({
        memory,
        suggestionEngine: createFakeSuggestionEngine(true),
        updatedBy: 'mcp-test',
    });

    await handlers.memory_set({
        key: 'existing',
        value: 'value',
        summary: 'Existing memory',
        tags: [],
        importance: 4,
    });

    const result = await handlers.memory_import({
        mode: 'merge',
        snapshot: {
            entries: {
                fresh: {
                    value: 'fresh',
                    summary: 'Fresh memory',
                    tags: [],
                    importance: 4,
                    expiresAt: null,
                    updatedAt: 100,
                    updatedBy: 'external',
                },
            },
            edges: [
                { from: 'fresh', to: 'missing', relation: 'depends_on', reason: '', weight: 1, updatedAt: 100, updatedBy: 'external' },
            ],
        },
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid-snapshot');
    assert.ok(result.errors.some((error) => error.message === 'dangling-edge'));
    assert.deepEqual(memory.keys(), ['existing']);
});

test('memory_suggest returns empty when disabled and refreshes visible memory when enabled', async () => {
    const memory = createMemoryStore();
    memory.set('project.database', 'Database details', 'agentA', {
        summary: 'Database summary',
        tags: ['database'],
        importance: 8,
    });

    const disabledEngine = createFakeSuggestionEngine(false);
    const disabledHandlers = createSharedMemoryToolHandlers({ memory, suggestionEngine: disabledEngine });
    assert.deepEqual(await disabledHandlers.memory_suggest({ context: 'database task' }), {
        ok: true,
        enabled: false,
        suggestions: [],
    });
    assert.equal(disabledEngine.calls.upserts.length, 0);

    const enabledEngine = createFakeSuggestionEngine(true);
    const enabledHandlers = createSharedMemoryToolHandlers({
        memory,
        suggestionEngine: enabledEngine,
        updatedBy: 'mcp-test',
    });
    const result = await enabledHandlers.memory_suggest({ context: 'database task', tags: ['database'], limit: 3 });

    assert.equal(result.ok, true);
    assert.equal(result.enabled, true);
    assert.deepEqual(result.suggestions.map((suggestion) => suggestion.key), ['project.database']);
    assert.equal(enabledEngine.calls.upserts.length, 1);
    assert.equal(enabledEngine.calls.flushes, 1);
    assert.deepEqual(enabledEngine.calls.suggests[0], {
        context: 'database task',
        tags: ['database'],
        limit: 3,
        agentId: 'mcp-test',
    });
});

test('memory_bulk_set applies per-item with partial-failure tolerance', async () => {
    const handlers = createSharedMemoryToolHandlers({
        memory: createMemoryStore(),
        suggestionEngine: createFakeSuggestionEngine(false),
        updatedBy: 'mcp-test',
    });

    const empty = await handlers.memory_bulk_set({ entries: [] });
    assert.equal(empty.ok, false);
    assert.equal(empty.error, 'missing-entries');

    const result = await handlers.memory_bulk_set({
        entries: [
            { key: 'a', value: 1, summary: 's', tags: ['t'], importance: 5 },
            { key: 'b', value: 2, summary: 's', tags: ['t'], importance: 5 },
            { value: 3 },
        ],
    });
    assert.equal(result.ok, true);
    assert.equal(result.results.length, 3);
    assert.equal(result.results[0].ok, true);
    assert.equal(result.results[1].ok, true);
    assert.equal(result.results[2].ok, false);
    assert.equal(result.results[2].error, 'missing-key');

    const got = await handlers.memory_get({ key: 'a' });
    assert.equal(got.entry.value, 1);
});

test('memory_bulk_relate applies per-item with partial-failure tolerance', async () => {
    const handlers = createSharedMemoryToolHandlers({
        memory: createMemoryStore(),
        suggestionEngine: createFakeSuggestionEngine(false),
        updatedBy: 'mcp-test',
    });

    await handlers.memory_set({ key: 'a', value: 1, summary: 's', tags: ['t'], importance: 5 });
    await handlers.memory_set({ key: 'b', value: 1, summary: 's', tags: ['t'], importance: 5 });

    const result = await handlers.memory_bulk_relate({
        relations: [
            { from: 'a', to: 'b', relation: 'related_to' },
            { from: 'a', to: 'missing', relation: 'related_to' },
        ],
    });
    assert.equal(result.ok, true);
    assert.equal(result.results[0].ok, true);
    assert.equal(result.results[1].ok, false);
    assert.equal(result.results[1].error, 'missing-node');
});

test('memory_audit reports hygiene categories and validates input', async () => {
    const memory = createMemoryStore();
    const handlers = createSharedMemoryToolHandlers({
        memory,
        suggestionEngine: createFakeSuggestionEngine(false),
        updatedBy: 'mcp-test',
    });

    await handlers.memory_set({ key: 'good.a', value: 1, summary: 's', tags: ['t'], importance: 5 });
    await handlers.memory_set({ key: 'good.b', value: 1, summary: 's2', tags: ['t'], importance: 5 });
    await handlers.memory_relate({ from: 'good.a', to: 'good.b', relation: 'related_to' });
    await handlers.memory_set({ key: 'bad.zombie', value: 1 });

    const audit = await handlers.memory_audit({});
    assert.equal(audit.ok, true);
    assert.ok(audit.zombies.includes('bad.zombie'));
    assert.ok(!audit.zombies.includes('good.a'));
    assert.ok(audit.orphans.includes('bad.zombie'));
    assert.ok(!audit.orphans.includes('good.a'));
    assert.equal(audit.counts.zombies, audit.zombies.length);

    const invalid = await handlers.memory_audit({ staleMs: 'not a number' });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error, 'invalid-staleMs');
});

test('memory_set surfaces metadata warnings without blocking the write', async () => {
    const handlers = createSharedMemoryToolHandlers({
        memory: createMemoryStore(),
        suggestionEngine: createFakeSuggestionEngine(false),
        updatedBy: 'mcp-test',
    });

    const sparse = await handlers.memory_set({ key: 'task.x', value: 'hi' });
    assert.equal(sparse.ok, true);
    assert.deepEqual(sparse.warnings, ['missing-summary', 'missing-tags', 'missing-importance']);

    const partial = await handlers.memory_set({
        key: 'task.y',
        value: 'hi',
        summary: 'something',
        tags: [],
        importance: 0,
    });
    assert.equal(partial.ok, true);
    assert.deepEqual(partial.warnings, ['missing-tags', 'missing-importance']);

    const full = await handlers.memory_set({
        key: 'task.z',
        value: 'hi',
        summary: 'full entry',
        tags: ['ok'],
        importance: 5,
    });
    assert.equal(full.ok, true);
    assert.equal(Object.prototype.hasOwnProperty.call(full, 'warnings'), false);
});

test('mcpToolResult serializes JSON text and structured content', () => {
    const output = { ok: true, value: 1 };
    assert.deepEqual(mcpToolResult(output), {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
    });
});
