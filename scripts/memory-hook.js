#!/usr/bin/env node
// UserPromptSubmit hook: queries the shared memory server and injects
// relevant entries as additionalContext so Claude sees them each turn.

const PORT = process.env.PORT || 3000;
const TIMEOUT_MS = 3000;
const TOP_N = 10;

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// Send one WS command and collect the matching response type.
// The server sends a 'welcome' first; ignore it and wait for our reply.
async function wsCommand(cmd, expectedType) {
  return new Promise((resolve) => {
    let ws;
    const timer = setTimeout(() => {
      try { ws?.close(); } catch { /* ignore */ }
      resolve(null);
    }, TIMEOUT_MS);

    try {
      ws = new WebSocket(`ws://localhost:${PORT}`);
    } catch {
      clearTimeout(timer);
      return resolve(null);
    }

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ ...cmd, requestId: 'hook' }));
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type !== expectedType) return; // skip welcome / other broadcasts
      clearTimeout(timer);
      ws.close();
      resolve(msg);
    });

    ws.addEventListener('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

// Parse hook input from stdin
const raw = await readStdin();
let userPrompt = '';
try {
  const input = JSON.parse(raw);
  userPrompt = (input?.hook_input?.user_prompt ?? '').trim();
} catch { /* proceed */ }

// 1. Try semantic search using the user's prompt (FTS5 — needs real words)
let searchResults = [];
if (userPrompt.length > 2) {
  const res = await wsCommand({ type: 'search', query: userPrompt, limit: TOP_N }, 'search-result');
  if (res?.results?.length) searchResults = res.results;
}

// 2. Fall back to full export sorted by importance
let lines = [];
if (searchResults.length) {
  lines = searchResults.map((r) => {
    const meta = r.summary ? ` — ${r.summary}` : '';
    return `  [${r.key}]${meta}`;
  });
} else {
  const exp = await wsCommand({ type: 'export' }, 'export-result');
  if (!exp?.snapshot?.entries) process.exit(0);

  const entries = Object.entries(exp.snapshot.entries)
    .sort(([, a], [, b]) => (b.importance ?? 0) - (a.importance ?? 0))
    .slice(0, TOP_N);

  if (!entries.length) process.exit(0);

  lines = entries.map(([key, e]) => {
    const meta = e.summary ? ` — ${e.summary}` : '';
    return `  [${key}]${meta}`;
  });
}

const header = searchResults.length
  ? `Shared memory: ${searchResults.length} match(es) for your query:`
  : `Shared memory: top ${lines.length} entries by importance:`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: [header, ...lines].join('\n'),
  },
}) + '\n');
