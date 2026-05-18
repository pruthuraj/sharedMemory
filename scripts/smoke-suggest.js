#!/usr/bin/env node
// Manual smoke test for the real Transformers.js suggestion path.

const { SharedMemoryWsClient, defaultWsUrl, httpUrlFromWsUrl } = require('./shared-memory-client');

const wsUrl = process.env.MCP_URL || process.env.SMOKE_WS_URL || defaultWsUrl();
const httpUrl = process.env.SMOKE_HTTP_URL || httpUrlFromWsUrl(wsUrl);
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
    const client = await new SharedMemoryWsClient({ wsUrl, httpUrl, token, timeoutMs }).connect();
    await client.waitFor((message) => message.type === 'welcome');

    await client.authenticate();

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
    await client.close();
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
