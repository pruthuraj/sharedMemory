#!/usr/bin/env node
'use strict';

// PostToolUse hook: when a file in the current project is edited/written,
// record (or update) a file.<project>.<sanitized-path> memory entry so the graph
// always reflects which files have been touched in this project.
//
// Triggers on Edit / Write / MultiEdit tool calls. Reads tool_input.file_path
// from the hook's stdin JSON payload.

const path = require('path');
const { SharedMemoryWsClient, defaultWsUrl } = require('./shared-memory-client');

const TIMEOUT_MS = 3000;

function deriveProjectName() {
    if (process.env.SHARED_MEMORY_PROJECT) return process.env.SHARED_MEMORY_PROJECT;
    return path.basename(process.cwd()).toLowerCase().replace(/[^a-z0-9-]/g, '');
}

async function readStdin() {
    if (process.stdin.isTTY) return '';
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
}

function sanitizeFilePath(rel) {
    return rel
        .replace(/\\/g, '/')
        .replace(/\.[^./]+$/, (ext) => ext.replace('.', '-'))
        .replace(/[^a-zA-Z0-9._/-]/g, '-')
        .replace(/\//g, '-')
        .toLowerCase();
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

async function main() {
    const raw = await readStdin();
    let payload = {};
    try { payload = JSON.parse(raw); } catch { return; }

    const tool = payload?.hook_input?.tool_name || payload?.tool_name || '';
    const toolInput = payload?.hook_input?.tool_input || payload?.tool_input || {};
    if (!['Edit', 'Write', 'MultiEdit'].includes(tool)) return;

    const filePath = toolInput.file_path || toolInput.path;
    if (!filePath) return;

    const cwd = process.cwd();
    const abs = path.resolve(filePath);
    if (!abs.startsWith(cwd)) return; // file outside project — skip

    const rel = path.relative(cwd, abs);
    const sanitized = sanitizeFilePath(rel);
    const project = deriveProjectName();
    const key = `file.${project}.${sanitized}`;

    const t = Date.now();
    const isoDate = new Date(t).toISOString().slice(0, 10);

    // Read existing entry to preserve revision and prior touch count
    const existing = await wsCommand({ type: 'get', key });
    const priorTouches = existing?.entry?.value?.touchCount ?? 0;

    await wsCommand({
        type: 'set',
        key,
        value: {
            project,
            type: 'file',
            path: rel.replace(/\\/g, '/'),
            tool,
            status: 'touched',
            lastTouchedAt: t,
            lastTouchedDate: isoDate,
            touchCount: priorTouches + 1,
        },
        summary: `File touched by ${tool}: ${rel.replace(/\\/g, '/')}`,
        tags: ['file', project, tool.toLowerCase(), 'touched'],
        importance: 4,
        updatedBy: 'hook:file-affect',
    });

    // Hook output is silent — no additionalContext needed
    process.stdout.write(JSON.stringify({ continue: true }) + '\n');
}

main().catch(() => process.exit(0));
