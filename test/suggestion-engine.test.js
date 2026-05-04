const assert = require('node:assert/strict');
const test = require('node:test');

const { DAY_MS } = require('../src/suggestion-ranking');
const { createSuggestionEngine } = require('../src/suggestion-engine');

function createScheduler() {
    const scheduled = new Map();
    let nextId = 1;

    return {
        scheduled,
        scheduler: {
            setTimeout(fn, ms) {
                const id = nextId;
                nextId += 1;
                scheduled.set(id, { fn, ms });
                return id;
            },
            clearTimeout(id) {
                scheduled.delete(id);
            },
        },
        async runNext() {
            const next = scheduled.entries().next().value;
            assert.ok(next, 'expected a scheduled task');
            const [id, task] = next;
            scheduled.delete(id);
            return task.fn();
        },
    };
}

function createKeywordEmbedder() {
    const calls = [];
    let disposed = false;

    return {
        modelId: 'fake-keyword-embedder',
        calls,
        async embed(text) {
            calls.push(text);
            const lower = text.toLowerCase();
            if (lower.includes('database')) return [1, 0, 0];
            if (lower.includes('architecture')) return [0, 1, 0];
            if (lower.includes('refactor')) return [0, 0, 1];
            return [0, 0, 0];
        },
        status() {
            return { modelId: 'fake-keyword-embedder', loaded: true };
        },
        async dispose() {
            disposed = true;
        },
        isDisposed() {
            return disposed;
        },
    };
}

test('suggestion queue debounces updates and coalesces by key', async () => {
    let currentTime = 1000;
    const embedder = createKeywordEmbedder();
    const { scheduler, scheduled, runNext } = createScheduler();
    const engine = createSuggestionEngine({
        embedder,
        scheduler,
        clock: () => currentTime,
        debounceMs: 500,
    });

    await engine.upsertMemory('memory.same', {
        summary: 'old database note',
        tags: ['old'],
        importance: 5,
        updatedAt: currentTime,
    });
    await engine.upsertMemory('memory.same', {
        summary: 'latest database note',
        tags: ['new'],
        importance: 5,
        updatedAt: currentTime,
    });

    assert.equal(scheduled.size, 1);
    assert.equal(engine.status().queuedUpdateCount, 1);

    await runNext();

    assert.equal(embedder.calls.length, 1);
    assert.equal(embedder.calls[0].includes('latest database note'), true);
    assert.equal(engine.status().queuedUpdateCount, 0);
    assert.equal(engine.status().activeIndexedCount, 1);

    const suggestions = await engine.suggest({ context: 'database task' });
    assert.deepEqual(suggestions.map((suggestion) => suggestion.key), ['memory.same']);
    assert.deepEqual(suggestions[0].tags, ['new']);
});

test('remove tombstones delete records from the active suggestion index', async () => {
    const embedder = createKeywordEmbedder();
    const { scheduler, runNext } = createScheduler();
    const engine = createSuggestionEngine({
        embedder,
        scheduler,
        clock: () => 1000,
    });

    await engine.upsertMemory('memory.keep', {
        summary: 'database durable',
        importance: 5,
        updatedAt: 1000,
    });
    await engine.upsertMemory('memory.remove', {
        summary: 'database stale',
        importance: 5,
        updatedAt: 1000,
    });
    await runNext();
    assert.equal(engine.status().activeIndexedCount, 2);

    await engine.removeMemory('memory.remove');
    await runNext();

    const suggestions = await engine.suggest({ context: 'database task', limit: 10 });
    assert.deepEqual(suggestions.map((suggestion) => suggestion.key), ['memory.keep']);
});

test('ranking uses semantic match, importance, recency decay, tags, and active archive filtering', async () => {
    let currentTime = 100 * DAY_MS;
    const embedder = createKeywordEmbedder();
    const { scheduler, runNext } = createScheduler();
    const engine = createSuggestionEngine({
        embedder,
        scheduler,
        clock: () => currentTime,
        ranking: {
            minActiveImportance: 4,
            staleAfterMs: 30 * DAY_MS,
        },
    });

    await engine.upsertMemory('database.old-low', {
        summary: 'database old low importance',
        tags: ['database'],
        importance: 1,
        updatedAt: currentTime - (60 * DAY_MS),
    });
    await engine.upsertMemory('database.old-important', {
        summary: 'database old important',
        tags: ['database'],
        importance: 8,
        updatedAt: currentTime - (60 * DAY_MS),
    });
    await engine.upsertMemory('database.fresh-low', {
        summary: 'database fresh low',
        tags: ['database'],
        importance: 1,
        updatedAt: currentTime,
    });
    await engine.upsertMemory('architecture.fresh', {
        summary: 'architecture fresh',
        tags: ['architecture'],
        importance: 9,
        updatedAt: currentTime,
    });
    await runNext();

    const databaseSuggestions = await engine.suggest({
        context: 'database migration',
        tags: ['database'],
        limit: 10,
    });

    assert.deepEqual(
        databaseSuggestions.map((suggestion) => suggestion.key),
        ['database.fresh-low', 'database.old-important'],
    );
    assert.equal(databaseSuggestions.some((suggestion) => suggestion.key === 'database.old-low'), false);
    assert.equal(databaseSuggestions[1].reasons.includes('high-importance'), true);

    const architectureSuggestions = await engine.suggest({
        context: 'architecture review',
        tags: ['architecture'],
    });
    assert.deepEqual(architectureSuggestions.map((suggestion) => suggestion.key), ['architecture.fresh']);
});

test('close clears queued work and disposes the embedder', async () => {
    const embedder = createKeywordEmbedder();
    const { scheduler, scheduled } = createScheduler();
    const engine = createSuggestionEngine({
        embedder,
        scheduler,
        clock: () => 1000,
    });

    await engine.upsertMemory('memory.pending', {
        summary: 'database pending',
        importance: 5,
        updatedAt: 1000,
    });
    assert.equal(scheduled.size, 1);

    await engine.close();

    assert.equal(scheduled.size, 0);
    assert.equal(engine.status().queuedUpdateCount, 0);
    assert.equal(embedder.isDisposed(), true);
});
