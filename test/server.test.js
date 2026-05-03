const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const WebSocket = require('ws');

const { createSharedMemoryServer } = require('../src/server');

function tempPath(name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-memory-server-test-'));
    return path.join(dir, name);
}

async function startServer(options = {}) {
    const appServer = createSharedMemoryServer(options);

    await new Promise((resolve) => {
        appServer.listen(0, '127.0.0.1', resolve);
    });

    const { port } = appServer.server.address();
    return {
        appServer,
        httpUrl: `http://127.0.0.1:${port}`,
        wsUrl: `ws://127.0.0.1:${port}`,
    };
}

async function connectClient(url) {
    const ws = new WebSocket(url);
    const messages = [];
    const waiters = [];

    ws.on('message', (raw) => {
        const data = JSON.parse(raw.toString());
        messages.push(data);

        for (let index = waiters.length - 1; index >= 0; index -= 1) {
            const waiter = waiters[index];
            if (waiter.predicate(data)) {
                clearTimeout(waiter.timeout);
                waiters.splice(index, 1);
                waiter.resolve(data);
            }
        }
    });

    await new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
    });

    return {
        ws,
        messages,
        send(payload) {
            ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
        },
        waitFor(predicate, timeoutMs = 1000) {
            const existing = messages.find(predicate);
            if (existing) return Promise.resolve(existing);

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Timed out waiting for WebSocket message'));
                }, timeoutMs);

                waiters.push({ predicate, resolve, timeout });
            });
        },
        close() {
            if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
            return new Promise((resolve) => {
                ws.once('close', resolve);
                ws.close();
            });
        },
    };
}

test('register, set, get, list, and status remain compatible', async () => {
    const { appServer, httpUrl, wsUrl } = await startServer();

    try {
        const client = await connectClient(wsUrl);
        await client.waitFor((message) => message.type === 'welcome');

        client.send({ type: 'register', agentId: 'agentA' });
        assert.deepEqual(await client.waitFor((message) => message.type === 'registered'), {
            type: 'registered',
            agentId: 'agentA',
        });

        client.send({ type: 'set', key: 'greeting', value: 'hello' });
        assert.deepEqual(await client.waitFor((message) => message.type === 'ok'), {
            type: 'ok',
            action: 'set',
            key: 'greeting',
        });

        client.send({ type: 'get', key: 'greeting' });
        const result = await client.waitFor((message) => message.type === 'result');
        assert.equal(result.key, 'greeting');
        assert.equal(result.entry.value, 'hello');
        assert.equal(result.entry.updatedBy, 'agentA');
        assert.equal(typeof result.entry.updatedAt, 'number');

        client.send({ type: 'list' });
        assert.deepEqual(await client.waitFor((message) => message.type === 'list'), {
            type: 'list',
            agents: ['agentA'],
            memoryKeys: ['greeting'],
        });

        const status = await fetch(`${httpUrl}/status`).then((response) => response.json());
        assert.deepEqual(status, {
            agents: ['agentA'],
            connectedAgents: ['agentA'],
            memoryKeys: ['greeting'],
            memoryCount: 1,
            relationCount: 0,
            expiredMemoryCount: 0,
            pruneIntervalMs: 600000,
            lastPrunedAt: null,
            persistence: {
                enabled: false,
                file: null,
                dirty: false,
                lastLoadedAt: null,
                lastFlushedAt: null,
                lastFlushError: null,
            },
        });
    } finally {
        await appServer.close();
    }
});

test('status reports enabled persistence and close flushes pending state', async () => {
    const file = tempPath('memory.json');
    const { appServer, httpUrl, wsUrl } = await startServer({
        persistence: { file, debounceMs: 10000 },
    });

    try {
        const client = await connectClient(wsUrl);
        await client.waitFor((message) => message.type === 'welcome');
        client.send({ type: 'register', agentId: 'agentA' });
        await client.waitFor((message) => message.type === 'registered');
        client.send({ type: 'set', key: 'durable', value: 'saved', summary: 'Saved memory' });
        await client.waitFor((message) => message.type === 'ok' && message.key === 'durable');

        const status = await fetch(`${httpUrl}/status`).then((response) => response.json());
        assert.equal(status.persistence.enabled, true);
        assert.equal(status.persistence.file, file);
        assert.equal(status.persistence.dirty, true);
        assert.equal(typeof status.persistence.lastLoadedAt, 'number');
        assert.equal(status.persistence.lastFlushedAt, null);
    } finally {
        await appServer.close();
    }

    const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(persisted.entries.durable.summary, 'Saved memory');
});

test('auth disabled keeps existing flow open and accepts auth as no-op', async () => {
    const { appServer, wsUrl } = await startServer();

    try {
        const client = await connectClient(wsUrl);
        await client.waitFor((message) => message.type === 'welcome');

        client.send({ type: 'auth', requestId: 'auth-disabled' });
        assert.deepEqual(await client.waitFor((message) => message.type === 'authenticated'), {
            type: 'authenticated',
            requestId: 'auth-disabled',
        });

        client.send({ type: 'register', agentId: 'agentA' });
        assert.deepEqual(await client.waitFor((message) => message.type === 'registered'), {
            type: 'registered',
            agentId: 'agentA',
        });
    } finally {
        await appServer.close();
    }
});

