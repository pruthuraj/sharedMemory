# Deterministic Memory Map Graph API With Notifications

## Summary
Add an API-first memory graph so agents can relate memories, recall nearby context cheaply, and receive compact notifications when subscribed memory nodes or incident relationships change. Existing clients remain compatible because graph commands and event types are additive.

## Key Changes
- Extend memory entries with `summary`, `tags`, `importance`, `updatedAt`, and `updatedBy`.
- Generate fallback summaries by safely stringifying values, collapsing whitespace, and capping length.
- Add graph commands:
  - `relate`: create or update a typed edge.
  - `unrelate`: idempotently remove a typed edge.
  - `delete`: remove a memory key and cascade inbound/outbound edges.
  - `map`: return a metadata-only graph neighborhood.
- Support relation types: `related_to`, `depends_on`, `supports`, `contradicts`, `mentions`, `derived_from`, and `next_step`.
- Reject invalid graph state:
  - Invalid importance, weight, depth, or limit.
  - Self-relations.
  - Relations where either endpoint key is missing.
- Add `/status.memoryCount` and `/status.relationCount`.

## Map And Notification Behavior
- `map` uses bidirectional breadth-first search with a visited set, so cycles cannot loop or duplicate nodes.
- Returned graph edges preserve original `from`, `to`, and `relation`.
- The root node is returned first; remaining nodes are sorted by importance descending, `updatedAt` descending, then key ascending before applying `limit`.
- Existing `update` messages remain for memory value changes and deletion.
- New `relation-update` messages report graph changes with actions `created`, `updated`, `deleted`, and `cascade-deleted`.
- Relation notifications are sent to subscribers of either edge endpoint and deduped so one WebSocket receives exactly one event even if subscribed to both endpoints.

## Test Plan
- Keep existing reliability and compatibility tests passing.
- Add tests for:
  - Metadata-aware `set` and fallback summary generation.
  - Invalid metadata and graph validation.
  - Relation create/update/delete lifecycle.
  - Self-relation and missing-node errors.
  - Cascading edge deletion.
  - Bidirectional BFS, cycle handling, deterministic sorting, and limit behavior.
  - Incident relation notifications and endpoint subscription dedupe.
  - Separate `update` and `relation-update` event behavior.
  - `/status.memoryCount` and `/status.relationCount`.
- Verify with:
  - `node --check server.js`
  - `node --check example_agent.js`
  - `node --check src/*.js`
  - `node --check test/*.js`
  - `npm test`

## Assumptions
- No persistence, auth, embeddings, semantic search, or visual dashboard in this pass.
- Importance is agent-supplied and server-validated.
- Graph recall is metadata-only by default to control token use.
- Protocol additions are backward-compatible and additive.
