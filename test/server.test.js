const assert = require('node:assert/strict');
const test = require('node:test');
const WebSocket = require('ws');

const { createSharedMemoryServer } = require('../src/server');

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
        });
    } finally {
        await appServer.close();
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