test('auth enabled blocks protected commands until valid auth unlocks the socket', async () => {
    const { appServer, wsUrl } = await startServer({ authToken: 'secret' });

    try {
        const client = await connectClient(wsUrl);
        await client.waitFor((message) => message.type === 'welcome');

        client.send({ type: 'set', key: 'blocked', value: true, requestId: 'blocked-1' });
        assert.deepEqual(await client.waitFor((message) => message.message === 'unauthorized'), {
            type: 'error',
            message: 'unauthorized',
            requestId: 'blocked-1',
        });

        client.send({ type: 'auth', token: 'secret', requestId: 'auth-ok' });
        assert.deepEqual(await client.waitFor((message) => message.type === 'authenticated'), {
            type: 'authenticated',
            requestId: 'auth-ok',
        });

        client.send({ type: 'set', key: 'allowed', value: true, requestId: 'allowed-1' });
        assert.deepEqual(await client.waitFor((message) => message.type === 'ok'), {
            type: 'ok',
            action: 'set',
            key: 'allowed',
            requestId: 'allowed-1',
        });
    } finally {
        await appServer.close();
    }
});

test('invalid or missing auth token returns unauthorized but allows later recovery', async () => {
    const { appServer, wsUrl } = await startServer({ authToken: 'secret' });

    try {
        const client = await connectClient(wsUrl);
        await client.waitFor((message) => message.type === 'welcome');

        client.send({ type: 'auth', requestId: 'missing-token' });
        assert.deepEqual(await client.waitFor((message) => message.requestId === 'missing-token'), {
            type: 'error',
            message: 'unauthorized',
            requestId: 'missing-token',
        });

        client.send({ type: 'auth', token: 123, requestId: 'bad-token-type' });
        assert.deepEqual(await client.waitFor((message) => message.requestId === 'bad-token-type'), {
            type: 'error',
            message: 'unauthorized',
            requestId: 'bad-token-type',
        });

        client.send({ type: 'auth', token: 'wrong', requestId: 'wrong-token' });
        assert.deepEqual(await client.waitFor((message) => message.requestId === 'wrong-token'), {
            type: 'error',
            message: 'unauthorized',
            requestId: 'wrong-token',
        });

        client.send({ type: 'auth', token: 'secret', requestId: 'recovered' });
        assert.deepEqual(await client.waitFor((message) => message.type === 'authenticated'), {
            type: 'authenticated',
            requestId: 'recovered',
        });

        client.send({ type: 'register', agentId: 'agentA', requestId: 'register-after-auth' });
        assert.deepEqual(await client.waitFor((message) => message.type === 'registered'), {
            type: 'registered',
            agentId: 'agentA',
            requestId: 'register-after-auth',
        });
    } finally {
        await appServer.close();
    }
});

test('status endpoint requires bearer token only when auth is enabled', async () => {
    const openServer = await startServer();

    try {
        const openStatus = await fetch(`${openServer.httpUrl}/status`);
        assert.equal(openStatus.status, 200);
    } finally {
        await openServer.appServer.close();
    }

    const lockedServer = await startServer({ authToken: 'secret' });

    try {
        const noHeader = await fetch(`${lockedServer.httpUrl}/status`);
        assert.equal(noHeader.status, 401);
        assert.deepEqual(await noHeader.json(), { error: 'unauthorized' });

        const wrongHeader = await fetch(`${lockedServer.httpUrl}/status`, {
            headers: { Authorization: 'Bearer wrong' },
        });
        assert.equal(wrongHeader.status, 401);
        assert.deepEqual(await wrongHeader.json(), { error: 'unauthorized' });

        const goodHeader = await fetch(`${lockedServer.httpUrl}/status`, {
            headers: { Authorization: 'Bearer secret' },
        });
        assert.equal(goodHeader.status, 200);
        const body = await goodHeader.json();
        assert.deepEqual(body.memoryKeys, []);
        assert.equal(body.persistence.enabled, false);
    } finally {
        await lockedServer.appServer.close();
    }
});

test('set supports metadata and fallback summaries', async () => {
    const { appServer, wsUrl } = await startServer();

    try {
        const client = await connectClient(wsUrl);
        await client.waitFor((message) => message.type === 'welcome');
        client.send({ type: 'register', agentId: 'agentA' });
        await client.waitFor((message) => message.type === 'registered');

        client.send({
            type: 'set',
            key: 'project.architecture',
            value: 'server modules',
            summary: 'Server is split into focused modules.',
            tags: ['architecture', 'server'],
            importance: 8,
        });
        await client.waitFor((message) => message.type === 'ok' && message.key === 'project.architecture');

        client.send({ type: 'get', key: 'project.architecture' });
        const metadataResult = await client.waitFor(
            (message) => message.type === 'result' && message.key === 'project.architecture',
        );
        assert.equal(metadataResult.entry.summary, 'Server is split into focused modules.');
        assert.deepEqual(metadataResult.entry.tags, ['architecture', 'server']);
        assert.equal(metadataResult.entry.importance, 8);

        client.send({ type: 'set', key: 'fallback', value: '  noisy\n\n summary\ttext  ' });
        await client.waitFor((message) => message.type === 'ok' && message.key === 'fallback');
        client.send({ type: 'get', key: 'fallback' });
        const fallbackResult = await client.waitFor(
            (message) => message.type === 'result' && message.key === 'fallback',
        );
        assert.equal(fallbackResult.entry.summary, 'noisy summary text');

        client.send({ type: 'set', key: 'bad', value: true, importance: 11 });
        assert.deepEqual(await client.waitFor((message) => message.message === 'invalid-importance'), {
            type: 'error',
            message: 'invalid-importance',
        });
    } finally {
        await appServer.close();
    }
});

