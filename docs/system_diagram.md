# sharedMemory System Diagram

## High-Level Architecture

```mermaid
flowchart LR
    subgraph Clients["Clients"]
        WSAgents["WebSocket agents"]
        HTTPClient["HTTP status client"]
        MCPClient["MCP client"]
        SmokeClient["Manual suggestion smoke script"]
    end

    subgraph Entrypoints["Entrypoints"]
        RootServer["server.js"]
        MCPServer["mcp-server.mjs"]
        SmokeScript["scripts/smoke-suggest.js"]
    end

    subgraph WebSocketRuntime["WebSocket runtime"]
        SharedServer["src/server.js"]
        Protocol["src/protocol.js"]
        Registry["src/agent-registry.js"]
        Delivery["src/delivery.js"]
    end

    subgraph StateLayer["State and recall"]
        MemoryStore["src/memory-store.js<br/>graph, TTL, search, snapshots, revisions"]
        SQLite["SQLite via node:sqlite"]
        SuggestionEngine["src/suggestion-engine.js"]
        VectorIndex["src/vector-index.js"]
        Ranking["src/suggestion-ranking.js"]
        Embedder["src/embedding-adapter.js"]
        HFModel["Transformers.js model"]
    end

    subgraph MCPAdapter["Official stdio MCP adapter"]
        MCPTools["src/mcp-tools.js"]
    end

    WSAgents -->|"JSON WebSocket commands"| SharedServer
    HTTPClient -->|"GET /status"| SharedServer
    SmokeClient --> SmokeScript
    SmokeScript -->|"WebSocket suggest smoke"| SharedServer
    RootServer --> SharedServer

    SharedServer --> Protocol
    SharedServer --> Registry
    SharedServer --> MemoryStore
    SharedServer --> SuggestionEngine
    SharedServer --> Delivery
    Delivery -->|"update relation-update linked"| WSAgents

    MCPClient -->|"stdio JSON-RPC"| MCPServer
    MCPServer --> MCPTools
    MCPTools --> MemoryStore
    MCPTools --> SuggestionEngine

    MemoryStore --> SQLite
    SuggestionEngine --> VectorIndex
    SuggestionEngine --> Ranking
    SuggestionEngine --> Embedder
    Embedder --> HFModel
```

## WebSocket Command Flow

```mermaid
sequenceDiagram
    participant Agent as "WebSocket agent"
    participant Server as "src/server.js"
    participant Protocol as "src/protocol.js"
    participant Auth as "transport auth state"
    participant Store as "src/memory-store.js"
    participant Registry as "src/agent-registry.js"
    participant Delivery as "src/delivery.js"
    participant Suggest as "src/suggestion-engine.js"

    Agent->>Server: "JSON message"
    Server->>Protocol: "parseMessage(raw)"
    Protocol-->>Server: "validated command or error"

    alt "auth enabled and socket is unauthenticated"
        Server-->>Agent: "error unauthorized"
    else "validated command"
        Server->>Store: "mutate, read, export, or import graph"
        Server->>Registry: "register subscribe link state"
        Server->>Suggest: "enqueue upsert or removal when needed"
        Server-->>Agent: "direct ack or result with requestId"
        Server->>Delivery: "fan out subscriber or linked events"
        Delivery-->>Agent: "broadcasts without requestId"
    end
```

## Memory Store Model

```mermaid
erDiagram
    MEMORY_ENTRIES {
        string key PK
        json value_json
        string summary
        int importance
        int revision
        int expires_at
        int updated_at
        string updated_by
    }

    MEMORY_TAGS {
        string key FK
        string tag
    }

    MEMORY_RELATIONS {
        string id PK
        string from_key FK
        string to_key FK
        string relation
        string reason
        number weight
        int updated_at
        string updated_by
    }

    MEMORY_FTS {
        string key
        string summary
        string tags_text
    }

    MEMORY_ENTRIES ||--o{ MEMORY_TAGS : "has tags"
    MEMORY_ENTRIES ||--o{ MEMORY_RELATIONS : "from endpoint"
    MEMORY_ENTRIES ||--o{ MEMORY_RELATIONS : "to endpoint"
    MEMORY_ENTRIES ||--|| MEMORY_FTS : "indexed by"
```

