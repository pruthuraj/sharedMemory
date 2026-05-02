# Deterministic Memory Map Graph API With Notifications

## Summary

Add an API-first memory graph so agents can relate memories, recall nearby context cheaply, and receive compact notifications when subscribed memory nodes or incident relationships change. Existing clients remain compatible because all graph commands and event types are additive.

## Key Changes

- Extend memory entries with graph-friendly metadata:
  - `summary`, `tags`, `importance`, `updatedAt`, `updatedBy`.
  - If `summary` is omitted, generate a compact fallback by safely stringifying `value`, collapsing whitespace, and capping length.
  - Reject invalid `importance`; do not silently clamp.
- Add graph commands:
  - `relate`: creates or updates a typed edge.
  - `unrelate`: idempotently removes a typed edge.
  - `delete`: removes a memory key and cascades all inbound/outbound edges.
  - `map`: returns metadata-only graph neighborhood results.
- Supported relation types:
  - `related_to`, `depends_on`, `supports`, `contradicts`, `mentions`, `derived_from`, `next_step`.
- Edge shape:
  - `from`, `to`, `relation`, optional `reason`, optional `weight`, `updatedAt`, `updatedBy`.
  - Reject self-edges with `self-relation-not-allowed`.
  - Require both endpoint keys to exist; otherwise return `missing-node`.
  - Duplicate edge identity is deterministic: `from + relation + to`.

## Map Behavior

- `map` uses breadth-first search with a queue.
- Traversal is bidirectional by default: inbound and outbound edges are both considered.
- Returned edges preserve original `from`, `to`, and `relation`.
- Maintain a visited key set so cycles cannot duplicate nodes or loop forever.
- Return metadata only by default; full `value` remains available through `get`.
- Sort nodes deterministically before applying limits:
  - `importance` descending.
  - `updatedAt` descending.
  - `key` ascending.
- Add `/status.memoryCount` and `/status.relationCount`.

## Subscription Events

- Existing `update` remains for memory value changes.
- Add `relation-update` for graph topology changes.
- A subscriber to key `X` receives relation events for edges where `X` is either `from` or `to`.
- If one WebSocket subscribes to both edge endpoints, send exactly one `relation-update`.
- Relation event actions:
  - `created`
  - `updated`
  - `deleted`
  - `cascade-deleted`
- On `delete`, send:
  - `update` with `entry: null` and `action: "deleted"` for the deleted node.
  - `relation-update` with `action: "cascade-deleted"` for removed incident edges.
- Implement delivery dedupe by collecting subscribed WebSocket targets into a `Set` before dispatch.

## Implementation Notes

- Keep graph state inside `src/memory-store.js` so entry lifecycle and edge lifecycle are handled together.
- Keep validation in `src/protocol.js`:
  - Validate new command names.
  - Validate required fields.
  - Validate relation type, weight range, importance range, depth, and limit.
- Keep routing in `src/server.js`:
  - Route graph commands after validation.
  - Emit normal acknowledgements for successful graph mutations.
  - Emit `relation-update` only after store mutation succeeds.
- Keep `src/delivery.js` responsible for exactly-once notification dispatch.
- Same-agent clients should wait for `set` ack before sending `relate`.

## Test Plan

- Existing tests must continue passing.
- Add tests for:
  - `set` with metadata.
  - fallback summary generation.
  - invalid metadata rejection.
  - `relate` create and update behavior.
  - self-relation rejection.
  - missing-node relation errors.
  - `unrelate` idempotency.
  - `delete` cascading inbound and outbound edges.
  - `map` bidirectional BFS traversal.
  - cycle-safe traversal using visited nodes.
  - deterministic sorting and limit behavior.
  - relation notifications for subscribed incident keys.
  - no duplicate notification when one client subscribes to both endpoints.
  - separate `update` versus `relation-update` event behavior.
  - `/status.memoryCount` and `/status.relationCount`.

## Assumptions

- No persistence, auth, embeddings, semantic search, or visual dashboard in this pass.
- Importance is agent-supplied and server-validated.
- Graph recall is metadata-only by default to control token use.
- Protocol additions are backward-compatible and additive.
