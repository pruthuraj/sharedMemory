// Tests for memory-curator.js transform logic (extracted as pure functions).
// Run: node --test test/memory-curator.test.js

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ── Pure transform functions (duplicated here to avoid CLI side-effects) ──────

const UPDATER_MAP = {
    'Open-Ai': 'gpt-5.5-thinking',
    'OpenAi': 'gpt-5.5-thinking',
    'open-ai': 'gpt-5.5-thinking',
    'openai': 'gpt-5.5-thinking',
};
const AGENT_ID_RE = /^agent_[a-z0-9]+$/;

function normalizeUpdater(v) {
    if (v == null) return v;
    if (UPDATER_MAP[v]) return UPDATER_MAP[v];
    if (AGENT_ID_RE.test(v)) return 'mcp';
    return v;
}

const PROJECT_MAP = {
    webreader: 'webreader',
    hextts: 'hextts',
    sharedMemory: 'sharedMemory',
    sharedmemory: 'sharedMemory',
    ecg: 'ecg-digital-twin',
    portfolio: 'portfolio',
};

function inferProject(key) {
    const parts = key.split('.');
    for (const part of parts) {
        if (PROJECT_MAP[part]) return PROJECT_MAP[part];
    }
    return null;
}

function tryParseJson(v) {
    if (typeof v !== 'string') return v;
    const trimmed = v.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return v;
    try { return JSON.parse(trimmed); } catch { return v; }
}

function inferTaskStatus(value) {
    if (typeof value !== 'string') return value;
    const u = value.toUpperCase();
    let status = 'open';
    if (u.includes('RESOLVED') || u.includes('DONE') || u.includes('COMPLETE')) status = 'resolved';
    else if (u.includes('BLOCKED')) status = 'blocked';
    else if (u.includes('IN PROGRESS') || u.includes('IN_PROGRESS') || u.includes('WIP')) status = 'in_progress';
    return { status, details: value };
}

function fillEdgeReason(edge) {
    if (edge.reason == null || edge.reason.trim() === '') {
        return { ...edge, reason: `${edge.from} ${edge.relation.replace(/_/g, ' ')} ${edge.to} (auto-filled by curator)` };
    }
    return edge;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('normalizeUpdater: maps Open-Ai variants', () => {
    assert.equal(normalizeUpdater('Open-Ai'), 'gpt-5.5-thinking');
    assert.equal(normalizeUpdater('OpenAi'), 'gpt-5.5-thinking');
    assert.equal(normalizeUpdater('open-ai'), 'gpt-5.5-thinking');
    assert.equal(normalizeUpdater('openai'), 'gpt-5.5-thinking');
});

test('normalizeUpdater: maps agent IDs to mcp', () => {
    assert.equal(normalizeUpdater('agent_i5fn04r2'), 'mcp');
    assert.equal(normalizeUpdater('agent_abc123'), 'mcp');
});

test('normalizeUpdater: leaves known clean names unchanged', () => {
    assert.equal(normalizeUpdater('gpt-5.5-thinking'), 'gpt-5.5-thinking');
    assert.equal(normalizeUpdater('claude-sonnet-4-6'), 'claude-sonnet-4-6');
    assert.equal(normalizeUpdater('mcp'), 'mcp');
});

test('normalizeUpdater: passes through null', () => {
    assert.equal(normalizeUpdater(null), null);
});

test('inferProject: matches second key segment', () => {
    assert.equal(inferProject('decision.webreader.auth'), 'webreader');
    assert.equal(inferProject('task.hextts.training'), 'hextts');
    assert.equal(inferProject('insight.ecg.pipeline'), 'ecg-digital-twin');
    assert.equal(inferProject('project.portfolio.overview'), 'portfolio');
});

test('inferProject: case-insensitive sharedMemory', () => {
    assert.equal(inferProject('decision.sharedMemory.layout'), 'sharedMemory');
    assert.equal(inferProject('decision.sharedmemory.layout'), 'sharedMemory');
});

test('inferProject: returns null for unknown namespace', () => {
    assert.equal(inferProject('random.unknown.key'), null);
});

test('tryParseJson: parses valid JSON object strings', () => {
    const result = tryParseJson('{"a":1}');
    assert.deepEqual(result, { a: 1 });
});

test('tryParseJson: parses valid JSON array strings', () => {
    const result = tryParseJson('[1,2,3]');
    assert.deepEqual(result, [1, 2, 3]);
});

test('tryParseJson: leaves non-JSON strings unchanged', () => {
    assert.equal(tryParseJson('hello world'), 'hello world');
    assert.equal(tryParseJson('RESOLVED 2026-05-06'), 'RESOLVED 2026-05-06');
});

test('tryParseJson: leaves non-string values unchanged', () => {
    assert.deepEqual(tryParseJson({ a: 1 }), { a: 1 });
    assert.equal(tryParseJson(42), 42);
    assert.equal(tryParseJson(null), null);
});

test('tryParseJson: leaves invalid JSON strings unchanged', () => {
    assert.equal(tryParseJson('{bad json}'), '{bad json}');
});

test('inferTaskStatus: resolved from string', () => {
    const r = inferTaskStatus('RESOLVED 2026-05-06: all done');
    assert.equal(r.status, 'resolved');
    assert.ok(r.details.includes('RESOLVED'));
});

test('inferTaskStatus: blocked from string', () => {
    const r = inferTaskStatus('BLOCKED on upstream API');
    assert.equal(r.status, 'blocked');
});

test('inferTaskStatus: in_progress from string', () => {
    const r = inferTaskStatus('WIP: refactoring auth middleware');
    assert.equal(r.status, 'in_progress');
});

test('inferTaskStatus: open by default', () => {
    const r = inferTaskStatus('needs investigation');
    assert.equal(r.status, 'open');
});

test('inferTaskStatus: preserves non-string values', () => {
    const obj = { status: 'resolved', details: 'done' };
    assert.deepEqual(inferTaskStatus(obj), obj);
});

test('fillEdgeReason: fills empty string reason', () => {
    const edge = { from: 'a.b', to: 'c.d', relation: 'depends_on', reason: '' };
    const result = fillEdgeReason(edge);
    assert.ok(result.reason.includes('auto-filled by curator'));
    assert.ok(result.reason.includes('depends on'));
});

test('fillEdgeReason: fills null reason', () => {
    const edge = { from: 'x', to: 'y', relation: 'supports', reason: null };
    const result = fillEdgeReason(edge);
    assert.ok(result.reason.includes('auto-filled by curator'));
});

test('fillEdgeReason: leaves non-empty reason unchanged', () => {
    const edge = { from: 'a', to: 'b', relation: 'related_to', reason: 'real reason' };
    const result = fillEdgeReason(edge);
    assert.equal(result.reason, 'real reason');
});

test('fillEdgeReason: does not mutate original edge', () => {
    const edge = { from: 'a', to: 'b', relation: 'supports', reason: '' };
    fillEdgeReason(edge);
    assert.equal(edge.reason, '');
});