## Graph Recall Flow

```mermaid
flowchart TD
    Start["map(key, depth, limit)"] --> VisibleRoot{"root exists and not expired?"}
    VisibleRoot -->|"no"| Missing["return null"]
    VisibleRoot -->|"yes"| Queue["BFS queue starts with root"]
    Queue --> Incident["load visible inbound and outbound edges"]
    Incident --> SkipExpired["skip edges touching expired nodes"]
    SkipExpired --> Visited["visited Set prevents cycles"]
    Visited --> MoreDepth{"depth remaining?"}
    MoreDepth -->|"yes"| Queue
    MoreDepth -->|"no"| Sort["sort nodes by importance, updatedAt, key"]
    Sort --> Limit["apply node limit with root first"]
    Limit --> Edges["return edges where both endpoints selected"]
    Edges --> Result["metadata-only map-result"]
```

## Versioned Write Flow

```mermaid
sequenceDiagram
    participant Agent as "Agent"
    participant Server as "src/server.js or src/mcp-tools.js"
    participant Store as "src/memory-store.js"
    participant SQLite as "SQLite entries"

    Agent->>Server: "set/touch/delete with optional ifRevision"
    Server->>Store: "mutation request"
    Store->>SQLite: "read current revision"
    alt "ifRevision omitted"
        Store->>SQLite: "write using next revision"
        Store-->>Server: "success with revision"
    else "ifRevision matches"
        Store->>SQLite: "write using next revision"
        Store-->>Server: "success with revision"
    else "ifRevision mismatch"
        Store-->>Server: "revision-conflict with currentRevision"
        Server-->>Agent: "structured error"
    end
```

## Snapshot Flow

```mermaid
sequenceDiagram
    participant Client as "WebSocket or MCP client"
    participant Router as "src/server.js or src/mcp-tools.js"
    participant Store as "src/memory-store.js"
    participant Suggest as "src/suggestion-engine.js"
    participant Delivery as "src/delivery.js"

    Client->>Router: "export"
    Router->>Store: "exportState()"
    Store-->>Router: "snapshot with entries and edges"
    Router-->>Client: "snapshot plus stats"

    Client->>Router: "validate-import(snapshot)"
    Router->>Store: "validateSnapshot(snapshot)"
    Store-->>Router: "ok/errors/stats without mutation"
    Router-->>Client: "validation result"

    Client->>Router: "import(snapshot)"
    Router->>Store: "validateSnapshot(snapshot)"
    alt "invalid"
        Store-->>Router: "errors"
        Router-->>Client: "invalid-snapshot"
    else "valid"
        Router->>Store: "replace current graph"
        Router->>Suggest: "remove old keys and upsert visible imported keys"
        Router-->>Client: "import-result ok"
        Router->>Delivery: "snapshot-update imported"
    end
```

## Notification Rules

```mermaid
flowchart LR
    Mutation["Store mutation"] --> Kind{"mutation kind"}

    Kind -->|"set or touch"| KeyUpdate["update with entry"]
    Kind -->|"delete existing key"| KeyDeleted["update with entry null and action deleted"]
    Kind -->|"delete missing key"| NoDeleteBroadcast["no subscriber delete broadcast"]
    Kind -->|"prune expired key"| KeyExpired["update with entry null and action expired"]
    Kind -->|"relate create or update"| RelationChanged["relation-update created or updated"]
    Kind -->|"unrelate existing edge"| RelationDeleted["relation-update deleted"]
    Kind -->|"unrelate missing edge"| NoRelationBroadcast["no relation-update"]
    Kind -->|"delete or prune incident edges"| Cascade["relation-update cascade-deleted"]
    Kind -->|"replace-mode import"| SnapshotUpdate["snapshot-update imported"]

    KeyUpdate --> Subscribers["subscribers to key"]
    KeyDeleted --> Subscribers
    KeyExpired --> Subscribers
    RelationChanged --> IncidentSubscribers["subscribers to from or to"]
    RelationDeleted --> IncidentSubscribers
    Cascade --> IncidentSubscribers
    SnapshotUpdate --> ActiveClients["active authenticated clients"]
```

