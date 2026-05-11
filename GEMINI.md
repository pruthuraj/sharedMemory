# Project: Shared Memory Server

A local coordination service for multi-agent systems, providing a persistent, queryable memory graph. Agents coordinate via **WebSocket** for real-time state sharing and subscriptions, while LLM toolchains connect via **Model Context Protocol (MCP)**.

## Project Overview
- **Purpose**: Solves context duplication in multi-agent workflows by providing a common, real-time store for facts, decisions, and session notes.
- **Core Architecture**: Node.js server with an in-process SQLite database. Split into a WebSocket/HTTP server (`src/server.js`) and an MCP stdio adapter (`mcp-server.mjs`).
- **Memory Model**: Key-value entries with rich metadata (summary, tags, importance, TTL) and typed graph relations (edges).
- **Search & Retrieval**: Supports Full-Text Search (FTS5) and optional semantic suggestions using a local ONNX embedding model.

## Core Technologies
- **Runtime**: Node.js 24+
- **Database**: `node:sqlite` (SQLite in WAL mode)
- **Networking**: `ws` (WebSockets), `express` (HTTP/Static dashboard)
- **AI/ML**: `@huggingface/transformers` (Local ONNX embeddings for suggestions)
- **Protocol**: Model Context Protocol (MCP) for tool integration

## Building and Running

### Commands
- `npm install`: Install dependencies.
- `npm start`: Runs the server (default port 3000). Use `.env` or environment variables for config.
- `npm run mcp`: Runs the MCP server (stdio transport).
- `npm test`: Executes the test suite using Node's built-in test runner.
- `npm run smoke:suggest`: Runs a smoke test for the semantic suggestion engine.

### Configuration (Environment Variables)
- `PORT`: (Default: `3000`) Server port.
- `MEMORY_FILE`: SQLite file path (enables persistence). If unset, uses in-memory store.
- `MEMORY_TOKEN`: Bearer token for WebSocket and `/status` authentication.
- `MEMORY_SUGGEST_ENABLED`: (`true`/`false`) Enables semantic suggestions.
- `MEMORY_EMBED_MODEL`: ONNX model ID for embeddings.

## Project Structure
- `src/`: Core logic
    - `memory-store.js`: SQLite CRUD, graph relations, FTS5, and TTL logic.
    - `agent-registry.js`: Manages agent connections, IDs, and subscriptions.
    - `suggestion-engine.js`: Semantic ranking and embedding coordination.
    - `server.js`: WebSocket/HTTP implementation and command dispatch.
    - `protocol.js`: JSON message validation and parsing.
    - `mcp-tools.js`: Implementation of MCP tools.
- `public/`: Static dashboard for visualizing the memory graph (Cytoscape.js).
- `test/`: Comprehensive test suite using `node:test`.
- `mcp-server.mjs`: Entry point for MCP stdio transport.
- `server.js`: Entry point for `npm start` (WebSocket/HTTP).

## Development Conventions

### Coding Style
- **Modules**: Uses CommonJS for most source files and ESM for the MCP entry point (`.mjs`).
- **Persistence**: SQLite is used for durability; WAL mode and synchronous flushing on shutdown ensure data integrity.
- **Memory Hygiene**: Built-in "audit" functionality tracks zombies (poor metadata), orphans (unlinked nodes), and duplicates.

### Testing Practices
- **Framework**: Uses Node.js built-in `node:test` and `node:assert/strict`. No external test frameworks.
- **Patterns**: Favors dependency injection (clocks, schedulers, mock engines) to keep tests fast, deterministic, and hermetic.
- **Coverage**: Tests cover WebSocket protocol, MCP tool validation, storage logic, and suggestion ranking.

### Performance & Safety
- **FTS5 Trigram**: Used for efficient text search across keys and summaries.
- **Optimistic Locking**: Supports `ifRevision` for concurrency control.
- **Token Efficiency**: Graph navigation (`map`) and search return metadata-only results to minimize LLM token usage.
- **Lazy Loading**: Embedding models are downloaded and loaded only on the first suggestion request.
