# sharedMemory

A local shared-memory server that lets multiple AI agents coordinate through one persistent memory graph. Agents can read/write state, subscribe to changes, recall nearby graph context, and use MCP tools without each agent rebuilding the same memory logic.

## How Agents Connect

Two protocols share the same SQLite-backed store:

- **WebSocket** for runtime agents that need live subscriptions and low-latency reads.
- **MCP stdio** for Codex, Claude Desktop, and other MCP-compatible clients.

## Core Capabilities

- **Persistent memory graph.** Entries store `value`, `summary`, `tags`, `importance`, `revision`, optional expiry, and update metadata.
- **Typed graph relations.** Official relation types are `related_to`, `depends_on`, `supports`, `contradicts`, `mentions`, `derived_from`, `next_step`, `implements`, `documents`, and `blocks`.
- **Low-token recall.** `map`, `search`, and `suggest` return metadata-only results; full values stay behind `get` or snapshot export.
- **Live notifications.** Subscribers receive memory `update`, `relation-update`, and snapshot import events.
- **Durability.** `MEMORY_FILE` enables SQLite persistence using Node 24 `node:sqlite`.
- **Operations visibility.** `/status` exposes health, persistence, suggestions, audit counts, and runtime identity. `/protocol` exposes live command and response mappings.

## Quick Start

```bash
npm install
npm start          # HTTP/WebSocket server, default port 3001
npm run mcp       # stdio MCP adapter only
npm test
```

Useful scripts:

```bash
npm run doctor    # read-only runtime/protocol drift report
npm run restart   # safe restart helper for the local HTTP/WebSocket server
```

## Configuration

| Variable | Default | Purpose |
|---|---:|---|
| `SHARED_MEMORY_PORT` / `PORT` | `3001` | HTTP/WebSocket listen port |
| `MEMORY_FILE` | none | SQLite database path; enables persistence |
| `MEMORY_TOKEN` | none | Bearer token for WebSocket, `/status`, and `/protocol` |
| `MEMORY_SUGGEST_ENABLED` | `false` | Enables local semantic suggestions |
| `SHARED_MEMORY_INSTALL_DIR` | `C:\sharedMemory` on Windows | Canonical plugin/server checkout |

Plugin installs should use `C:\sharedMemory` by default. The Codex plugin config starts `.codex-plugin/plugin-start.mjs`, checks that checkout, and uses port `3001` unless overridden.

## Discovery Endpoints

- `GET /status` returns live metrics plus `runtime: { pid, cwd, entrypoint, startedAt, nodeVersion, packageName, packageVersion, memoryFile, port }`.
- `GET /protocol` returns `commands`, `relationTypes`, `directResponseTypes`, `broadcastTypes`, `mcpTools`, and `protocolVersion`.

When `MEMORY_TOKEN` is set, both endpoints require `Authorization: Bearer <token>`.

Important direct WebSocket response mappings:

| Command | Direct response |
|---|---|
| `validate-import` | `import-validation` |
| `import` | `import-result` |
| `relate` | `related` |
| `unrelate` | `unrelated` |
| `search` | `search-result` |
| `map` | `map-result` |

Broadcasts do not include `requestId`.

## MCP Tools

The stdio adapter exposes:

`memory_set`, `memory_get`, `memory_search`, `memory_suggest`, `memory_map`, `memory_relate`, `memory_unrelate`, `memory_export`, `memory_validate_import`, `memory_import`, `memory_audit`, `memory_bulk_set`, and `memory_bulk_relate`.

## Operational Notes

- If you change protocol constants or relation types, fully restart the Node process; running servers do not reload changed modules.
- If both the dev checkout and `C:\sharedMemory` exist, check `/status.runtime.cwd` before debugging behavior.
- Use `npm run doctor` when a client sees unexpected response types, missing relation support, or the wrong memory database.

Full setup instructions and protocol reference: [guide.md](guide.md)
