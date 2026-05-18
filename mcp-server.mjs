import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod/v4';

import memoryStoreModule from './src/memory-store.js';
import suggestionEngineModule from './src/suggestion-engine.js';
import mcpToolsModule from './src/mcp-tools.js';
import protocolModule from './src/protocol.js';

const { createMemoryStore } = memoryStoreModule;
const { createSuggestionEngine } = suggestionEngineModule;
const { createSharedMemoryToolHandlers, mcpToolResult } = mcpToolsModule;
const { RELATION_TYPE_LIST, MCP_TOOL_NAMES } = protocolModule;

const looseInput = z.any().optional();
const outputSchema = z.object({ ok: z.boolean() }).passthrough();

function persistenceFromEnv() {
    return process.env.MEMORY_FILE ? { file: process.env.MEMORY_FILE } : null;
}

function registerSharedMemoryTools(server, handlers) {
    server.registerTool(
        'memory_set',
        {
            title: 'Set Memory',
            description: 'Store a shared memory value with optional recall metadata.',
            inputSchema: z.object({
                key: looseInput,
                value: looseInput,
                summary: looseInput,
                tags: looseInput,
                importance: looseInput,
                ttlMs: looseInput,
                expiresAt: looseInput,
                ifRevision: looseInput,
            }),
            outputSchema,
        },
        async (input) => mcpToolResult(await handlers.memory_set(input)),
    );

    server.registerTool(
        'memory_get',
        {
            title: 'Get Memory',
            description: 'Read a full shared memory entry by key.',
            inputSchema: z.object({ key: looseInput }),
            outputSchema,
        },
        async (input) => mcpToolResult(await handlers.memory_get(input)),
    );

    server.registerTool(
        'memory_search',
        {
            title: 'Search Memory',
            description: 'Search memory metadata without returning full values.',
            inputSchema: z.object({
                query: looseInput,
                tags: looseInput,
                minImportance: looseInput,
                limit: looseInput,
            }),
            outputSchema,
        },
        async (input) => mcpToolResult(await handlers.memory_search(input)),
    );

    server.registerTool(
        'memory_suggest',
        {
            title: 'Suggest Memory',
            description: 'Return semantic memory suggestions for the current task context.',
            inputSchema: z.object({
                context: looseInput,
                tags: looseInput,
                limit: looseInput,
            }),
            outputSchema,
        },
        async (input) => mcpToolResult(await handlers.memory_suggest(input)),
    );

    server.registerTool(
        'memory_map',
        {
            title: 'Map Memory',
            description: 'Return a metadata-only graph neighborhood for a memory key.',
            inputSchema: z.object({
                key: looseInput,
                depth: looseInput,
                limit: looseInput,
            }),
            outputSchema,
        },
        async (input) => mcpToolResult(await handlers.memory_map(input)),
    );

    server.registerTool(
        'memory_relate',
        {
            title: 'Relate Memory',
            description: `Create or update a typed graph edge between two memory keys. Relations: ${RELATION_TYPE_LIST.join(', ')}.`,
            inputSchema: z.object({
                from: looseInput,
                to: looseInput,
                relation: looseInput,
                reason: looseInput,
                weight: looseInput,
            }),
            outputSchema,
        },
        async (input) => mcpToolResult(await handlers.memory_relate(input)),
    );

    server.registerTool(
        'memory_unrelate',
        {
            title: 'Unrelate Memory',
            description: 'Remove a typed graph edge between two memory keys.',
            inputSchema: z.object({
                from: looseInput,
                to: looseInput,
                relation: looseInput,
            }),
            outputSchema,
        },
        async (input) => mcpToolResult(await handlers.memory_unrelate(input)),
    );

    server.registerTool(
        'memory_export',
        {
            title: 'Export Memory Snapshot',
            description: 'Export the full shared memory graph snapshot, including values and relations.',
            inputSchema: z.object({}),
            outputSchema,
        },
        async (input) => mcpToolResult(await handlers.memory_export(input)),
    );

    server.registerTool(
        'memory_validate_import',
        {
            title: 'Validate Memory Snapshot Import',
            description: 'Validate a full memory graph snapshot without mutating current state.',
            inputSchema: z.object({
                snapshot: looseInput,
                mode: looseInput,
            }),
            outputSchema,
        },
        async (input) => mcpToolResult(await handlers.memory_validate_import(input)),
    );

    server.registerTool(
        'memory_import',
        {
            title: 'Import Memory Snapshot',
            description: 'Import a strictly validated memory graph snapshot in replace or merge mode.',
            inputSchema: z.object({
                snapshot: looseInput,
                mode: looseInput,
            }),
            outputSchema,
        },
        async (input) => mcpToolResult(await handlers.memory_import(input)),
    );

    server.registerTool(
        'memory_audit',
        {
            title: 'Audit Memory',
            description: 'Return zombie, orphan, duplicate, stale, and expired entry lists plus summary counts.',
            inputSchema: z.object({ staleMs: looseInput }),
            outputSchema,
        },
        async (input) => mcpToolResult(await handlers.memory_audit(input)),
    );

    server.registerTool(
        'memory_bulk_set',
        {
            title: 'Bulk Set Memory',
            description: 'Store multiple memory entries in one call with per-item failure isolation.',
            inputSchema: z.object({ entries: looseInput }),
            outputSchema,
        },
        async (input) => mcpToolResult(await handlers.memory_bulk_set(input)),
    );

    server.registerTool(
        'memory_bulk_relate',
        {
            title: 'Bulk Relate Memory',
            description: 'Create or update multiple graph edges in one call with per-item failure isolation.',
            inputSchema: z.object({ relations: looseInput }),
            outputSchema,
        },
        async (input) => mcpToolResult(await handlers.memory_bulk_relate(input)),
    );
}

export function createSharedMemoryMcpServer(options = {}) {
    const memory = options.memory || createMemoryStore({
        persistence: Object.prototype.hasOwnProperty.call(options, 'persistence')
            ? options.persistence
            : persistenceFromEnv(),
    });
    const suggestionEngine = options.suggestionEngine || createSuggestionEngine(options.suggestions || {});
    const handlers = createSharedMemoryToolHandlers({
        memory,
        suggestionEngine,
        updatedBy: options.updatedBy || 'mcp',
    });
    const server = new McpServer({
        name: 'shared-memory',
        version: '0.1.0',
    });

    registerSharedMemoryTools(server, handlers);

    return {
        server,
        memory,
        suggestionEngine,
        async close() {
            await memory.flush();
            if (suggestionEngine && typeof suggestionEngine.close === 'function') {
                await suggestionEngine.close();
            }
        },
    };
}

export { MCP_TOOL_NAMES };

async function main() {
    const app = createSharedMemoryMcpServer();
    const transport = new StdioServerTransport();

    const close = async () => {
        await app.close();
    };

    process.once('SIGINT', () => {
        close().finally(() => process.exit(130));
    });
    process.once('SIGTERM', () => {
        close().finally(() => process.exit(143));
    });

    await app.server.connect(transport);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
