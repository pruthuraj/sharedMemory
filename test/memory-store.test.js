const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { createMemoryStore } = require('../src/memory-store');

function tempPath(name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-memory-test-'));
    return path.join(dir, name);
}

function createTimedStore() {
    let time = 100;
    return createMemoryStore({
        now() {
            time += 100;
            return time;
        },
    });
}

test('map uses bidirectional BFS with visited nodes for cycles', () => {
    const memory = createTimedStore();

    memory.set('A', 'root', 'test', { summary: 'A', importance: 0 });
    memory.set('B', 'b', 'test', { summary: 'B', importance: 5 });
    memory.set('C', 'c', 'test', { summary: 'C', importance: 5 });
    memory.set('D', 'd', 'test', { summary: 'D', importance: 9 });
    memory.set('E', 'e', 'test', { summary: 'E', importance: 8 });
    memory.set('F', 'f', 'test', { summary: 'F', importance: 10 });

    memory.relate('A', 'B', 'mentions', 'test');
    memory.relate('B', 'C', 'related_to', 'test');
    memory.relate('C', 'A', 'related_to', 'test');
    memory.relate('B', 'D', 'supports', 'test');
    memory.relate('C', 'E', 'supports', 'test');
    memory.relate('D', 'F', 'next_step', 'test');

    const depthOne = memory.map('A', { depth: 1, limit: 10 });
    assert.deepEqual(new Set(depthOne.nodes.map((node) => node.key)), new Set(['A', 'B', 'C']));

    const depthTwo = memory.map('A', { depth: 2, limit: 10 });
    assert.deepEqual(new Set(depthTwo.nodes.map((node) => node.key)), new Set(['A', 'B', 'C', 'D', 'E']));
    assert.equal(depthTwo.nodes.some((node) => node.key === 'F'), false);
    assert.equal(depthTwo.nodes.length, new Set(depthTwo.nodes.map((node) => node.key)).size);

    const depthThree = memory.map('A', { depth: 3, limit: 10 });
    assert.equal(depthThree.nodes.some((node) => node.key === 'F'), true);
});

test('map orders nodes deterministically before applying the limit', () => {
    const memory = createTimedStore();

    memory.set('root', 'root', 'test', { summary: 'root', importance: 0 });
    memory.set('low-old', 'low', 'test', { summary: 'low', importance: 1 });
    memory.set('high-old', 'high old', 'test', { summary: 'high old', importance: 10 });
    memory.set('high-new', 'high new', 'test', { summary: 'high new', importance: 10 });
    memory.set('medium-new', 'medium', 'test', { summary: 'medium', importance: 5 });

    for (const key of ['low-old', 'high-old', 'high-new', 'medium-new']) {
        memory.relate('root', key, 'related_to', 'test');
    }

    const result = memory.map('root', { depth: 1, limit: 3 });
    assert.deepEqual(result.nodes.map((node) => node.key), ['root', 'high-new', 'high-old']);
});

test('persistence starts empty when file is missing', () => {
    const file = tempPath('memory.db');
    const memory = createMemoryStore({ persistence: { file } });

    assert.deepEqual(memory.keys(), []);
    assert.deepEqual(memory.persistenceStatus(), {
        enabled: true,
        file,
        dirty: false,
        lastLoadedAt: memory.persistenceStatus().lastLoadedAt,
        lastFlushedAt: null,
        lastFlushError: null,
    });
    assert.equal(typeof memory.persistenceStatus().lastLoadedAt, 'number');
});

