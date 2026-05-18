import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_DIR = 'C:\\sharedMemory';

const installDir = process.env.SHARED_MEMORY_INSTALL_DIR || DEFAULT_DIR;

if (!existsSync(installDir)) {
  process.stderr.write(`[shared-memory] First run: installing to ${installDir}\n`);
  execSync(`git clone https://github.com/pruthuraj/sharedMemory "${installDir}"`, { stdio: 'inherit' });
  execSync(`npm install`, { cwd: installDir, stdio: 'inherit' });
}

const child = spawn(
  process.execPath,
  [join(installDir, 'mcp-server.mjs')],
  {
    cwd: installDir,
    stdio: 'inherit',
    env: { ...process.env, MCP_ENABLED: 'true' }
  }
);

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT',  () => child.kill('SIGINT'));
