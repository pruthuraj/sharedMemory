const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
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
