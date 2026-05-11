#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { protocolMetadata } = require('../src/protocol');
const { defaultPort } = require('./shared-memory-client');

const repoRoot = path.resolve(__dirname, '..');
const defaultInstallDir = process.platform === 'win32'
    ? 'C:\\sharedMemory'
    : path.join(os.homedir(), '.sharedMemory');
const installDir = path.resolve(process.env.SHARED_MEMORY_INSTALL_DIR || defaultInstallDir);
const port = process.env.SHARED_MEMORY_PORT || process.env.PORT || defaultPort();
const statusUrl = process.env.SHARED_MEMORY_STATUS_URL || `http://127.0.0.1:${port}/status`;
const protocolUrl = process.env.SHARED_MEMORY_PROTOCOL_URL || `http://127.0.0.1:${port}/protocol`;
const jsonOutput = process.argv.includes('--json');

function readPackage(dir) {
    try {
        return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    } catch {
        return null;
    }
}

function isSharedMemoryRoot(dir) {
    const pkg = readPackage(dir);
    return Boolean(pkg && pkg.name === 'mcp-shared-memory-server' && fs.existsSync(path.join(dir, 'mcp-server.mjs')));
}

async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
        const headers = process.env.MEMORY_TOKEN
            ? { Authorization: `Bearer ${process.env.MEMORY_TOKEN}` }
            : {};
        const response = await fetch(url, { headers, signal: controller.signal });
        const body = await response.text();
        let json = null;
        try {
            json = body ? JSON.parse(body) : null;
        } catch {
            json = null;
        }
        return { ok: response.ok, status: response.status, json };
    } catch (error) {
        return { ok: false, status: null, error: error.message };
    } finally {
        clearTimeout(timer);
    }
}

function diffLists(a, b) {
    const left = new Set(a || []);
    const right = new Set(b || []);
    return {
        missingFromRight: [...left].filter((item) => !right.has(item)).sort(),
        extraInRight: [...right].filter((item) => !left.has(item)).sort(),
    };
}

async function main() {
    const localProtocol = protocolMetadata();
    const [status, protocol] = await Promise.all([
        fetchJson(statusUrl),
        fetchJson(protocolUrl),
    ]);

    const report = {
        checkedAt: new Date().toISOString(),
        port: Number(port),
        repoRoot: {
            path: repoRoot,
            isSharedMemory: isSharedMemoryRoot(repoRoot),
            package: readPackage(repoRoot)?.name || null,
        },
        installDir: {
            path: installDir,
            exists: fs.existsSync(installDir),
            isSharedMemory: isSharedMemoryRoot(installDir),
            package: readPackage(installDir)?.name || null,
        },
        live: {
            statusUrl,
            protocolUrl,
            status,
            protocol,
        },
        drift: {
            runtimeCwdMatchesInstall: Boolean(status.json?.runtime?.cwd)
                ? path.resolve(status.json.runtime.cwd).toLowerCase() === installDir.toLowerCase()
                : null,
            relationTypes: protocol.json?.relationTypes
                ? diffLists(localProtocol.relationTypes, protocol.json.relationTypes)
                : null,
            commands: protocol.json?.commands
                ? diffLists(localProtocol.commands, protocol.json.commands)
                : null,
            directResponseTypesMatch: protocol.json?.directResponseTypes
                ? JSON.stringify(localProtocol.directResponseTypes) === JSON.stringify(protocol.json.directResponseTypes)
                : null,
        },
    };

    if (jsonOutput) {
        console.log(JSON.stringify(report, null, 2));
        return;
    }

    console.log('sharedMemory doctor');
    console.log(`repo:    ${report.repoRoot.path} (${report.repoRoot.isSharedMemory ? 'ok' : 'not sharedMemory'})`);
    console.log(`install: ${report.installDir.path} (${report.installDir.isSharedMemory ? 'ok' : 'missing/invalid'})`);
    console.log(`status:  ${status.ok ? 'ok' : `unavailable (${status.status || status.error})`}`);
    console.log(`protocol:${protocol.ok ? ' ok' : ` unavailable (${protocol.status || protocol.error})`}`);

    if (status.json?.runtime) {
        console.log(`runtime pid: ${status.json.runtime.pid}`);
        console.log(`runtime cwd: ${status.json.runtime.cwd}`);
        console.log(`memory file: ${status.json.runtime.memoryFile || '(none)'}`);
    }

    if (report.drift.relationTypes) {
        const drift = report.drift.relationTypes;
        console.log(`relation drift: missing=${drift.missingFromRight.join(',') || 'none'} extra=${drift.extraInRight.join(',') || 'none'}`);
    }

    if (report.drift.runtimeCwdMatchesInstall === false) {
        console.log('warning: live server cwd does not match the configured install dir');
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
