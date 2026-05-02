const assert = require('node:assert/strict');
const test = require('node:test');

const { createMemoryStore } = require('../src/memory-store');

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
