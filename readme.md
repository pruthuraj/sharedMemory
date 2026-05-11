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
| `SHARED_MEMORY_PLUGIN_ROOT` | host plugin dir | Downloaded plugin folder |
| `SHARED_MEMORY_MEMORY_FILE` | selected repo `data/memory.db` | Explicit plugin memory DB override |
| `SHARED_MEMORY_AUTO_INSTALL` | `false` | Allow clone/setup without an interactive prompt |
| `SHARED_MEMORY_AUTO_START` | `false` | Allow local HTTP/WebSocket server start without a prompt |
| `SHARED_MEMORY_SKIP_SERVICE_CHECK` | `false` | Skip optional local server check/start |

Plugin startup separates two paths:

- **Plugin root:** where Codex downloaded this plugin. The MCP config uses `${pluginDir}` when the host supports it and falls back to cwd/plugin env vars.
- **Server install root:** the preferred long-lived sharedMemory checkout, defaulting to `C:\sharedMemory` on Windows.

At startup, the plugin launcher first finds its own downloaded root, then prefers `C:\sharedMemory` for the actual server. If `C:\sharedMemory` is missing and install is not approved, it can run from the downloaded plugin copy when that copy is a full repo.

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
- Use `SHARED_MEMORY_BOOTSTRAP_DRY_RUN=true` to inspect plugin bootstrap decisions without cloning, installing, or starting servers.
- Plugin startup derives `MEMORY_FILE` from the selected repo root so MCP and the local dashboard use the same SQLite file. Use `SHARED_MEMORY_MEMORY_FILE` only when you intentionally want a different database.

Full setup instructions and protocol reference: [guide.md](guide.md)