test('relate creates and updates edges with exactly-once incident notifications', async () => {
    const { appServer, wsUrl } = await startServer();

    try {
        const actor = await connectClient(wsUrl);
        await actor.waitFor((message) => message.type === 'welcome');
        actor.send({ type: 'register', agentId: 'actor' });
        await actor.waitFor((message) => message.type === 'registered');

        const subscriber = await connectClient(wsUrl);
        await subscriber.waitFor((message) => message.type === 'welcome');
        subscriber.send({ type: 'register', agentId: 'subscriber' });
        await subscriber.waitFor((message) => message.type === 'registered');

        for (const key of ['project.database', 'project.architecture']) {
            actor.send({ type: 'set', key, value: key, summary: key, importance: 5 });
            await actor.waitFor((message) => message.type === 'ok' && message.key === key);
            subscriber.send({ type: 'subscribe', key });
            await subscriber.waitFor((message) => message.type === 'subscribed' && message.key === key);
        }

        const beforeCreate = subscriber.messages.filter((message) => message.type === 'relation-update').length;
        actor.send({
            type: 'relate',
            from: 'project.database',
            to: 'project.architecture',
            relation: 'depends_on',
            reason: 'Database decisions affect architecture.',
            weight: 0.8,
        });

        const createAck = await actor.waitFor((message) => message.type === 'related');
        assert.equal(createAck.action, 'created');
        assert.equal(createAck.edge.reason, 'Database decisions affect architecture.');
        assert.equal(createAck.edge.weight, 0.8);

        const createNotice = await subscriber.waitFor(
            (message) => message.type === 'relation-update' && message.action === 'created',
        );
        assert.deepEqual(createNotice.keys, ['project.database', 'project.architecture']);
        assert.equal(createNotice.edge.relation, 'depends_on');

        await new Promise((resolve) => setTimeout(resolve, 50));
        const afterCreate = subscriber.messages.filter((message) => message.type === 'relation-update').length;
        assert.equal(afterCreate - beforeCreate, 1);

        actor.send({
            type: 'relate',
            from: 'project.database',
            to: 'project.architecture',
            relation: 'depends_on',
            reason: 'Updated reason.',
            weight: 0.4,
        });

        const updateAck = await actor.waitFor(
            (message) => message.type === 'related' && message.action === 'updated',
        );
        assert.equal(updateAck.edge.reason, 'Updated reason.');
        assert.equal(updateAck.edge.weight, 0.4);
        await subscriber.waitFor((message) => message.type === 'relation-update' && message.action === 'updated');
    } finally {
        await appServer.close();
    }
});

test('relation validation rejects self edges and missing nodes', async () => {
    const { appServer, wsUrl } = await startServer();

    try {
        const client = await connectClient(wsUrl);
        await client.waitFor((message) => message.type === 'welcome');
        client.send({ type: 'register', agentId: 'agentA' });
        await client.waitFor((message) => message.type === 'registered');

        client.send({ type: 'set', key: 'nodeA', value: 'A' });
        await client.waitFor((message) => message.type === 'ok' && message.key === 'nodeA');

        client.send({ type: 'relate', from: 'nodeA', to: 'nodeA', relation: 'related_to' });
        assert.deepEqual(await client.waitFor((message) => message.message === 'self-relation-not-allowed'), {
            type: 'error',
            message: 'self-relation-not-allowed',
        });

        client.send({ type: 'relate', from: 'nodeA', to: 'missing', relation: 'related_to' });
        assert.deepEqual(await client.waitFor((message) => message.message === 'missing-node'), {
            type: 'error',
            message: 'missing-node',
        });

        client.send({ type: 'relate', from: 'nodeA', to: 'missing', relation: 'bad_relation' });
        assert.deepEqual(await client.waitFor((message) => message.message === 'invalid-relation'), {
            type: 'error',
            message: 'invalid-relation',
        });
    } finally {
        await appServer.close();
    }
});

