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
    const file = tempPath('memory.json');
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

test('persistence rejects invalid JSON at startup', () => {
    const file = tempPath('memory.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{bad json', 'utf8');

    assert.throws(
        () => createMemoryStore({ persistence: { file } }),
        /Failed to load memory persistence file/,
    );
});

test('flush persists entries and edges, and restart reloads them', async () => {
    const file = tempPath('memory.json');
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
    const file = tempPath('memory.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
        entries: {
            nodeA: {
                value: 'A',
                summary: 'A',
                tags: [],
                importance: 1,
                updatedAt: 100,
                updatedBy: 'agentA',
            },
        },
        edges: [
            {
                from: 'nodeA',
                to: 'missing',
                relation: 'depends_on',
                reason: 'dangling',
                weight: 0.5,
                updatedAt: 200,
                updatedBy: 'agentA',
            },
        ],
    }), 'utf8');

    const memory = createMemoryStore({ persistence: { file } });
    assert.equal(memory.relationCount(), 0);
    assert.deepEqual(memory.map('nodeA', { depth: 1, limit: 10 }).edges, []);
});

test('cascade delete persists removed edges', async () => {
    const file = tempPath('memory.json');
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
    const file = tempPath('memory.json');
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

test('async flush failure keeps dirty state and records the error', async () => {
    const parentFile = tempPath('not-a-directory');
    fs.writeFileSync(parentFile, 'blocking parent directory creation', 'utf8');
    const file = path.join(parentFile, 'memory.json');
    const memory = createMemoryStore({ persistence: { file } });
    const originalError = console.error;
    console.error = () => {};

    try {
        memory.set('nodeA', 'A', 'agentA');
        assert.equal(await memory.flush(), false);
        const status = memory.persistenceStatus();
        assert.equal(status.dirty, true);
        assert.equal(typeof status.lastFlushError, 'string');
        assert.notEqual(status.lastFlushError.length, 0);
    } finally {
        console.error = originalError;
    }
});

test('flushSync writes a valid atomic snapshot', () => {
    const file = tempPath('memory.json');
    const memory = createMemoryStore({ persistence: { file } });

    memory.set('nodeA', 'A', 'agentA', { summary: 'Node A', importance: 4 });
    assert.equal(memory.flushSync(), true);

    const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(persisted.entries.nodeA.summary, 'Node A');
    assert.deepEqual(persisted.edges, []);
    assert.equal(memory.persistenceStatus().dirty, false);
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
