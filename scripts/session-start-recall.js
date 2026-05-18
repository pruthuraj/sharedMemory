#!/usr/bin/env node
'use strict';

// SessionStart hook: queries the shared-memory store for everything pinned to the
// current project (root + submains + top-importance leaves) and injects it as
// additionalContext so a fresh session wakes up already knowing the project.
//
// Project identification:
//   1. $SHARED_MEMORY_PROJECT env var if set
//   2. Lowercased basename(cwd) — matches our canonical project naming
//   3. If project.<name> does not exist, fall back to global top-importance dump

const path = require('path');
const { SharedMemoryWsClient, defaultWsUrl } = require('./shared-memory-client');

const TIMEOUT_MS = 4000;
const TOP_LEAVES = 12;

function deriveProjectName() {
    if (process.env.SHARED_MEMORY_PROJECT) return process.env.SHARED_MEMORY_PROJECT;
    const cwd = process.cwd();
    return path.basename(cwd).toLowerCase().replace(/[^a-z0-9-]/g, '');
}

async function wsCommand(cmd) {
    const client = new SharedMemoryWsClient({
        wsUrl: process.env.SHARED_MEMORY_WS_URL || defaultWsUrl(),
        token: process.env.MEMORY_TOKEN || '',
        timeoutMs: TIMEOUT_MS,
    });
    try {
        await client.connect();
        await client.waitFor((m) => m.type === 'welcome', TIMEOUT_MS);
        await client.authenticate();
        return await client.request(cmd, { timeoutMs: TIMEOUT_MS });
    } catch {
        return null;
    } finally {
        await client.close().catch(() => {});
    }
}

function formatNode(node) {
    const meta = node.summary ? ` — ${node.summary.slice(0, 100)}` : '';
    const imp = typeof node.importance === 'number' ? ` (imp ${node.importance})` : '';
    return `  [${node.key}]${imp}${meta}`;
}

async function main() {
    const project = deriveProjectName();
    const projectKey = `project.${project}`;
    const lines = [];

    // 1. Pull the project root + submains via memory_map depth 1
    const mapResp = await wsCommand({ type: 'map', key: projectKey, depth: 1 });
    if (!mapResp?.nodes?.length) {
        // Project not found — graceful fallback: top global entries
        const exp = await wsCommand({ type: 'export' });
        const top = Object.entries(exp?.snapshot?.entries || {})
            .map(([key, e]) => ({ key, summary: e.summary, importance: e.importance }))
            .sort((a, b) => (b.importance || 0) - (a.importance || 0))
            .slice(0, 8);
        if (!top.length) return;
        process.stdout.write(JSON.stringify({
            hookSpecificOutput: {
                hookEventName: 'SessionStart',
                additionalContext: [
                    `Shared memory: no project.${project} found. Top global entries by importance:`,
                    ...top.map(formatNode),
                ].join('\n'),
            },
        }) + '\n');
        return;
    }

    // Filter to nodes that belong to this project (project root or 2nd segment matches)
    const belongs = (key) => {
        if (key === projectKey) return true;
        const parts = key.split('.');
        return parts.length >= 2 && parts[1] === project;
    };

    const root = mapResp.nodes.find((n) => n.key === projectKey);
    const submains = mapResp.nodes.filter((n) =>
        n.key !== projectKey && belongs(n.key) && n.key.split('.').length === 2
    );

    // 2. Pull top leaves across the project by sorting one more depth
    const deepResp = await wsCommand({ type: 'map', key: projectKey, depth: 2 });
    const topLeaves = (deepResp?.nodes || [])
        .filter((n) => n.key !== projectKey && belongs(n.key) && n.key.split('.').length >= 3)
        .sort((a, b) => (b.importance || 0) - (a.importance || 0))
        .slice(0, TOP_LEAVES);

    lines.push(`Shared memory snapshot for project.${project}:`);
    if (root) lines.push(formatNode(root));

    // memory_map strips value; pull root entry to read cached stats
    const rootEntry = await wsCommand({ type: 'get', key: projectKey });
    const stats = rootEntry?.entry?.value?.stats;
    if (stats) {
        lines.push(`  stats: count=${stats.count} avg=${Number(stats.avgImportance || 0).toFixed(2)} threshold=${Number(stats.threshold || 0).toFixed(2)}`);
    }

    if (submains.length) {
        lines.push(`Submains (${submains.length}):`);
        for (const s of submains) lines.push(formatNode(s));
    }

    if (topLeaves.length) {
        lines.push(`Top ${topLeaves.length} leaves by importance:`);
        for (const n of topLeaves) lines.push(formatNode(n));
    }

    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: lines.join('\n'),
        },
    }) + '\n');
}

main().catch(() => process.exit(0));