test('unrelate and delete emit distinct graph lifecycle notifications', async () => {
    const { appServer, httpUrl, wsUrl } = await startServer();

    try {
        const actor = await connectClient(wsUrl);
        await actor.waitFor((message) => message.type === 'welcome');
        actor.send({ type: 'register', agentId: 'actor' });
        await actor.waitFor((message) => message.type === 'registered');

        const subscriber = await connectClient(wsUrl);
        await subscriber.waitFor((message) => message.type === 'welcome');
        subscriber.send({ type: 'register', agentId: 'subscriber' });
        await subscriber.waitFor((message) => message.type === 'registered');

        for (const key of ['nodeA', 'nodeB', 'nodeC']) {
            actor.send({ type: 'set', key, value: key, summary: key });
            await actor.waitFor((message) => message.type === 'ok' && message.key === key);
            subscriber.send({ type: 'subscribe', key });
            await subscriber.waitFor((message) => message.type === 'subscribed' && message.key === key);
        }

        actor.send({ type: 'relate', from: 'nodeA', to: 'nodeB', relation: 'supports' });
        await actor.waitFor((message) => message.type === 'related' && message.action === 'created');
        await subscriber.waitFor((message) => message.type === 'relation-update' && message.action === 'created');

        actor.send({ type: 'unrelate', from: 'nodeA', to: 'nodeB', relation: 'supports' });
        assert.deepEqual(await actor.waitFor((message) => message.type === 'unrelated'), {
            type: 'unrelated',
            from: 'nodeA',
            to: 'nodeB',
            relation: 'supports',
        });
        await subscriber.waitFor((message) => message.type === 'relation-update' && message.action === 'deleted');

        actor.send({ type: 'relate', from: 'nodeA', to: 'nodeB', relation: 'supports' });
        await actor.waitFor((message) => message.type === 'related' && message.action === 'created');
        actor.send({ type: 'relate', from: 'nodeC', to: 'nodeA', relation: 'depends_on' });
        await actor.waitFor((message) => message.type === 'related' && message.edge.from === 'nodeC');

        actor.send({ type: 'delete', key: 'nodeA' });
        assert.deepEqual(await actor.waitFor((message) => message.type === 'deleted'), {
            type: 'deleted',
            key: 'nodeA',
            removed: true,
        });
        await subscriber.waitFor(
            (message) => message.type === 'update' && message.key === 'nodeA' && message.action === 'deleted',
        );

        const cascadeNotices = [];
        while (cascadeNotices.length < 2) {
            const notice = await subscriber.waitFor(
                (message) => message.type === 'relation-update' && message.action === 'cascade-deleted',
            );
            cascadeNotices.push(`${notice.edge.from}:${notice.edge.relation}:${notice.edge.to}`);
            subscriber.messages.splice(subscriber.messages.indexOf(notice), 1);
        }
        assert.deepEqual(cascadeNotices.sort(), ['nodeA:supports:nodeB', 'nodeC:depends_on:nodeA']);

        const status = await fetch(`${httpUrl}/status`).then((response) => response.json());
        assert.equal(status.memoryCount, 2);
        assert.equal(status.relationCount, 0);
    } finally {
        await appServer.close();
    }
});

test('subscriptions receive current value and later updates', async () => {
    const { appServer, wsUrl } = await startServer();

    try {
        const writer = await connectClient(wsUrl);
        await writer.waitFor((message) => message.type === 'welcome');
        writer.send({ type: 'register', agentId: 'writer' });
        await writer.waitFor((message) => message.type === 'registered');
        writer.send({ type: 'set', key: 'greeting', value: 'first' });
        await writer.waitFor((message) => message.type === 'ok');

        const reader = await connectClient(wsUrl);
        await reader.waitFor((message) => message.type === 'welcome');
        reader.send({ type: 'register', agentId: 'reader' });
        await reader.waitFor((message) => message.type === 'registered');
        reader.send({ type: 'subscribe', key: 'greeting' });

        assert.deepEqual(await reader.waitFor((message) => message.type === 'subscribed'), {
            type: 'subscribed',
            key: 'greeting',
        });

        const currentUpdate = await reader.waitFor((message) => message.type === 'update');
        assert.equal(currentUpdate.entry.value, 'first');

        writer.send({ type: 'set', key: 'greeting', value: 'second' });
        const laterUpdate = await reader.waitFor(
            (message) => message.type === 'update' && message.entry.value === 'second',
        );
        assert.equal(laterUpdate.entry.updatedBy, 'writer');

        reader.send({ type: 'unsubscribe', key: 'greeting' });
        assert.deepEqual(await reader.waitFor((message) => message.type === 'unsubscribed'), {
            type: 'unsubscribed',
            key: 'greeting',
        });
    } finally {
        await appServer.close();
    }
});

test('invalid messages return protocol errors instead of crashing', async () => {
    const { appServer, wsUrl } = await startServer();

    try {
        const client = await connectClient(wsUrl);
        await client.waitFor((message) => message.type === 'welcome');

        client.send('not-json');
        assert.deepEqual(await client.waitFor((message) => message.message === 'invalid-json'), {
            type: 'error',
            message: 'invalid-json',
        });

        client.send('null');
        assert.deepEqual(await client.waitFor((message) => message.message === 'invalid-message'), {
            type: 'error',
            message: 'invalid-message',
        });

        client.send({ type: 'unknown' });
        assert.deepEqual(await client.waitFor((message) => message.message === 'unknown-type'), {
            type: 'error',
            message: 'unknown-type',
        });

        client.send({ type: 'set' });
        assert.deepEqual(await client.waitFor((message) => message.message === 'missing-key'), {
            type: 'error',
            message: 'missing-key',
        });

        client.send({ type: 'link', target: '' });
        assert.deepEqual(await client.waitFor((message) => message.message === 'missing-target'), {
            type: 'error',
            message: 'missing-target',
        });
    } finally {
        await appServer.close();
    }
});

