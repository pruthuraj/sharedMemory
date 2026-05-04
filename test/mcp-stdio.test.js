const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const requiredTools = [
    'memory_set',
    'memory_get',
    'memory_search',
    'memory_suggest',
    'memory_map',
    'memory_export',
    'memory_validate_import',
    'memory_import',
];

async function latestProtocolVersion() {
    const sdk = await import('@modelcontextprotocol/server');
    return sdk.LATEST_PROTOCOL_VERSION || sdk.DEFAULT_NEGOTIATED_PROTOCOL_VERSION;
}

function makeTempDb() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-memory-mcp-'));
    return {
        dir,
        file: path.join(dir, 'memory.db'),
    };
}

function startMcpClient(t) {
    const tempDb = makeTempDb();
    const child = spawn(process.execPath, ['mcp-server.mjs'], {
        cwd: repoRoot,
        env: {
            ...process.env,
            MEMORY_FILE: tempDb.file,
            MEMORY_SUGGEST_ENABLED: 'false',
            MEMORY_TOKEN: '',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    let nextId = 1;
    let stdoutBuffer = '';
    let stderr = '';
    let exited = false;
    let exitInfo = null;
    const waiters = new Set();

    function diagnostics() {
        return [
            exitInfo ? `exit=${JSON.stringify(exitInfo)}` : 'exit=pending',
            stderr.trim() ? `stderr:\n${stderr.trim()}` : 'stderr=<empty>',
        ].join('\n');
    }

    function rejectWaiters(error) {
        for (const waiter of waiters) {
            clearTimeout(waiter.timeout);
            waiter.reject(error);
        }
        waiters.clear();
    }

    function dispatch(message) {
        for (const waiter of Array.from(waiters)) {
            if (waiter.predicate(message)) {
                clearTimeout(waiter.timeout);
                waiters.delete(waiter);
                waiter.resolve(message);
            }
        }
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        stdoutBuffer += chunk;
        for (;;) {
            const newline = stdoutBuffer.indexOf('\n');
            if (newline === -1) break;
            const line = stdoutBuffer.slice(0, newline).trim();
            stdoutBuffer = stdoutBuffer.slice(newline + 1);
            if (!line) continue;
            try {
                dispatch(JSON.parse(line));
            } catch (error) {
                rejectWaiters(new Error(`Invalid JSON-RPC line: ${line}\n${error.message}\n${diagnostics()}`));
            }
        }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
        stderr += chunk;
    });

    child.on('error', (error) => {
        rejectWaiters(error);
    });

    child.on('exit', (code, signal) => {
        exited = true;
        exitInfo = { code, signal };
        rejectWaiters(new Error(`MCP server exited before response\n${diagnostics()}`));
    });

    function waitFor(predicate, label, timeoutMs = 5000) {
        return new Promise((resolve, reject) => {
            const waiter = {
                predicate,
                resolve,
                reject,
                timeout: setTimeout(() => {
                    waiters.delete(waiter);
                    reject(new Error(`${label} timed out\n${diagnostics()}`));
                }, timeoutMs),
            };
            waiters.add(waiter);
        });
    }

    function send(message) {
        child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    async function request(method, params) {
        const id = nextId;
        nextId += 1;
        const responsePromise = waitFor((message) => message.id === id, `${method} response`);
        const message = { jsonrpc: '2.0', id, method };
        if (params !== undefined) message.params = params;
        send(message);

        const response = await responsePromise;
        if (response.error) {
            throw new Error(`${method} returned JSON-RPC error ${JSON.stringify(response.error)}\n${diagnostics()}`);
        }
        return response;
    }

    function notify(method, params) {
        const message = { jsonrpc: '2.0', method };
        if (params !== undefined) message.params = params;
        send(message);
    }

    async function close() {
        if (exited) return;

        child.stdin.end();
        await new Promise((resolve) => setTimeout(resolve, 25));
        if (exited) return;

        child.kill('SIGTERM');
        await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                if (!exited) child.kill('SIGKILL');
                resolve();
            }, 1000);
            child.once('exit', () => {
                clearTimeout(timeout);
                resolve();
            });
        });
    }

    t.after(async () => {
        await close();
        fs.rmSync(tempDb.dir, { recursive: true, force: true });
    });

    return {
        request,
        notify,
        close,
        memoryFile: tempDb.file,
        stderr: () => stderr,
    };
}