## MCP Tool Flow

```mermaid
sequenceDiagram
    participant Client as "MCP client"
    participant Adapter as "mcp-server.mjs"
    participant Tools as "src/mcp-tools.js"
    participant Store as "src/memory-store.js"
    participant Suggest as "src/suggestion-engine.js"

    Client->>Adapter: "initialize"
    Adapter-->>Client: "serverInfo and capabilities"
    Client->>Adapter: "notifications/initialized"
    Client->>Adapter: "tools/list"
    Adapter-->>Client: "memory_set memory_get memory_search memory_suggest memory_map memory_export memory_validate_import memory_import"

    Client->>Adapter: "tools/call"
    Adapter->>Tools: "handler input"
    alt "memory_set memory_get memory_search memory_map memory_export memory_validate_import memory_import"
        Tools->>Store: "direct store call"
        Store-->>Tools: "entry or metadata result"
    else "memory_suggest"
        Tools->>Store: "refresh visible keys"
        Tools->>Suggest: "flush queue and suggest"
        Suggest-->>Tools: "metadata-only suggestions"
    end
    Tools-->>Adapter: "JSON envelope"
    Adapter-->>Client: "JSON text content and structuredContent"
```

## Operational Modes

| Mode                 | Entry                                   | Persistence                                   | Suggestions                                     | Auth                                   |
| -------------------- | --------------------------------------- | --------------------------------------------- | ----------------------------------------------- | -------------------------------------- |
| Local WebSocket dev  | `npm start`                             | In-process SQLite unless `MEMORY_FILE` is set | Disabled by default                             | Disabled unless `MEMORY_TOKEN` is set  |
| Persistent WebSocket | `MEMORY_FILE=data/memory.db npm start`  | File-backed SQLite WAL                        | Disabled by default                             | Optional bearer token                  |
| Semantic WebSocket   | `MEMORY_SUGGEST_ENABLED=true npm start` | Same as server config                         | Enabled and lazy-loads model on first embedding | Optional bearer token                  |
| MCP stdio            | `npm run mcp`                           | Honors `MEMORY_FILE`                          | Disabled unless explicitly enabled              | `MEMORY_TOKEN` ignored for local stdio |
| Real-model smoke     | `npm run smoke:suggest`                 | Uses running WebSocket server                 | Requires server suggestions enabled             | Uses `MEMORY_TOKEN` if configured      |

## Verification Surface

```mermaid
flowchart TD
    Checks["Verification"] --> Syntax["node --check runtime, source, script, and test files"]
    Checks --> Unit["node:test unit coverage"]
    Checks --> WS["WebSocket integration tests"]
    Checks --> MCPHandlers["MCP handler tests"]
    Checks --> MCPStdio["MCP stdio child-process JSON-RPC test"]
    Checks --> ManualSmoke["manual real Transformers.js smoke"]

    Unit --> StoreTests["memory-store graph, TTL, SQLite, search"]
    WS --> ServerTests["auth, requestId, notifications, prune, suggest"]
    MCPHandlers --> ToolTests["tool envelopes and domain failures"]
    MCPStdio --> ProtocolTests["initialize, tools/list, tools/call"]
    MCPStdio --> SnapshotTests["snapshot export/import roundtrip"]
    ManualSmoke --> RealModel["model load and semantic suggestions"]
```