test('duplicate live agent IDs are rejected and offline IDs can be reclaimed', async () => {
    const { appServer, wsUrl } = await startServer();

    try {
        const first = await connectClient(wsUrl);
        await first.waitFor((message) => message.type === 'welcome');
        first.send({ type: 'register', agentId: 'agentX' });
        await first.waitFor((message) => message.type === 'registered' && message.agentId === 'agentX');

        const duplicate = await connectClient(wsUrl);
        await duplicate.waitFor((message) => message.type === 'welcome');
        duplicate.send({ type: 'register', agentId: 'agentX' });
        assert.deepEqual(await duplicate.waitFor((message) => message.message === 'duplicate-agent'), {
            type: 'error',
            message: 'duplicate-agent',
        });

        await first.close();

        const reconnect = await connectClient(wsUrl);
        await reconnect.waitFor((message) => message.type === 'welcome');
        reconnect.send({ type: 'register', agentId: 'agentX' });
        assert.deepEqual(
            await reconnect.waitFor((message) => message.type === 'registered' && message.agentId === 'agentX'),
            { type: 'registered', agentId: 'agentX' },
        );
    } finally {
        await appServer.close();
    }
});

test('link, unlink, and offline linked targets are safe', async () => {
    const { appServer, wsUrl } = await startServer();

    try {
        const agent = await connectClient(wsUrl);
        await agent.waitFor((message) => message.type === 'welcome');
        agent.send({ type: 'register', agentId: 'agentA' });
        await agent.waitFor((message) => message.type === 'registered');

        agent.send({ type: 'link', target: 'offlineTarget' });
        assert.deepEqual(await agent.waitFor((message) => message.target === 'offlineTarget'), {
            type: 'linked',
            target: 'offlineTarget',
        });

        agent.send({ type: 'set', key: 'safe', value: true });
        assert.deepEqual(await agent.waitFor((message) => message.type === 'ok' && message.key === 'safe'), {
            type: 'ok',
            action: 'set',
            key: 'safe',
        });

        agent.send({ type: 'unlink', target: 'offlineTarget' });
        assert.deepEqual(await agent.waitFor((message) => message.type === 'unlinked'), {
            type: 'unlinked',
            target: 'offlineTarget',
        });
    } finally {
        await appServer.close();
    }
});

test('search command returns metadata-only filtered results', async () => {
    const { appServer, wsUrl } = await startServer();

    try {
        const client = await connectClient(wsUrl);
        await client.waitFor((message) => message.type === 'welcome');
        client.send({ type: 'register', agentId: 'agentA' });
        await client.waitFor((message) => message.type === 'registered');

        client.send({ type: 'set', key: 'high-x', value: 'hidden-1', tags: ['x'], importance: 7 });
        await client.waitFor((message) => message.type === 'ok' && message.key === 'high-x');
        client.send({ type: 'set', key: 'low-x', value: 'hidden-2', tags: ['x'], importance: 2 });
        await client.waitFor((message) => message.type === 'ok' && message.key === 'low-x');
        client.send({ type: 'set', key: 'high-y', value: 'hidden-3', tags: ['y'], importance: 8 });
        await client.waitFor((message) => message.type === 'ok' && message.key === 'high-y');

        client.send({ type: 'search', tags: ['x'], minImportance: 5 });
        const result = await client.waitFor((message) => message.type === 'search-result');
        assert.equal(result.total, 1);
        assert.equal(result.results.length, 1);
        assert.equal(result.results[0].key, 'high-x');
        assert.equal(Object.prototype.hasOwnProperty.call(result.results[0], 'value'), false);
    } finally {
        await appServer.close();
    }
});

test('search validates filters and rejects invalid input', async () => {
    const { appServer, wsUrl } = await startServer();

    try {
        const client = await connectClient(wsUrl);
        await client.waitFor((message) => message.type === 'welcome');
        client.send({ type: 'register', agentId: 'agentA' });
        await client.waitFor((message) => message.type === 'registered');

        client.send({ type: 'search' });
        const noFilter = await client.waitFor((message) => message.type === 'error');
        assert.equal(noFilter.message, 'missing-filter');

        client.send({ type: 'search', query: '   ' });
        const blankQuery = await client.waitFor(
            (message) => message.type === 'error' && message.message === 'invalid-query',
        );
        assert.equal(blankQuery.message, 'invalid-query');

        client.send({ type: 'search', minImportance: 99 });
        const badImportance = await client.waitFor(
            (message) => message.type === 'error' && message.message === 'invalid-importance',
        );
        assert.equal(badImportance.message, 'invalid-importance');
    } finally {
        await appServer.close();
    }
});

