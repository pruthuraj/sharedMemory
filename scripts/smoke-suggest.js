#!/usr/bin/env node
// Manual smoke test for the real Transformers.js suggestion path.

const WebSocket = require('ws');

const wsUrl = process.env.MCP_URL || process.env.SMOKE_WS_URL || 'ws://127.0.0.1:3000';
const httpUrl = process.env.SMOKE_HTTP_URL || wsUrl.replace(/^ws/, 'http');
const token = process.env.MEMORY_TOKEN || '';
const timeoutMs = Number.parseInt(process.env.SMOKE_TIMEOUT_MS || '120000', 10);

const memories = [
    {
        key: 'smoke.database',
        value: 'SQLite persistence uses WAL and keeps shared memory durable.',
        summary: 'SQLite WAL persistence for shared memory.',
        tags: ['database', 'persistence'],
        importance: 9,
    },
    {
        key: 'smoke.architecture',
        value: 'The server exposes WebSocket commands and an MCP adapter.',
        summary: 'Shared memory has WebSocket and MCP access paths.',
        tags: ['architecture', 'mcp'],
        importance: 8,
    },
    {
        key: 'smoke.suggestions',
        value: 'Transformers.js embeddings power semantic memory suggestions.',
        summary: 'Semantic suggestions use Transformers.js embeddings.',
        tags: ['suggestions', 'embeddings'],
        importance: 10,
    },
];

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestHeaders() {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchStatus() {
    const response = await fetch(`${httpUrl}/status`, { headers: requestHeaders() });
    if (!response.ok) {
        throw new Error(`/status returned HTTP ${response.status}`);
    }
    return response.json();
}

async function connect() {
    const ws = new WebSocket(wsUrl);
    const messages = [];
    const waiters = [];

    ws.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        messages.push(message);
        for (let index = waiters.length - 1; index >= 0; index -= 1) {
            const waiter = waiters[index];
            if (waiter.predicate(message)) {
                clearTimeout(waiter.timeout);
                waiters.splice(index, 1);
                waiter.resolve(message);
            }
        }
    });

    await new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
    });

    function waitFor(predicate, waitMs = 30000) {
        const existing = messages.find(predicate);
        if (existing) return Promise.resolve(existing);
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timed out waiting for WebSocket message')), waitMs);
            waiters.push({ predicate, resolve, timeout });
        });
    }

    function send(payload) {
        ws.send(JSON.stringify(payload));
    }

    async function request(payload) {
        const requestId = payload.requestId || `smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        send({ ...payload, requestId });
        const response = await waitFor((message) => message.requestId === requestId, timeoutMs);
        if (response.type === 'error') {
            throw new Error(`${payload.type} failed: ${response.message}`);
        }
        return response;
    }

    return { ws, waitFor, request };
}

async function waitForIndex() {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const status = await fetchStatus();
        const suggestions = status.suggestions;
        if (!suggestions || suggestions.enabled !== true) {
            throw new Error('Suggestions are disabled. Start with MEMORY_SUGGEST_ENABLED=true npm start.');
        }
        if (suggestions.lastIndexError) {
            throw new Error(`Suggestion index failed: ${suggestions.lastIndexError}`);
        }
        if (
            suggestions.modelLoaded === true
            && suggestions.queuedUpdateCount === 0
            && suggestions.processing === false
            && suggestions.activeIndexedCount >= memories.length
        ) {
            return status;
        }
        await sleep(500);
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for suggestion index`);
}

async function main() {
    console.log(`Connecting to ${wsUrl}`);
    const client = await connect();
    await client.waitFor((message) => message.type === 'welcome');

    if (token) {
        await client.request({ type: 'auth', token });
    }

    await client.request({ type: 'register', agentId: 'smoke-suggest-agent' });

    for (const memory of memories) {
        await client.request({ type: 'set', ...memory });
        console.log(`set ${memory.key}`);
    }

    const status = await waitForIndex();
    console.log('suggestion status:', status.suggestions);

    const result = await client.request({
        type: 'suggest',
        context: 'How should I persist and retrieve semantic memory for MCP agents?',
        tags: ['suggestions'],
        limit: 5,
    });

    if (!Array.isArray(result.suggestions) || result.suggestions.length === 0) {
        throw new Error('suggest returned no results');
    }

    console.log('suggestions:', result.suggestions);
    client.ws.close();
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