test('persistence rejects corrupt SQLite file at startup', () => {
    const file = tempPath('memory.db');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{bad json', 'utf8');

    assert.throws(
        () => createMemoryStore({ persistence: { file } }),
        /Failed to load memory persistence file/,
    );
});

test('flush persists entries and edges, and restart reloads them', async () => {
    const file = tempPath('memory.db');
    const memory = createTimedStoreWithPersistence(file);

    memory.set('project.architecture', 'Architecture details', 'agentA', {
        summary: 'Architecture summary',
        tags: ['architecture'],
        importance: 8,
    });
    memory.set('project.database', 'Database details', 'agentA', {
        summary: 'Database summary',
        tags: ['database'],
        importance: 7,
    });
    memory.relate('project.database', 'project.architecture', 'depends_on', 'agentA', {
        reason: 'Database choices shape architecture.',
        weight: 0.8,
    });

    assert.equal(memory.persistenceStatus().dirty, true);
    assert.equal(await memory.flush(), true);
    assert.equal(memory.persistenceStatus().dirty, false);

    const restored = createMemoryStore({ persistence: { file } });
    assert.deepEqual(restored.keys().sort(), ['project.architecture', 'project.database']);
    assert.equal(restored.get('project.architecture').summary, 'Architecture summary');

    const graph = restored.map('project.architecture', { depth: 1, limit: 10 });
    assert.equal(graph.edges.length, 1);
    assert.equal(graph.edges[0].relation, 'depends_on');
    assert.equal(graph.edges[0].reason, 'Database choices shape architecture.');
});

test('persistence drops dangling edges during load', () => {
    const memory = createTimedStore();

    memory.importState({
        entries: {
            nodeA: { value: 'A', summary: 'A', tags: [], importance: 1, updatedAt: 100, updatedBy: 'agentA' },
        },
        edges: [
            { from: 'nodeA', to: 'missing', relation: 'depends_on', reason: 'dangling', weight: 0.5, updatedAt: 200, updatedBy: 'agentA' },
        ],
    });

    assert.equal(memory.relationCount(), 0);
    assert.deepEqual(memory.map('nodeA', { depth: 1, limit: 10 }).edges, []);
});

test('snapshot export includes full entries and strict validation accepts it', () => {
    const memory = createTimedStore();

    memory.set('project.architecture', { body: 'Architecture details' }, 'agentA', {
        summary: 'Architecture summary',
        tags: ['architecture', 'plan'],
        importance: 8,
        expiresAt: 5000,
    });
    memory.set('project.database', { body: 'Database details' }, 'agentA', {
        summary: 'Database summary',
        tags: ['database'],
        importance: 7,
    });
    memory.relate('project.database', 'project.architecture', 'depends_on', 'agentA', {
        reason: '',
        weight: 0.75,
    });

    const snapshot = memory.exportState();
    assert.deepEqual(Object.keys(snapshot.entries), ['project.architecture', 'project.database']);
    assert.deepEqual(snapshot.entries['project.architecture'].value, { body: 'Architecture details' });
    assert.deepEqual(snapshot.entries['project.architecture'].tags, ['architecture', 'plan']);
    assert.equal(snapshot.entries['project.architecture'].expiresAt, 5000);
    assert.deepEqual(snapshot.edges.map((edge) => edge.relation), ['depends_on']);
    assert.equal(snapshot.edges[0].reason, '');

    assert.deepEqual(memory.validateSnapshot(snapshot), {
        ok: true,
        errors: [],
        stats: { entryCount: 2, edgeCount: 1 },
        snapshot,
    });
});

test('strict snapshot validation rejects malformed entries and edges', () => {
    const memory = createTimedStore();
    const result = memory.validateSnapshot({
        entries: {
            good: {
                value: 'good',
                summary: 'Good entry',
                tags: ['ok'],
                importance: 5,
                expiresAt: null,
                updatedAt: 100,
                updatedBy: 'agentA',
            },
            bad: {
                summary: '',
                tags: ['ok', ''],
                importance: 99,
                expiresAt: -1,
                updatedAt: -1,
                updatedBy: {},
            },
        },
        edges: [
            {
                from: 'good',
                to: 'missing',
                relation: 'depends_on',
                reason: 'dangling',
                weight: 0.5,
                updatedAt: 100,
                updatedBy: 'agentA',
            },
            {
                from: 'good',
                to: 'good',
                relation: 'related_to',
                reason: '',
                weight: 0.5,
                updatedAt: 100,
                updatedBy: 'agentA',
            },
            {
                from: 'good',
                to: 'good',
                relation: 'bad_relation',
                reason: '',
                weight: 2,
                updatedAt: 100,
                updatedBy: 'agentA',
            },
            {
                from: 'good',
                to: 'missing',
                relation: 'depends_on',
                reason: 'duplicate identity with first',
                weight: 0.5,
                updatedAt: 100,
                updatedBy: 'agentA',
            },
        ],
    });

    assert.equal(result.ok, false);
    assert.equal(result.stats, null);
    assert.ok(result.errors.some((error) => error.message === 'missing-value'));
    assert.ok(result.errors.some((error) => error.message === 'invalid-importance'));
    assert.ok(result.errors.some((error) => error.message === 'dangling-edge'));
    assert.ok(result.errors.some((error) => error.message === 'self-relation-not-allowed'));
    assert.ok(result.errors.some((error) => error.message === 'invalid-relation'));
    assert.ok(result.errors.some((error) => error.message === 'invalid-weight'));
    assert.ok(result.errors.some((error) => error.message === 'duplicate-edge'));
});

test('strict snapshot import replaces graph only after validation passes', () => {
    const memory = createTimedStore();

    memory.set('old', 'old value', 'agentA', { summary: 'Old memory' });
    const invalid = {
        entries: {
            next: {
                value: 'next value',
                summary: 'Next memory',
                tags: [],
                importance: 5,
                expiresAt: null,
                updatedAt: 100,
                updatedBy: 'agentB',
            },
        },
        edges: [{ from: 'next', to: 'missing', relation: 'related_to', reason: '', weight: 1, updatedAt: 100, updatedBy: 'agentB' }],
    };

    const failed = memory.importSnapshot(invalid);
    assert.equal(failed.ok, false);
    assert.deepEqual(memory.keys(), ['old']);

    const valid = {
        entries: {
            next: {
                value: { restored: true },
                summary: 'Next memory',
                tags: ['restore'],
                importance: 5,
                expiresAt: null,
                updatedAt: 100,
                updatedBy: 'agentB',
            },
        },
        edges: [],
    };

    assert.deepEqual(memory.importSnapshot(valid), {
        ok: true,
        errors: [],
        stats: { entryCount: 1, edgeCount: 0 },
    });
    assert.deepEqual(memory.keys(), ['next']);
    assert.deepEqual(memory.get('next').value, { restored: true });
});

test('cascade delete persists removed edges', async () => {
    const file = tempPath('memory.db');
    const memory = createTimedStoreWithPersistence(file);

    memory.set('nodeA', 'A', 'agentA');
    memory.set('nodeB', 'B', 'agentA');
    memory.set('nodeC', 'C', 'agentA');
    memory.relate('nodeA', 'nodeB', 'supports', 'agentA');
    memory.relate('nodeC', 'nodeA', 'depends_on', 'agentA');
    memory.delete('nodeA');
    await memory.flush();

    const restored = createMemoryStore({ persistence: { file } });
    assert.deepEqual(restored.keys().sort(), ['nodeB', 'nodeC']);
    assert.equal(restored.relationCount(), 0);
});

test('debounce scheduler keeps one active timer for rapid mutations', async () => {
    const file = tempPath('memory.db');
    const scheduled = new Map();
    let nextId = 1;
    const scheduler = {
        setTimeout(fn) {
            const id = nextId;
            nextId += 1;
            scheduled.set(id, fn);
            return id;
        },
        clearTimeout(id) {
            scheduled.delete(id);
        },
    };
    const memory = createMemoryStore({
        persistence: { file, debounceMs: 500, scheduler },
    });

    memory.set('nodeA', 'A', 'agentA');
    memory.set('nodeB', 'B', 'agentA');
    memory.relate('nodeA', 'nodeB', 'related_to', 'agentA');

    assert.equal(scheduled.size, 1);

    const pendingFlush = Array.from(scheduled.values())[0];
    await pendingFlush();
    assert.equal(memory.persistenceStatus().dirty, false);
    assert.equal(fs.existsSync(file), true);
});

test('createMemoryStore throws when SQLite file path is inaccessible', () => {
    const parentFile = tempPath('not-a-directory');
    fs.writeFileSync(parentFile, 'blocking parent directory creation', 'utf8');
    const file = path.join(parentFile, 'memory.db');

    assert.throws(
        () => createMemoryStore({ persistence: { file } }),
        /Failed to load memory persistence file/,
    );
});

test('flushSync marks store as not dirty and data persists', () => {
    const file = tempPath('memory.db');
    const memory = createMemoryStore({ persistence: { file } });

    memory.set('nodeA', 'A', 'agentA', { summary: 'Node A', importance: 4 });
    assert.equal(memory.flushSync(), true);
    assert.equal(memory.persistenceStatus().dirty, false);

    const restored = createMemoryStore({ persistence: { file } });
    assert.equal(restored.get('nodeA').summary, 'Node A');
    assert.equal(restored.map('nodeA', { depth: 1, limit: 10 }).edges.length, 0);
});

test('search returns metadata-only matches sorted by importance, recency, then key', () => {
    const memory = createTimedStore();

    memory.set('alpha', { secret: 1 }, 'agentA', { summary: 'alpha summary', tags: ['x'], importance: 5 });
    memory.set('bravo', { secret: 2 }, 'agentA', { summary: 'bravo summary', tags: ['x'], importance: 9 });
    memory.set('charlie', { secret: 3 }, 'agentA', { summary: 'charlie summary', tags: ['x'], importance: 5 });
    memory.set('delta', { secret: 4 }, 'agentA', { summary: 'delta summary', tags: ['y'], importance: 9 });

    const result = memory.search({ tags: ['x'] });

    assert.equal(result.total, 3);
    assert.equal(result.results.length, 3);
    assert.deepEqual(result.results.map((r) => r.key), ['bravo', 'charlie', 'alpha']);
    for (const record of result.results) {
        assert.equal(Object.prototype.hasOwnProperty.call(record, 'value'), false);
        assert.ok(record.summary);
    }
});

test('search applies limit but reports pre-limit total', () => {
    const memory = createTimedStore();

    for (const key of ['k1', 'k2', 'k3', 'k4', 'k5']) {
        memory.set(key, key, 'agentA', { summary: key, tags: ['x'], importance: 5 });
    }

    const result = memory.search({ tags: ['x'], limit: 2 });
    assert.equal(result.results.length, 2);
    assert.equal(result.total, 5);
});

test('search query is case-insensitive across key, summary, and tags', () => {
    const memory = createTimedStore();

    memory.set('AlphaKey', 'value-a', 'agentA', { summary: 'plain summary', tags: ['t1'], importance: 3 });
    memory.set('regular', 'value-b', 'agentA', { summary: 'Has SPECIAL summary', tags: ['t2'], importance: 3 });
    memory.set('plain', 'value-c', 'agentA', { summary: 'no match', tags: ['Findable'], importance: 3 });

    const byKey = memory.search({ query: 'alpha' });
    assert.deepEqual(byKey.results.map((r) => r.key), ['AlphaKey']);

    const bySummary = memory.search({ query: 'special' });
    assert.deepEqual(bySummary.results.map((r) => r.key), ['regular']);

    const byTag = memory.search({ query: 'findable' });
    assert.deepEqual(byTag.results.map((r) => r.key), ['plain']);
});

test('search requires ALL provided tags (AND semantics)', () => {
    const memory = createTimedStore();

    memory.set('both', 'b', 'agentA', { summary: 'both', tags: ['a', 'b'], importance: 5 });
    memory.set('only-a', 'a', 'agentA', { summary: 'only a', tags: ['a'], importance: 5 });
    memory.set('only-b', 'b', 'agentA', { summary: 'only b', tags: ['b'], importance: 5 });

    const result = memory.search({ tags: ['a', 'b'] });
    assert.equal(result.total, 1);
    assert.deepEqual(result.results.map((r) => r.key), ['both']);
});

test('ttl and expiresAt hide expired entries from read APIs without pruning', () => {
    let currentTime = 1000;
    const memory = createMemoryStore({ clock: () => currentTime });

    memory.set('temporary', 'temp', 'agentA', { summary: 'temp', ttlMs: 100 });
    memory.set('stable', 'stable', 'agentA', { summary: 'stable', tags: ['visible'], importance: 5 });
    assert.equal(memory.get('temporary').expiresAt, 1100);

    currentTime = 1200;
    assert.equal(memory.get('temporary'), null);
    assert.deepEqual(memory.keys(), ['stable']);
    assert.equal(memory.count(), 1);
    assert.equal(memory.expiredCount(), 1);

    const searchResult = memory.search({ query: 'temp' });
    assert.equal(searchResult.total, 0);
    assert.equal(memory.exportState().entries.temporary.value, 'temp');
});

test('map skips expired nodes and phantom edges touching them', () => {
    let currentTime = 1000;
    const memory = createMemoryStore({ clock: () => currentTime });

    memory.set('root', 'root', 'agentA', { summary: 'root' });
    memory.set('expired', 'expired', 'agentA', { summary: 'expired', expiresAt: 1100 });
    memory.set('visible', 'visible', 'agentA', { summary: 'visible' });
    memory.relate('root', 'expired', 'related_to', 'agentA');
    memory.relate('root', 'visible', 'related_to', 'agentA');

    currentTime = 1200;
    const graph = memory.map('root', { depth: 1, limit: 10 });
    assert.deepEqual(graph.nodes.map((node) => node.key), ['root', 'visible']);
    assert.deepEqual(graph.edges.map((edge) => edge.to), ['visible']);
    assert.equal(memory.map('expired', { depth: 1, limit: 10 }), null);
});

test('relate rejects expired endpoints as missing nodes', () => {
    let currentTime = 1000;
    const memory = createMemoryStore({ clock: () => currentTime });

    memory.set('active', 'active', 'agentA');
    memory.set('expired', 'expired', 'agentA', { ttlMs: 50 });
    currentTime = 1100;

    assert.deepEqual(memory.relate('active', 'expired', 'related_to', 'agentA'), {
        ok: false,
        error: 'missing-node',
    });
});

test('touch extends expiry and clears expiry when no expiry fields are provided', () => {
    let currentTime = 1000;
    const memory = createMemoryStore({ clock: () => currentTime });

    memory.set('session', 'work', 'agentA', { ttlMs: 100 });
    assert.equal(memory.get('session').expiresAt, 1100);

    currentTime = 1050;
    const touched = memory.touch('session', 'agentA', { ttlMs: 500 });
    assert.equal(touched.ok, true);
    assert.equal(memory.get('session').expiresAt, 1550);

    memory.touch('session', 'agentA');
    assert.equal(memory.get('session').expiresAt, null);

    currentTime = 10000;
    assert.notEqual(memory.get('session'), null);
});

test('pruneExpired removes expired nodes and cascades edges', () => {
    let currentTime = 1000;
    const memory = createMemoryStore({ clock: () => currentTime });

    memory.set('expired', 'expired', 'agentA', { ttlMs: 10 });
    memory.set('neighbor', 'neighbor', 'agentA');
    memory.set('active', 'active', 'agentA');
    memory.relate('expired', 'neighbor', 'supports', 'agentA');
    memory.relate('neighbor', 'active', 'supports', 'agentA');

    currentTime = 2000;
    const result = memory.pruneExpired();
    assert.deepEqual(result.keys, ['expired']);
    assert.equal(result.count, 1);
    assert.deepEqual(result.removedEdges.map((edge) => edge.from), ['expired']);
    assert.deepEqual(memory.keys().sort(), ['active', 'neighbor']);
    assert.equal(memory.relationCount(), 1);
    assert.equal(memory.expiryStatus().lastPrunedAt, 2000);
});

test('persistence saves and reloads expiresAt', async () => {
    const file = tempPath('memory.db');
    const memory = createMemoryStore({
        clock: () => 1000,
        persistence: { file },
    });

    memory.set('temporary', 'temp', 'agentA', { expiresAt: 5000 });
    await memory.flush();

    const restored = createMemoryStore({
        clock: () => 2000,
        persistence: { file },
    });
    assert.equal(restored.get('temporary').expiresAt, 5000);
});

function createTimedStoreWithPersistence(file) {
    let time = 100;
    return createMemoryStore({
        now() {
            time += 100;
            return time;
        },
        persistence: { file },
    });
}
