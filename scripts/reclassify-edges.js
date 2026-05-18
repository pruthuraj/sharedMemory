#!/usr/bin/env node
'use strict';

// Reads curator-report.json vagueEdges, applies reclassification rules,
// and fixes each edge in the live store via WebSocket unrelate+relate.
// Writes needs-review.json for edges that do not fit any rule.
//
// Usage: node scripts/reclassify-edges.js [--dry-run]

const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');

const { defaultWsUrl } = require('./shared-memory-client');

const WS_URL = process.env.SHARED_MEMORY_WS_URL || process.env.SMOKE_WS_URL || defaultWsUrl();
const DRY_RUN = process.argv.includes('--dry-run');

const report = JSON.parse(readFileSync('curator-report.json', 'utf8'));
const vague = Array.isArray(report.vagueEdges) ? report.vagueEdges : [];

function reclassify(edge) {
    const { from, to, relation } = edge;

    if (from.startsWith('session.')) return 'documents';
    if (from.startsWith('reference.')) return 'documents';
    if (from.startsWith('fact.') && relation === 'related_to') return 'documents';
    if (from.startsWith('insight.') && to.startsWith('setup.') && relation === 'mentions') return 'documents';
    if (relation === 'mentions') return 'documents';
    if (relation === 'related_to') return 'supports';
    return null;
}

const toFix = [];
const needsReview = [];

for (const edge of vague) {
    const newRelation = reclassify(edge);
    if (newRelation) {
        toFix.push({ ...edge, newRelation });
    } else {
        needsReview.push(edge);
    }
}

console.log('\nReclassification plan');
console.log(`Auto-fix:     ${toFix.length}`);
console.log(`Needs review: ${needsReview.length}`);

const byType = {};
for (const edge of toFix) {
    byType[edge.newRelation] = (byType[edge.newRelation] ?? 0) + 1;
}
for (const [type, count] of Object.entries(byType).sort()) {
    console.log(`  ${type}: ${count}`);
}
console.log('');

if (needsReview.length > 0) {
    if (!DRY_RUN) writeFileSync('needs-review.json', JSON.stringify(needsReview, null, 2), 'utf8');
    console.log('Needs-review edges -> needs-review.json');
    for (const edge of needsReview) {
        console.log(`  ${edge.from} -> ${edge.to} (${edge.relation})`);
    }
}

if (DRY_RUN) {
    console.log('\n[dry-run] No changes applied.');
    process.exit(0);
}

const clientHelper = require.resolve('./shared-memory-client');
const fixScript = `
const { SharedMemoryWsClient } = require(${JSON.stringify(clientHelper)});
const fixes = ${JSON.stringify(toFix)};
const wsUrl = ${JSON.stringify(WS_URL)};
let fixed = 0;
let failed = 0;

(async () => {
  const client = await new SharedMemoryWsClient({ wsUrl, token: process.env.MEMORY_TOKEN || '', timeoutMs: 15000 }).connect();
  await client.waitFor((message) => message.type === 'welcome');
  await client.authenticate();

  for (const edge of fixes) {
    try {
      await client.request({ type: 'unrelate', from: edge.from, to: edge.to, relation: edge.relation });
      await client.request({
        type: 'relate',
        from: edge.from,
        to: edge.to,
        relation: edge.newRelation,
        reason: edge.reason,
        weight: edge.weight ?? 0.7,
      });
      fixed += 1;
      process.stdout.write('.');
    } catch (error) {
      process.stderr.write('\\nFailed ' + edge.from + ' -> ' + edge.to + ': ' + (error.response?.message || error.message) + '\\n');
      failed += 1;
    }
  }

  await client.close();
  console.log('\\nDone: ' + fixed + ' fixed, ' + failed + ' failed');
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
`;

console.log(`Applying ${toFix.length} fixes...`);
try {
    execFileSync(process.execPath, ['-e', fixScript], { stdio: 'inherit' });
} catch {
    process.exit(1);
}
