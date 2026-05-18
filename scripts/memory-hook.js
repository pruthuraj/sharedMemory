#!/usr/bin/env node
'use strict';

// UserPromptSubmit hook: queries the shared memory server and injects
// relevant entries as additionalContext so the agent sees them each turn.

const { SharedMemoryWsClient, defaultWsUrl } = require('./shared-memory-client');

const TIMEOUT_MS = 3000;
const TOP_N = 10;

async function readStdin() {
    if (process.stdin.isTTY) return '';
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
}

async function wsCommand(cmd) {
    const client = new SharedMemoryWsClient({
        wsUrl: process.env.SHARED_MEMORY_WS_URL || defaultWsUrl(),
        token: process.env.MEMORY_TOKEN || '',
        timeoutMs: TIMEOUT_MS,
    });

    try {
        await client.connect();
        await client.waitFor((message) => message.type === 'welcome', TIMEOUT_MS);
        await client.authenticate();
        return await client.request(cmd, { timeoutMs: TIMEOUT_MS });
    } catch {
        return null;
    } finally {
        await client.close().catch(() => {});
    }
}

async function main() {
    const raw = await readStdin();
    let userPrompt = '';
    try {
        const input = JSON.parse(raw);
        userPrompt = (input?.hook_input?.user_prompt ?? '').trim();
    } catch {
        // Continue with an empty prompt.
    }

    let searchResults = [];
    if (userPrompt.length > 2) {
        const result = await wsCommand({ type: 'search', query: userPrompt, limit: TOP_N });
        if (result?.results?.length) searchResults = result.results;
    }

    let lines = [];
    if (searchResults.length) {
        lines = searchResults.map((result) => {
            const meta = result.summary ? ` - ${result.summary}` : '';
            return `  [${result.key}]${meta}`;
        });
    } else {
        const exported = await wsCommand({ type: 'export' });
        if (!exported?.snapshot?.entries) process.exit(0);

        const entries = Object.entries(exported.snapshot.entries)
            .sort(([, a], [, b]) => (b.importance ?? 0) - (a.importance ?? 0))
            .slice(0, TOP_N);

        if (!entries.length) process.exit(0);

        lines = entries.map(([key, entry]) => {
            const meta = entry.summary ? ` - ${entry.summary}` : '';
            return `  [${key}]${meta}`;
        });
    }

    const header = searchResults.length
        ? `Shared memory: ${searchResults.length} match(es) for your query:`
        : `Shared memory: top ${lines.length} entries by importance:`;

    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: [header, ...lines].join('\n'),
        },
    }) + '\n');
}

main().catch(() => process.exit(0));