test('touch and expiry validation use requestId-aware response shapes', async () => {
    let currentTime = 1000;
    const { appServer, wsUrl } = await startServer({
        clock: () => currentTime,
        pruneIntervalMs: 0,
    });

    try {
        const client = await connectClient(wsUrl);
        await client.waitFor((message) => message.type === 'welcome');
        client.send({ type: 'register', agentId: 'agentA' });
        await client.waitFor((message) => message.type === 'registered');

        client.send({ type: 'set', key: 'bad', value: true, ttlMs: 0, requestId: 'bad-ttl' });
        assert.deepEqual(await client.waitFor((message) => message.requestId === 'bad-ttl'), {
            type: 'error',
            message: 'invalid-expiry',
            requestId: 'bad-ttl',
        });

        client.send({
            type: 'set',
            key: 'bad2',
            value: true,
            ttlMs: 100,
            expiresAt: 2000,
            requestId: 'both',
        });
        assert.deepEqual(await client.waitFor((message) => message.requestId === 'both'), {
            type: 'error',
            message: 'invalid-expiry',
            requestId: 'both',
        });

        client.send({ type: 'set', key: 'session', value: 'work', ttlMs: 100, requestId: 'set-session' });
        await client.waitFor((message) => message.type === 'ok' && message.requestId === 'set-session');

        currentTime = 1050;
        client.send({ type: 'touch', key: 'session', ttlMs: 500, requestId: 'touch-extend' });
        const touched = await client.waitFor((message) => message.type === 'touched');
        assert.equal(touched.requestId, 'touch-extend');
        assert.equal(touched.entry.expiresAt, 1550);

        client.send({ type: 'touch', key: 'session', requestId: 'touch-clear' });
        const cleared = await client.waitFor((message) => message.requestId === 'touch-clear');
        assert.equal(cleared.entry.expiresAt, null);
    } finally {
        await appServer.close();
    }
});

test('prune expires nodes and emits expired plus cascade notifications', async () => {
    let currentTime = 1000;
    const { appServer, wsUrl } = await startServer({
        clock: () => currentTime,
        pruneIntervalMs: 0,
    });

    try {
        const client = await connectClient(wsUrl);
        await client.waitFor((message) => message.type === 'welcome');
        client.send({ type: 'register', agentId: 'agentA' });
        await client.waitFor((message) => message.type === 'registered');

        client.send({ type: 'set', key: 'expiring', value: 'gone', ttlMs: 100 });
        await client.waitFor((message) => message.type === 'ok' && message.key === 'expiring');
        client.send({ type: 'set', key: 'neighbor', value: 'stay' });
        await client.waitFor((message) => message.type === 'ok' && message.key === 'neighbor');
        client.send({ type: 'relate', from: 'expiring', to: 'neighbor', relation: 'related_to' });
        await client.waitFor((message) => message.type === 'related');

        client.send({ type: 'subscribe', key: 'expiring' });
        await client.waitFor((message) => message.type === 'subscribed' && message.key === 'expiring');
        await client.waitFor((message) => message.type === 'update' && message.key === 'expiring');
        client.send({ type: 'subscribe', key: 'neighbor' });
        await client.waitFor((message) => message.type === 'subscribed' && message.key === 'neighbor');
        await client.waitFor((message) => message.type === 'update' && message.key === 'neighbor');

        currentTime = 1200;
        client.send({ type: 'prune', requestId: 'prune-1' });
        assert.deepEqual(await client.waitFor((message) => message.type === 'pruned'), {
            type: 'pruned',
            keys: ['expiring'],
            count: 1,
            requestId: 'prune-1',
        });

        const expiredUpdate = await client.waitFor(
            (message) => message.type === 'update' && message.key === 'expiring' && message.action === 'expired',
        );
        assert.equal(expiredUpdate.entry, null);

        const cascade = await client.waitFor(
            (message) => message.type === 'relation-update' && message.action === 'cascade-deleted',
        );
        assert.equal(cascade.edge.from, 'expiring');
        assert.equal(cascade.edge.to, 'neighbor');
    } finally {
        await appServer.close();
    }
});

test('background prune runs through injected scheduler and status exposes expiry fields', async () => {
    let currentTime = 1000;
    const scheduled = new Map();
    let nextId = 1;
    const pruneScheduler = {
        setInterval(fn) {
            const id = nextId;
            nextId += 1;
            scheduled.set(id, fn);
            return id;
        },
        clearInterval(id) {
            scheduled.delete(id);
        },
    };
    const { appServer, httpUrl, wsUrl } = await startServer({
        clock: () => currentTime,
        pruneIntervalMs: 250,
        pruneScheduler,
    });

    try {
        assert.equal(scheduled.size, 1);

        const client = await connectClient(wsUrl);
        await client.waitFor((message) => message.type === 'welcome');
        client.send({ type: 'register', agentId: 'agentA' });
        await client.waitFor((message) => message.type === 'registered');
        client.send({ type: 'set', key: 'expiring', value: 'gone', ttlMs: 100 });
        await client.waitFor((message) => message.type === 'ok' && message.key === 'expiring');
        client.send({ type: 'subscribe', key: 'expiring' });
        await client.waitFor((message) => message.type === 'subscribed' && message.key === 'expiring');
        await client.waitFor((message) => message.type === 'update' && message.key === 'expiring');

        currentTime = 1200;
        const pendingPrune = Array.from(scheduled.values())[0];
        pendingPrune();

        await client.waitFor(
            (message) => message.type === 'update' && message.key === 'expiring' && message.action === 'expired',
        );

        const status = await fetch(`${httpUrl}/status`).then((response) => response.json());
        assert.equal(status.expiredMemoryCount, 0);
        assert.equal(status.pruneIntervalMs, 250);
        assert.equal(status.lastPrunedAt, 1200);
    } finally {
        await appServer.close();
    }
    assert.equal(scheduled.size, 0);
});

