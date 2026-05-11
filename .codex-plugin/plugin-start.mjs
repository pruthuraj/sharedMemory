import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(scriptDir, '..');
const defaultInstallDir = process.platform === 'win32'
  ? 'C:\\sharedMemory'
  : join(os.homedir(), '.sharedMemory');
const installDir = resolve(process.env.SHARED_MEMORY_INSTALL_DIR || defaultInstallDir);
const repoUrl = process.env.SHARED_MEMORY_REPO_URL || 'https://github.com/pruthuraj/sharedMemory.git';
const port = String(process.env.PORT || process.env.SHARED_MEMORY_PORT || '8000');
const statusUrl = process.env.SHARED_MEMORY_STATUS_URL || `http://127.0.0.1:${port}/status`;
const autoInstall = isTruthy(process.env.SHARED_MEMORY_AUTO_INSTALL);
const autoStart = isTruthy(process.env.SHARED_MEMORY_AUTO_START);
const skipServiceCheck = isTruthy(process.env.SHARED_MEMORY_SKIP_SERVICE_CHECK);

function log(message) {
  process.stderr.write(`[shared-memory] ${message}\n`);
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function packageName(dir) {
  try {
    const payload = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return payload && typeof payload.name === 'string' ? payload.name : null;
  } catch {
    return null;
  }
}

function isSharedMemoryRoot(dir) {
  return (
    existsSync(join(dir, 'mcp-server.mjs'))
    && packageName(dir) === 'mcp-shared-memory-server'
  );
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

async function askPermission(question) {
  if (!process.stdin.isTTY || !process.stderr.isTTY) return false;

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    const answer = await rl.question(`[shared-memory] ${question} [y/N] `);
    return ['y', 'yes'].includes(answer.trim().toLowerCase());
  } finally {
    rl.close();
  }
}

async function ensureCheckout() {
  if (isSharedMemoryRoot(installDir)) {
    return installDir;
  }

  if (existsSync(installDir) && !isSharedMemoryRoot(installDir)) {
    throw new Error(`${installDir} exists but is not the sharedMemory MCP server checkout`);
  }

  const allowed = autoInstall || await askPermission(
    `sharedMemory was not found at ${installDir}. Clone ${repoUrl} there and run npm install?`,
  );

  if (allowed) {
    log(`cloning ${repoUrl} into ${installDir}`);
    runChecked('git', ['clone', repoUrl, installDir]);
    runChecked('npm', ['install'], { cwd: installDir });
    return installDir;
  }

  if (isSharedMemoryRoot(pluginRoot)) {
    log(`${installDir} not found; using bundled project at ${pluginRoot}. Set SHARED_MEMORY_AUTO_INSTALL=true to install into the default location.`);
    return pluginRoot;
  }

  throw new Error(
    `sharedMemory is not installed. Install it at ${installDir}, or rerun with SHARED_MEMORY_AUTO_INSTALL=true.`,
  );
}

function ensureDependencies(repoRoot) {
  if (existsSync(join(repoRoot, 'node_modules'))) return;

  if (!autoInstall) {
    log(`dependencies are missing in ${repoRoot}. Run npm install there, or set SHARED_MEMORY_AUTO_INSTALL=true.`);
    return;
  }

  log(`installing dependencies in ${repoRoot}`);
  runChecked('npm', ['install'], { cwd: repoRoot });
}

function configureEnvironment(repoRoot) {
  const dataDir = resolve(repoRoot, 'data');

  if (!process.env.MEMORY_FILE) {
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    process.env.MEMORY_FILE = resolve(dataDir, 'memory.db');
  }

  process.env.PORT = port;
}

async function localServerStatus() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const headers = {};
    if (process.env.MEMORY_TOKEN) {
      headers.Authorization = `Bearer ${process.env.MEMORY_TOKEN}`;
    }

    const response = await fetch(statusUrl, {
      headers,
      signal: controller.signal,
    });

    return response.ok || response.status === 401 ? 'running' : 'unhealthy';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureLocalServer(repoRoot) {
  if (skipServiceCheck) return;

  const status = await localServerStatus();
  if (status === 'running') {
    log(`local server is already running at ${statusUrl}`);
    return;
  }

  if (status === 'unhealthy') {
    log(`local server answered at ${statusUrl}, but status was unhealthy; continuing with stdio MCP.`);
    return;
  }

  const allowed = autoStart || await askPermission(
    `local sharedMemory server is not running on port ${port}. Start it now?`,
  );

  if (!allowed) {
    log(`local server is not running. Start it manually with: cd "${repoRoot}" && $env:PORT="${port}"; $env:MEMORY_FILE="${process.env.MEMORY_FILE}"; npm start`);
    return;
  }

  log(`starting local HTTP/WebSocket server on port ${port}`);
  const server = spawn(process.execPath, [resolve(repoRoot, 'server.js')], {
    cwd: repoRoot,
    env: process.env,
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  server.stderr.on('data', (chunk) => {
    process.stderr.write(`[shared-memory server] ${chunk}`);
  });

  server.on('error', (error) => {
    log(`failed to start local server: ${error.message}`);
  });

  server.unref();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    if (await localServerStatus() === 'running') {
      log(`local server started at ${statusUrl}`);
      return;
    }
  }

  log(`local server did not become ready at ${statusUrl}; continuing with stdio MCP.`);
}

function startMcpServer(repoRoot) {
  const child = spawn(process.execPath, [resolve(repoRoot, 'mcp-server.mjs')], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    log(`failed to start MCP server: ${error.message}`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal === 'SIGINT') process.exit(130);
    if (signal === 'SIGTERM') process.exit(143);
    process.exit(code ?? 0);
  });

  process.once('SIGINT', () => child.kill('SIGINT'));
  process.once('SIGTERM', () => child.kill('SIGTERM'));
}

async function main() {
  const repoRoot = await ensureCheckout();
  ensureDependencies(repoRoot);
  configureEnvironment(repoRoot);
  await ensureLocalServer(repoRoot);
  startMcpServer(repoRoot);
}

main().catch((error) => {
  log(error.message);
  process.exit(1);
});
