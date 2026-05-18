#!/usr/bin/env node
'use strict';

// CommonJS compatibility wrapper for hosts that still invoke scripts/plugin-start.js.

const { spawn } = require('node:child_process');
const path = require('node:path');

const child = spawn(process.execPath, [path.join(__dirname, 'plugin-start.mjs')], {
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
});

child.on('error', (error) => {
    console.error(`[shared-memory] failed to start plugin wrapper: ${error.message}`);
    process.exit(1);
});

child.on('exit', (code, signal) => {
    if (signal === 'SIGINT') process.exit(130);
    if (signal === 'SIGTERM') process.exit(143);
    process.exit(code ?? 0);
});

process.once('SIGINT', () => child.kill('SIGINT'));
process.once('SIGTERM', () => child.kill('SIGTERM'));