test('expired entries are hidden from get, map, and search over websocket', async () => {
    let currentTime = 1000;
    const { appServer, wsUrl } = await startServer({
        clock: () => currentTime,
        pruneIntervalMs: 0,
    });

    try {
        const client = await connectClient(wsUrl);
        await client.waitFor((message) => message.type === 'welcome');
        client.send({ type: 'register', agentId: 'agentA' });
        await client.waitFor((message) => message.type === 'registered');

        client.send({ type: 'set', key: 'root', value: 'root', summary: 'root' });
        await client.waitFor((message) => message.type === 'ok' && message.key === 'root');
        client.send({ type: 'set', key: 'old', value: 'old', summary: 'old memory', ttlMs: 100 });
        await client.waitFor((message) => message.type === 'ok' && message.key === 'old');
        client.send({ type: 'relate', from: 'root', to: 'old', relation: 'related_to' });
        await client.waitFor((message) => message.type === 'related');

        currentTime = 1200;
        client.send({ type: 'get', key: 'old', requestId: 'get-old' });
        assert.deepEqual(await client.waitFor((message) => message.requestId === 'get-old'), {
            type: 'result',
            key: 'old',
            entry: null,
            requestId: 'get-old',
        });

        client.send({ type: 'map', key: 'root', depth: 1, limit: 10, requestId: 'map-root' });
        const graph = await client.waitFor((message) => message.requestId === 'map-root');
        assert.deepEqual(graph.nodes.map((node) => node.key), ['root']);
        assert.deepEqual(graph.edges, []);

        client.send({ type: 'search', query: 'old', requestId: 'search-old' });
        const search = await client.waitFor((message) => message.requestId === 'search-old');
        assert.equal(search.total, 0);
        assert.deepEqual(search.results, []);
    } finally {
        await appServer.close();
    }
});

test('requestId echoes on success acks across every command type', async () => {
    const { appServer, wsUrl } = await startServer();

    try {
        const client = await connectClient(wsUrl);
        await client.waitFor((message) => message.type === 'welcome');

        client.send({ type: 'register', agentId: 'agentA', requestId: 'r-register' });
        const registered = await client.waitFor((message) => message.type === 'registered');
        assert.equal(registered.requestId, 'r-register');

        client.send({ type: 'set', key: 'k1', value: 'v1', requestId: 'r-set-1' });
        const setAck1 = await client.waitFor((message) => message.type === 'ok' && message.key === 'k1');
        assert.equal(setAck1.requestId, 'r-set-1');

        client.send({ type: 'set', key: 'k2', value: 'v2', requestId: 'r-set-2' });
        await client.waitFor((message) => message.type === 'ok' && message.key === 'k2');

        client.send({ type: 'touch', key: 'k1', ttlMs: 1000, requestId: 'r-touch' });
        const touchAck = await client.waitFor((message) => message.type === 'touched' && message.key === 'k1');
        assert.equal(touchAck.requestId, 'r-touch');

        client.send({ type: 'get', key: 'k1', requestId: 'r-get' });
        const getResult = await client.waitFor((message) => message.type === 'result' && message.key === 'k1');
        assert.equal(getResult.requestId, 'r-get');

        client.send({ type: 'subscribe', key: 'k1', requestId: 'r-sub' });
        const subAck = await client.waitFor((message) => message.type === 'subscribed' && message.key === 'k1');
        assert.equal(subAck.requestId, 'r-sub');

        client.send({ type: 'unsubscribe', key: 'k1', requestId: 'r-unsub' });
        const unsubAck = await client.waitFor((message) => message.type === 'unsubscribed' && message.key === 'k1');
        assert.equal(unsubAck.requestId, 'r-unsub');

        client.send({ type: 'link', target: 'other', requestId: 'r-link' });
        const linkAck = await client.waitFor(
            (message) => message.type === 'linked' && message.target === 'other',
        );
        assert.equal(linkAck.requestId, 'r-link');

        client.send({ type: 'unlink', target: 'other', requestId: 'r-unlink' });
        const unlinkAck = await client.waitFor((message) => message.type === 'unlinked');
        assert.equal(unlinkAck.requestId, 'r-unlink');

        client.send({ type: 'list', requestId: 'r-list' });
        const listResult = await client.waitFor((message) => message.type === 'list');
        assert.equal(listResult.requestId, 'r-list');

        client.send({
            type: 'relate', from: 'k1', to: 'k2', relation: 'related_to', requestId: 'r-relate',
        });
        const relateAck = await client.waitFor((message) => message.type === 'related');
        assert.equal(relateAck.requestId, 'r-relate');

        client.send({ type: 'map', key: 'k1', depth: 1, limit: 10, requestId: 'r-map' });
        const mapResult = await client.waitFor((message) => message.type === 'map-result');
        assert.equal(mapResult.requestId, 'r-map');

        client.send({ type: 'search', query: 'k', requestId: 'r-search' });
        const searchResult = await client.waitFor((message) => message.type === 'search-result');
        assert.equal(searchResult.requestId, 'r-search');

        client.send({ type: 'prune', requestId: 'r-prune' });
        const pruneResult = await client.waitFor((message) => message.type === 'pruned');
        assert.equal(pruneResult.requestId, 'r-prune');

        client.send({
            type: 'unrelate', from: 'k1', to: 'k2', relation: 'related_to', requestId: 'r-unrelate',
        });
        const unrelateAck = await client.waitFor((message) => message.type === 'unrelated');
        assert.equal(unrelateAck.requestId, 'r-unrelate');

        client.send({ type: 'delete', key: 'k1', requestId: 'r-delete' });
        const deleteAck = await client.waitFor((message) => message.type === 'deleted');
        assert.equal(deleteAck.requestId, 'r-delete');
    } finally {
        await appServer.close();
    }
});

