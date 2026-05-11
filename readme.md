# sharedMemory

A local shared-memory server that lets multiple AI agents coordinate through a single, persistent memory graph. Built for multi-agent workflows where agents need to read and write shared state, subscribe to changes, and recall context without duplicating logic across every agent.

---

## What problem it solves

When multiple agents work on the same task — planning, coding, reviewing, summarizing — they each start from scratch. There's no shared context, no way to avoid duplicating work, and no record of decisions made earlier in the session. sharedMemory fixes this by giving every agent a common store they can read from and write to in real time.

Agents can store facts, decisions, code artifacts, and session notes as named entries with metadata (tags, importance, optional expiry). They can link entries together with typed edges to model relationships — "this decision *depends on* that constraint", "this task is the *next step* after that milestone". They can subscribe to keys and get notified the moment another agent updates them.

---

## How agents connect

Two protocols, same underlying store:

- **WebSocket** — for agents that connect at runtime and need live subscriptions, push notifications, and low-latency reads. This is the primary coordination interface.
- **MCP stdio** — for LLM integrations (Claude Desktop, any MCP-compatible client). Exposes the same memory as a set of tools (`memory_set`, `memory_get`, `memory_search`, `memory_map`, etc.) over standard I/O without needing a WebSocket client.

---

## Core capabilities

**Persistent memory graph.** Every entry has a key, a value, and structured metadata: a human-readable summary, tags, an importance score (0–10), and an optional TTL. Entries survive restarts when file persistence is enabled.

**Graph relations.** Entries link to each other via typed edges: `depends_on`, `supports`, `contradicts`, `mentions`, `derived_from`, `next_step`, `related_to`. The graph can be traversed with a BFS `map` query that returns a metadata-only neighborhood — low-token recall for LLMs.

**Full-text search.** Search across keys, summaries, and tags with tag and importance filters. Results are metadata-only (no values) to keep token cost low.

**Semantic suggestions.** When enabled, the server indexes summaries into an in-memory vector space using a local ONNX embedding model. Agents can ask "what do I already know that's relevant to *this* context?" and get ranked, semantically similar entries back — no exact-key lookup required.

**Live subscriptions.** Agents subscribe to keys and receive push updates whenever the value changes, gets deleted, or expires. Graph edge changes broadcast to subscribers of both endpoints.

**Memory hygiene.** A built-in audit surfaces zombies (entries with no tags, no summary, or importance 0), orphans (no graph connections), and duplicates. Entries with missing metadata trigger warnings on write. A dashboard badge alerts when the graph needs attention.

**Snapshot import/export.** The full graph — entries and edges — can be exported, validated, and re-imported in merge mode (safe, idempotent) or replace mode (full restore).

---

## Who it's for

- **Agent orchestration systems** that need shared state across multiple concurrent agents
- **LLM workflows** using Claude Desktop or any MCP client that benefit from persistent memory between sessions
- **Local development** of multi-agent pipelines where a lightweight, zero-dependency coordination layer beats spinning up a full database or message broker

---

## Stack

Node.js 24+, SQLite (`node:sqlite`), WebSocket (`ws`), Express. No build step. No external test framework — tests use Node's built-in `node:test`. Optional Hugging Face Transformers.js for semantic suggestions.

Full setup instructions and protocol reference: [guide.md](guide.md)