async function initialize(client) {
    const init = await client.request('initialize', {
        protocolVersion: await latestProtocolVersion(),
        capabilities: {},
        clientInfo: {
            name: 'shared-memory-stdio-test',
            version: '0.0.0',
        },
    });

    assert.equal(init.result.serverInfo.name, 'shared-memory');
    assert.equal(typeof init.result.protocolVersion, 'string');
    client.notify('notifications/initialized');
    return init;
}

async function callTool(client, name, args = {}) {
    const response = await client.request('tools/call', {
        name,
        arguments: args,
    });
    const result = response.result;

    if (result.structuredContent) {
        return result.structuredContent;
    }

    const textContent = result.content && result.content.find((item) => item.type === 'text');
    assert.ok(textContent, `Tool ${name} did not return JSON text content`);
    return JSON.parse(textContent.text);
}

test('MCP stdio server initializes and lists memory tools', { timeout: 10000 }, async (t) => {
    const client = startMcpClient(t);
    await initialize(client);

    const listResponse = await client.request('tools/list');
    const names = listResponse.result.tools.map((tool) => tool.name).sort();

    for (const tool of requiredTools) {
        assert.ok(names.includes(tool), `Expected tools/list to include ${tool}`);
    }
});

test('MCP stdio tools call shared memory through real protocol', { timeout: 10000 }, async (t) => {
    const client = startMcpClient(t);
    await initialize(client);

    const setResult = await callTool(client, 'memory_set', {
        key: 'project.database',
        value: { engine: 'sqlite' },
        summary: 'Database summary',
        tags: ['database'],
        importance: 8,
    });
    assert.equal(setResult.ok, true);
    assert.equal(setResult.key, 'project.database');
    assert.equal(Object.prototype.hasOwnProperty.call(setResult.entry, 'value'), false);

    const getResult = await callTool(client, 'memory_get', {
        key: 'project.database',
    });
    assert.equal(getResult.ok, true);
    assert.deepEqual(getResult.entry.value, { engine: 'sqlite' });

    const searchResult = await callTool(client, 'memory_search', {
        tags: ['database'],
    });
    assert.equal(searchResult.ok, true);
    assert.equal(searchResult.total, 1);
    assert.deepEqual(searchResult.results.map((entry) => entry.key), ['project.database']);
    assert.equal(Object.prototype.hasOwnProperty.call(searchResult.results[0], 'value'), false);

    const mapResult = await callTool(client, 'memory_map', {
        key: 'project.database',
    });
    assert.equal(mapResult.ok, true);
    assert.deepEqual(mapResult.nodes.map((node) => node.key), ['project.database']);

    const suggestResult = await callTool(client, 'memory_suggest', {
        context: 'database task',
    });
    assert.deepEqual(suggestResult, {
        ok: true,
        enabled: false,
        suggestions: [],
    });

    const invalidSearch = await callTool(client, 'memory_search', {});
    assert.deepEqual(invalidSearch, {
        ok: false,
        error: 'missing-filter',
    });

    const exported = await callTool(client, 'memory_export');
    assert.equal(exported.ok, true);
    assert.deepEqual(exported.stats, { entryCount: 1, edgeCount: 0 });
    assert.deepEqual(Object.keys(exported.snapshot.entries), ['project.database']);

    assert.deepEqual(await callTool(client, 'memory_validate_import', { snapshot: exported.snapshot }), {
        ok: true,
        errors: [],
        stats: { entryCount: 1, edgeCount: 0 },
    });

    const invalidImport = await callTool(client, 'memory_import', {
        snapshot: {
            entries: exported.snapshot.entries,
            edges: [{ from: 'project.database', to: 'missing', relation: 'depends_on', reason: '', weight: 1, updatedAt: 1, updatedBy: null }],
        },
    });
    assert.equal(invalidImport.ok, false);
    assert.equal(invalidImport.error, 'invalid-snapshot');
    assert.ok(invalidImport.errors.some((error) => error.message === 'dangling-edge'));

    const replacement = {
        entries: {
            imported: {
                value: 'replacement',
                summary: 'Replacement summary',
                tags: ['replacement'],
                importance: 5,
                expiresAt: null,
                updatedAt: 100,
                updatedBy: 'mcp-test',
            },
        },
        edges: [],
    };
    assert.deepEqual(await callTool(client, 'memory_import', { snapshot: replacement }), {
        ok: true,
        mode: 'replace',
        stats: { entryCount: 1, edgeCount: 0 },
    });
    const imported = await callTool(client, 'memory_get', { key: 'imported' });
    assert.equal(imported.entry.value, 'replacement');
});
