#!/usr/bin/env node
// Reads curator-report.json vagueEdges, applies reclassification rules,
// and fixes each edge in the live store via WebSocket unrelate+relate.
// Writes needs-review.json for edges that don't fit any rule.
//
// Usage: node scripts/reclassify-edges.js [--dry-run]

'use strict';

const { readFileSync, writeFileSync } = require('node:fs');
const PORT = Number(process.env.PORT ?? 3000);
const DRY_RUN = process.argv.includes('--dry-run');

const report = JSON.parse(readFileSync('curator-report.json', 'utf8'));
const vague = report.vagueEdges;

// ── Reclassification rules ────────────────────────────────────────────────────
// Returns new relation string, or null if needs manual review.

function reclassify(edge) {
    const { from, to, relation } = edge;

    // Sessions always document what they touched
    if (from.startsWith('session.')) return 'documents';

    // References document their targets
    if (from.startsWith('reference.')) return 'documents';

    // Facts document decisions or other structural entries
    if (from.startsWith('fact.') && relation === 'related_to') return 'documents';

    // Insights that mention setups document them
    if (from.startsWith('insight.') && to.startsWith('setup.') && relation === 'mentions') return 'documents';

    // Any remaining mentions → documents (more specific than mentions in all observed cases)
    if (relation === 'mentions') return 'documents';

    // Any remaining related_to → supports
    if (relation === 'related_to') return 'supports';

    return null;
}

// ── Classify all edges ────────────────────────────────────────────────────────

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

console.log(`\n── Reclassification plan ────────────────────────────────`);
console.log(`Auto-fix:     ${toFix.length}`);
console.log(`Needs review: ${needsReview.length}`);

// Show breakdown by new relation
const byType = {};
for (const e of toFix) {
    byType[e.newRelation] = (byType[e.newRelation] ?? 0) + 1;
}
for (const [type, count] of Object.entries(byType)) {
    console.log(`  ${type}: ${count}`);
}
console.log(`─────────────────────────────────────────────────────────\n`);

if (needsReview.length > 0) {
    if (!DRY_RUN) writeFileSync('needs-review.json', JSON.stringify(needsReview, null, 2), 'utf8');
    console.log(`Needs-review edges → needs-review.json`);
    for (const e of needsReview) {
        console.log(`  ${e.from} → ${e.to} (${e.relation})`);
    }
}

if (DRY_RUN) {
    console.log('\n[dry-run] No changes applied.');
    process.exit(0);
}

// ── Apply fixes via WebSocket ─────────────────────────────────────────────────

function wsCommand(cmd, expectedType) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${PORT}`);
        const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 15000);
        ws.addEventListener('open', () => ws.send(JSON.stringify({ ...cmd, requestId: 'reclassify' })));
        ws.addEventListener('message', (event) => {
            let msg;
            try { msg = JSON.parse(event.data); } catch { return; }
            if (msg.type !== expectedType) return;
            clearTimeout(timer);
            ws.close();
            resolve(msg);
        });
        ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('ws error')); });
    });
}

// Spawn subprocess to apply all fixes — avoids CJS async/WS quirks
const { execFileSync } = require('node:child_process');

const fixScript = `
const fixes = ${JSON.stringify(toFix)};
const PORT = ${PORT};
let fixed = 0, failed = 0;

function wsCmd(cmd, expectedType) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:' + PORT);
    const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 15000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({...cmd, requestId:'reclassify'})));
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.type !== expectedType) return;
      clearTimeout(timer); ws.close(); resolve(m);
    });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('ws error')); });
  });
}

(async () => {
  for (const edge of fixes) {
    try {
      // Remove old relation
      await wsCmd(
        { type: 'unrelate', from: edge.from, to: edge.to, relation: edge.relation },
        'unrelated'
      );
      // Add new relation with same reason and weight
      await wsCmd(
        { type: 'relate', from: edge.from, to: edge.to, relation: edge.newRelation,
          reason: edge.reason, weight: edge.weight ?? 0.7 },
        'related'
      );
      fixed++;
      process.stdout.write('.');
    } catch (e) {
      process.stderr.write('\\nFailed ' + edge.from + ' -> ' + edge.to + ': ' + e.message + '\\n');
      failed++;
    }
  }
  console.log('\\nDone: ' + fixed + ' fixed, ' + failed + ' failed');
})().catch(e => { console.error(e.message); process.exit(1); });
`;

console.log(`Applying ${toFix.length} fixes...`);
try {
    execFileSync(process.execPath, ['-e', fixScript], { stdio: 'inherit' });
} catch {
    process.exit(1);
}