test('requestId preserves type and value, including 0 and empty string', async () => {
    const { appServer, wsUrl } = await startServer();

    try {
        const client = await connectClient(wsUrl);
        await client.waitFor((message) => message.type === 'welcome');
        client.send({ type: 'register', agentId: 'agentA' });
        await client.waitFor((message) => message.type === 'registered');

        const cases = ['abc', 42, 0, ''];
        for (let i = 0; i < cases.length; i += 1) {
            const requestId = cases[i];
            const key = `k${i}`;
            client.send({ type: 'set', key, value: 'v', requestId });
            const ack = await client.waitFor((message) => message.type === 'ok' && message.key === key);
            assert.strictEqual(ack.requestId, requestId);
        }
    } finally {
        await appServer.close();
    }
});

test('errors echo the requestId, but invalid-requestId omits it', async () => {
    const { appServer, wsUrl } = await startServer();

    try {
        const client = await connectClient(wsUrl);
        await client.waitFor((message) => message.type === 'welcome');

        client.send({ type: 'set', requestId: 'r1' });
        const missingKey = await client.waitFor(
            (message) => message.type === 'error' && message.message === 'missing-key',
        );
        assert.equal(missingKey.requestId, 'r1');

        client.send({ type: 'nope', requestId: 'r2' });
        const unknownType = await client.waitFor(
            (message) => message.type === 'error' && message.message === 'unknown-type',
        );
        assert.equal(unknownType.requestId, 'r2');

        client.send({ type: 'set', key: 'k', value: 'v', requestId: null });
        const invalidId = await client.waitFor(
            (message) => message.type === 'error' && message.message === 'invalid-requestId',
        );
        assert.equal(Object.prototype.hasOwnProperty.call(invalidId, 'requestId'), false);
    } finally {
        await appServer.close();
    }
});

test('broadcasts (update, relation-update, cross-agent linked) carry no requestId', async () => {
    const { appServer, wsUrl } = await startServer();

    try {
        const writer = await connectClient(wsUrl);
        await writer.waitFor((message) => message.type === 'welcome');
        writer.send({ type: 'register', agentId: 'agentA' });
        await writer.waitFor((message) => message.type === 'registered');

        const observer = await connectClient(wsUrl);
        await observer.waitFor((message) => message.type === 'welcome');
        observer.send({ type: 'register', agentId: 'agentB' });
        await observer.waitFor((message) => message.type === 'registered');

        writer.send({ type: 'set', key: 'preexisting', value: 'first' });
        await writer.waitFor((message) => message.type === 'ok' && message.key === 'preexisting');
        observer.send({ type: 'subscribe', key: 'preexisting', requestId: 'sub-rid' });
        const subAck = await observer.waitFor(
            (message) => message.type === 'subscribed' && message.key === 'preexisting',
        );
        assert.equal(subAck.requestId, 'sub-rid');
        const initialUpdate = await observer.waitFor(
            (message) => message.type === 'update' && message.key === 'preexisting',
        );
        assert.equal(Object.prototype.hasOwnProperty.call(initialUpdate, 'requestId'), false);

        observer.send({ type: 'subscribe', key: 'shared' });
        await observer.waitFor((message) => message.type === 'subscribed' && message.key === 'shared');
        observer.send({ type: 'subscribe', key: 'other' });
        await observer.waitFor((message) => message.type === 'subscribed' && message.key === 'other');

        writer.send({ type: 'link', target: 'agentB' });
        await writer.waitFor((message) => message.type === 'linked' && message.target === 'agentB');

        writer.send({ type: 'set', key: 'shared', value: 'broadcast', requestId: 'a-rid' });
        const ownAck = await writer.waitFor(
            (message) => message.type === 'ok' && message.key === 'shared',
        );
        assert.equal(ownAck.requestId, 'a-rid');

        const update = await observer.waitFor(
            (message) => message.type === 'update' && message.key === 'shared',
        );
        assert.equal(Object.prototype.hasOwnProperty.call(update, 'requestId'), false);

        const linkedBroadcast = await observer.waitFor(
            (message) => message.type === 'linked' && message.from === 'agentA',
        );
        assert.equal(Object.prototype.hasOwnProperty.call(linkedBroadcast, 'requestId'), false);

        writer.send({ type: 'set', key: 'other', value: 'second' });
        await writer.waitFor((message) => message.type === 'ok' && message.key === 'other');
        writer.send({
            type: 'relate',
            from: 'shared',
            to: 'other',
            relation: 'related_to',
            requestId: 'rel-rid',
        });
        const relateAck = await writer.waitFor((message) => message.type === 'related');
        assert.equal(relateAck.requestId, 'rel-rid');

        const relationUpdate = await observer.waitFor(
            (message) => message.type === 'relation-update' && message.action === 'created',
        );
        assert.equal(Object.prototype.hasOwnProperty.call(relationUpdate, 'requestId'), false);
    } finally {
        await appServer.close();
    }
});
