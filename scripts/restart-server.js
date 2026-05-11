#!/usr/bin/env node
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_PORT = 3001;
const DEFAULT_INSTALL_DIR = process.platform === 'win32'
    ? 'C:\\sharedMemory'
    : path.join(os.homedir(), '.sharedMemory');

function readArg(name, fallback) {
    const index = process.argv.indexOf(name);
    return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
    return process.argv.includes(name);
}

const port = Number(readArg('--port', process.env.SHARED_MEMORY_PORT || process.env.PORT || DEFAULT_PORT));
const targetDir = path.resolve(readArg('--dir', process.env.SHARED_MEMORY_INSTALL_DIR || DEFAULT_INSTALL_DIR));
const memoryFile = path.resolve(readArg('--memory-file', process.env.MEMORY_FILE || path.join(targetDir, 'data', 'memory.db')));
const dryRun = hasFlag('--dry-run');
const force = hasFlag('--force');
const statusUrl = process.env.SHARED_MEMORY_STATUS_URL || `http://127.0.0.1:${port}/status`;

function run(command, args) {
    return spawnSync(command, args, {
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
    });
}

function findPidsOnPort() {
    if (process.platform === 'win32') {
        const ps = [
            '-NoProfile',
            '-Command',
            `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
        ];
        const result = run('powershell.exe', ps);
        return result.stdout
            .split(/\s+/)
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0);
    }

    const result = run('lsof', ['-ti', `:${port}`]);
    return result.stdout
        .split(/\s+/)
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);
}

function commandLineForPid(pid) {
    if (process.platform === 'win32') {
        const result = run('powershell.exe', [
            '-NoProfile',
            '-Command',
            `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
        ]);
        return result.stdout.trim();
    }

    const result = run('ps', ['-p', String(pid), '-o', 'command=']);
    return result.stdout.trim();
}

async function fetchStatus() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
        const headers = process.env.MEMORY_TOKEN
            ? { Authorization: `Bearer ${process.env.MEMORY_TOKEN}` }
            : {};
        const response = await fetch(statusUrl, { headers, signal: controller.signal });
        if (!response.ok) return null;
        return response.json();
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function isVerifiedSharedMemoryProcess(pid, status) {
    if (
        status?.runtime?.pid === pid
        && status.runtime.packageName === 'mcp-shared-memory-server'
    ) {
        return true;
    }

    const commandLine = commandLineForPid(pid).toLowerCase();
    const normalizedTarget = targetDir.toLowerCase();
    return commandLine.includes('server.js')
        && (commandLine.includes(normalizedTarget) || commandLine.includes('sharedmemory'));
}

async function waitForReady(timeoutMs = 10000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const status = await fetchStatus();
        if (status?.runtime?.packageName === 'mcp-shared-memory-server') return status;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
}

async function main() {
    if (!Number.isInteger(port) || port <= 0) {
        throw new Error(`Invalid port: ${port}`);
    }

    const serverFile = path.join(targetDir, 'server.js');
    if (!fs.existsSync(serverFile)) {
        throw new Error(`${serverFile} does not exist`);
    }

    const status = await fetchStatus();
    const pids = findPidsOnPort();
    const verifiedPids = pids.filter((pid) => force || isVerifiedSharedMemoryProcess(pid, status));
    const blockedPids = pids.filter((pid) => !verifiedPids.includes(pid));

    console.log(`target dir: ${targetDir}`);
    console.log(`port:       ${port}`);
    console.log(`memory:     ${memoryFile}`);
    console.log(`pids:       ${pids.join(', ') || 'none'}`);

    if (blockedPids.length > 0 && !force) {
        throw new Error(`Refusing to stop unverified process(es) on port ${port}: ${blockedPids.join(', ')}. Use --force only after checking them.`);
    }

    if (dryRun) {
        console.log('[dry-run] Would stop verified pids and start sharedMemory server.');
        return;
    }

    for (const pid of verifiedPids) {
        console.log(`stopping pid ${pid}`);
        try {
            process.kill(pid, 'SIGTERM');
        } catch (error) {
            console.error(`failed to signal pid ${pid}: ${error.message}`);
        }
    }

    if (verifiedPids.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
    const child = spawn(process.execPath, [serverFile], {
        cwd: targetDir,
        env: {
            ...process.env,
            PORT: String(port),
            SHARED_MEMORY_PORT: String(port),
            MEMORY_FILE: memoryFile,
        },
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        windowsHide: true,
    });
    child.unref();

    const ready = await waitForReady();
    if (!ready) {
        throw new Error(`sharedMemory did not become ready at ${statusUrl}`);
    }

    console.log(`started pid ${ready.runtime.pid} at ${statusUrl}`);
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
