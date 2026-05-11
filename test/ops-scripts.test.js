const assert = require('node:assert/strict');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function runNode(args, options = {}) {
    return execFileSync(process.execPath, args, {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, ...options.env },
    });
}

function runNodeAll(args, options = {}) {
    const result = spawnSync(process.execPath, args, {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, ...options.env },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return `${result.stdout}${result.stderr}`;
}

function runNodeAllAsync(args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, {
            cwd: repoRoot,
            env: { ...process.env, ...options.env },
            windowsHide: true,
        });
        let output = '';
        child.stdout.on('data', (chunk) => { output += chunk.toString(); });
        child.stderr.on('data', (chunk) => { output += chunk.toString(); });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(output || `node exited with code ${code}`));
                return;
            }
            resolve(output);
        });
    });
}

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'shared-memory-ops-test-'));
}

function createMinimalSharedMemoryRoot() {
    const dir = tempDir();
    fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'mcp-shared-memory-server', version: '0.0.0' }),
    );
    fs.writeFileSync(path.join(dir, 'mcp-server.mjs'), '');
    return dir;
}

test('doctor script emits read-only JSON diagnostics', () => {
    const output = runNode(['scripts/shared-memory-doctor.js', '--json'], {
        env: {
            SHARED_MEMORY_PORT: '39998',
            PORT: '',
            MEMORY_TOKEN: '',
        },
    });
    const report = JSON.parse(output);
    assert.equal(report.repoRoot.isSharedMemory, true);
    assert.equal(report.port, 39998);
    assert.equal(report.live.status.ok, false);
    assert.deepEqual(report.drift.relationTypes, null);
});

test('restart script dry-run is configurable and non-mutating', () => {
    const output = runNode([
        'scripts/restart-server.js',
        '--dry-run',
        '--port',
        '39999',
        '--dir',
        repoRoot,
        '--memory-file',
        path.join(repoRoot, 'data', 'dry-run-memory.db'),
    ]);

    assert.match(output, /port:\s+39999/);
    assert.match(output, /\[dry-run\]/);
});

test('plugin bootstrap dry-run uses canonical install when available', () => {
    const output = runNodeAll(['.codex-plugin/plugin-start.mjs'], {
        env: {
            SHARED_MEMORY_BOOTSTRAP_DRY_RUN: 'true',
            SHARED_MEMORY_INSTALL_DIR: repoRoot,
            SHARED_MEMORY_PLUGIN_ROOT: '${pluginDir}',
            SHARED_MEMORY_SKIP_SERVICE_CHECK: 'true',
            SHARED_MEMORY_PORT: '39991',
            PORT: '',
            MEMORY_FILE: '',
        },
    });

    assert.match(output, /using canonical install/);
    assert.match(output, /selected repo root:/);
    assert.match(output, /plugin root:/);
    assert.match(output, /service check skipped/);
    assert.match(output, /\[dry-run\] would start stdio MCP server/);
});

test('plugin bootstrap falls back to downloaded plugin root when canonical install is missing', () => {
    const missingInstall = path.join(tempDir(), 'missing-install');
    const output = runNodeAll(['.codex-plugin/plugin-start.mjs'], {
        env: {
            SHARED_MEMORY_BOOTSTRAP_DRY_RUN: 'true',
            SHARED_MEMORY_INSTALL_DIR: missingInstall,
            SHARED_MEMORY_PLUGIN_ROOT: '${pluginDir}',
            SHARED_MEMORY_SKIP_SERVICE_CHECK: 'true',
            SHARED_MEMORY_PORT: '39992',
            PORT: '',
            MEMORY_FILE: '',
        },
    });

    assert.match(output, /not found; using bundled project/);
    assert.match(output, /selected repo root:/);
});

test('plugin bootstrap dry-run reports missing dependencies without mutating', () => {
    const installRoot = createMinimalSharedMemoryRoot();
    const output = runNodeAll(['.codex-plugin/plugin-start.mjs'], {
        env: {
            SHARED_MEMORY_BOOTSTRAP_DRY_RUN: 'true',
            SHARED_MEMORY_INSTALL_DIR: installRoot,
            SHARED_MEMORY_PLUGIN_ROOT: repoRoot,
            SHARED_MEMORY_SKIP_SERVICE_CHECK: 'true',
            SHARED_MEMORY_PORT: '39993',
            PORT: '',
            MEMORY_FILE: '',
        },
    });

    assert.match(output, /dependencies are missing/);
    assert.equal(fs.existsSync(path.join(installRoot, 'node_modules')), false);
});

test('plugin bootstrap dry-run reports auto install decisions without cloning', () => {
    const installRoot = path.join(tempDir(), 'auto-install-target');
    const output = runNodeAll(['.codex-plugin/plugin-start.mjs'], {
        env: {
            SHARED_MEMORY_BOOTSTRAP_DRY_RUN: 'true',
            SHARED_MEMORY_AUTO_INSTALL: 'true',
            SHARED_MEMORY_INSTALL_DIR: installRoot,
            SHARED_MEMORY_PLUGIN_ROOT: repoRoot,
            SHARED_MEMORY_SKIP_SERVICE_CHECK: 'true',
            SHARED_MEMORY_PORT: '39994',
            PORT: '',
            MEMORY_FILE: '',
        },
    });

    assert.match(output, /\[dry-run\] would clone/);
    assert.match(output, /\[dry-run\] would run: git clone/);
    assert.match(output, /\[dry-run\] would install dependencies/);
    assert.equal(fs.existsSync(installRoot), false);
});

test('plugin bootstrap dry-run distinguishes running and down local servers', async () => {
    const server = http.createServer((req, res) => {
        if (req.url === '/status') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('{}');
            return;
        }
        res.writeHead(404);
        res.end();
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    try {
        const running = await runNodeAllAsync(['.codex-plugin/plugin-start.mjs'], {
            env: {
                SHARED_MEMORY_BOOTSTRAP_DRY_RUN: 'true',
                SHARED_MEMORY_INSTALL_DIR: repoRoot,
                SHARED_MEMORY_PLUGIN_ROOT: repoRoot,
                SHARED_MEMORY_STATUS_URL: `http://127.0.0.1:${port}/status`,
                SHARED_MEMORY_PORT: String(port),
                PORT: '',
                MEMORY_FILE: '',
            },
        });
        assert.match(running, /local server is already running/);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }

    const down = runNodeAll(['.codex-plugin/plugin-start.mjs'], {
        env: {
            SHARED_MEMORY_BOOTSTRAP_DRY_RUN: 'true',
            SHARED_MEMORY_AUTO_START: 'true',
            SHARED_MEMORY_INSTALL_DIR: repoRoot,
            SHARED_MEMORY_PLUGIN_ROOT: repoRoot,
            SHARED_MEMORY_STATUS_URL: 'http://127.0.0.1:39995/status',
            SHARED_MEMORY_PORT: '39995',
            PORT: '',
            MEMORY_FILE: '',
        },
    });
    assert.match(down, /\[dry-run\] would start local HTTP\/WebSocket server on port 39995/);
});
