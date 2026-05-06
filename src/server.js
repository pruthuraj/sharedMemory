// WebSocket server wiring memory-store, agent-registry, protocol, and delivery into a single server.

const path = require('path');

const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const { createAgentRegistry } = require('./agent-registry');
const {
    notifyKeyUpdate,
    notifyLinkedAgents,
    notifyRelationUpdate,
    safeSend,
} = require('./delivery');
const { createMemoryStore } = require('./memory-store');
const { parseMessage, auditMetadata } = require('./protocol');
const { createSuggestionEngine } = require('./suggestion-engine');

const DEFAULT_PRUNE_INTERVAL_MS = 600000;

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * Create the shared memory HTTP+WebSocket server.
 *
 * @param {object} [options]
 * @param {string} [options.authToken] - Bearer token for WS and /status; falls back to MEMORY_TOKEN env var.
 * @param {number} [options.pruneIntervalMs=600000] - How often expired entries are swept automatically.
 * @param {object} [options.pruneScheduler] - Injectable {setInterval, clearInterval} for testing.
 * @param {object} [options.persistence] - Passed through to createMemoryStore; falls back to MEMORY_FILE env var.
 * @param {object} [options.memoryStore] - Pre-built store instance (for testing).
 * @param {object} [options.agentRegistry] - Pre-built registry instance (for testing).
 * @param {object} [options.suggestionEngine] - Pre-built suggestion engine instance (for testing).
 * @param {object} [options.suggestions] - Suggestion engine options.
 * @param {Function} [options.genId] - ID generator injected into agentRegistry (for testing).
 * @param {Function} [options.clock] - Clock function passed to createMemoryStore (for testing).
 */
function createSharedMemoryServer(options = {}) {
    const app = express();
    const server = http.createServer(app);
    const wss = new WebSocket.Server({ server });
    const configuredAuthToken = hasOwn(options, 'authToken') ? options.authToken : process.env.MEMORY_TOKEN;
    const authToken = typeof configuredAuthToken === 'string' && configuredAuthToken.length > 0
        ? configuredAuthToken
        : null;
    const pruneIntervalMs = options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;
    const pruneScheduler = options.pruneScheduler || {
        setInterval,
        clearInterval,
    };
    const persistence = options.persistence || (
        process.env.MEMORY_FILE ? { file: process.env.MEMORY_FILE } : null
    );
    const memory = options.memoryStore || createMemoryStore({
        clock: options.clock,
        now: options.now,
        persistence,
        pruneIntervalMs,
    });
    const agents = options.agentRegistry || createAgentRegistry({ genId: options.genId });
    const suggestionOptions = options.suggestions || {};
    const suggestionEngine = options.suggestionEngine || createSuggestionEngine({
        ...suggestionOptions,
        clock: suggestionOptions.clock || options.clock,
        now: suggestionOptions.now || options.now,
        logger: suggestionOptions.logger || options.logger,
    });
    const now = options.clock || options.now || Date.now;
    let pruneTimer = null;
    let lastExportedAt = null;
    let lastImportedAt = null;
    let lastImportStats = null;
    let cachedAuditAt = 0;
    let cachedAuditSummary = null;
    const AUDIT_CACHE_MS = 5000;
    const authenticatedSockets = new WeakSet();

    app.use(express.static(path.join(__dirname, '..', 'public')));

    app.get('/status', (req, res) => {
        if (authToken && req.get('authorization') !== `Bearer ${authToken}`) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }

        res.json({
            agents: agents.ids(),
            connectedAgents: agents.connectedIds(),
            memoryKeys: memory.keys(),
            memoryCount: memory.count(),
            relationCount: memory.relationCount(),
            ...memory.expiryStatus(),
            persistence: memory.persistenceStatus(),
            suggestions: suggestionStatus(),
            snapshot: snapshotStatus(),
            audit: auditSummary(),
        });
    });

    function auditSummary() {
        const t = now();
        if (cachedAuditSummary && t - cachedAuditAt < AUDIT_CACHE_MS) {
            return cachedAuditSummary;
        }
        const full = memory.audit();
        cachedAuditSummary = {
            zombieCount: full.counts.zombies,
            orphanCount: full.counts.orphans,
            duplicateGroupCount: full.counts.duplicates,
            staleCount: full.counts.stale,
            expiredCount: full.counts.expired,
        };
        cachedAuditAt = t;
        return cachedAuditSummary;
    }

    // Strips the internal edge id before sending to clients; id is a server-side index key only.
    function publicEdge(edge) {
        if (!edge) return edge;
        const { id, ...rest } = edge;
        return rest;
    }

    function notifyPruned(result) {
        for (const key of result.keys) {
            notifyKeyUpdate(agents, key, null, { action: 'expired' });
            removeSuggestionMemory(key);
        }

        for (const removedEdge of result.removedEdges) {
            notifyRelationUpdate(agents, 'cascade-deleted', publicEdge(removedEdge));
        }
    }

    function logSuggestionError(action, key, error) {
        const logger = options.logger || console;
        if (logger && typeof logger.error === 'function') {
            logger.error(`Failed to ${action} suggestion memory ${key}: ${error.message}`);
        }
    }

    function suggestionStatus() {
        if (suggestionEngine && typeof suggestionEngine.status === 'function') {
            return suggestionEngine.status();
        }

        return {
            enabled: false,
            modelId: null,
            modelLoaded: false,
            activeIndexedCount: 0,
            queuedUpdateCount: 0,
            processing: false,
            lastIndexedAt: null,
            lastIndexError: null,
        };
    }

    function snapshotStatus() {
        return {
            lastExportedAt,
            lastImportedAt,
            lastImportStats,
        };
    }

    function snapshotStats(snapshot) {
        return {
            entryCount: Object.keys(snapshot.entries).length,
            edgeCount: snapshot.edges.length,
        };
    }

    function sendStoreError(ws, result, requestId) {
        const response = {
            type: 'error',
            message: result.error,
            requestId,
        };

        if (hasOwn(result, 'key')) response.key = result.key;
        if (hasOwn(result, 'currentRevision')) response.currentRevision = result.currentRevision;
        safeSend(ws, response);
    }

    function upsertSuggestionMemory(key, entry) {
        if (!suggestionEngine || typeof suggestionEngine.upsertMemory !== 'function') return;
        Promise.resolve(suggestionEngine.upsertMemory(key, entry))
            .catch((error) => logSuggestionError('upsert', key, error));
    }

    function removeSuggestionMemory(key) {
        if (!suggestionEngine || typeof suggestionEngine.removeMemory !== 'function') return;
        Promise.resolve(suggestionEngine.removeMemory(key))
            .catch((error) => logSuggestionError('remove', key, error));
    }

    function refreshSuggestionsAfterImport(previousKeys, mode = 'replace') {
        const visibleKeys = new Set(memory.keys());
        if (mode === 'replace') {
            for (const key of previousKeys) {
                if (!visibleKeys.has(key)) {
                    removeSuggestionMemory(key);
                }
            }
        }

        if (mode === 'replace') {
            for (const key of visibleKeys) {
                const entry = memory.get(key);
                if (entry) {
                    upsertSuggestionMemory(key, entry);
                }
            }
            return;
        }

        for (const key of visibleKeys) {
            if (previousKeys.has(key)) continue;
            const entry = memory.get(key);
            if (entry) {
                upsertSuggestionMemory(key, entry);
            }
        }
    }

    function notifySnapshotImported(stats, mode = 'replace') {
        for (const client of wss.clients) {
            if (authToken && !authenticatedSockets.has(client)) continue;
            safeSend(client, {
                type: 'snapshot-update',
                action: 'imported',
                mode,
                stats,
            });
        }
    }

    for (const key of memory.keys()) {
        const entry = memory.get(key);
        if (entry) {
            upsertSuggestionMemory(key, entry);
        }
    }

    if (pruneIntervalMs > 0) {
        pruneTimer = pruneScheduler.setInterval(() => {
            const result = memory.pruneExpired();
            if (result.count > 0 || result.removedEdges.length > 0) {
                notifyPruned(result);
            }
        }, pruneIntervalMs);
        if (pruneTimer && typeof pruneTimer.unref === 'function') {
            pruneTimer.unref();
        }
    }

    wss.on('connection', (ws) => {
        let agentId = agents.createTemporary(ws);
        let isAuthenticated = !authToken;
        if (isAuthenticated) {
            authenticatedSockets.add(ws);
        }
        safeSend(ws, { type: 'welcome', agentId });

        ws.on('message', async (raw) => {
            const parsed = parseMessage(raw);
            if (!parsed.ok) {
                safeSend(ws, { type: 'error', message: parsed.error, requestId: parsed.requestId });
                return;
            }

            const data = parsed.message;
            const requestId = data.requestId;

            if (data.type === 'auth') {
                if (!authToken || data.token === authToken) {
                    isAuthenticated = true;
                    authenticatedSockets.add(ws);
                    safeSend(ws, { type: 'authenticated', requestId });
                } else {
                    safeSend(ws, { type: 'error', message: 'unauthorized', requestId });
                }
                return;
            }

            if (!isAuthenticated) {
                safeSend(ws, { type: 'error', message: 'unauthorized', requestId });
                return;
            }

            switch (data.type) {
                case 'register': {
                    const result = agents.register(agentId, data.agentId || agentId, ws);
                    if (!result.ok) {
                        safeSend(ws, { type: 'error', message: result.error, requestId });
                        break;
                    }

                    agentId = result.agentId;
                    safeSend(ws, { type: 'registered', agentId, requestId });
                    break;
                }

                case 'set': {
                    const metadata = {
                        summary: data.summary,
                        tags: data.tags,
                        importance: data.importance,
                        ttlMs: data.ttlMs,
                        expiresAt: data.expiresAt,
                    };
                    if (hasOwn(data, 'ifRevision')) metadata.ifRevision = data.ifRevision;

                    const entry = memory.set(data.key, data.value, agentId, metadata);
                    if (entry && entry.ok === false) {
                        sendStoreError(ws, entry, requestId);
                        break;
                    }

                    const setWarnings = auditMetadata(data);
                    const setResponse = {
                        type: 'ok',
                        action: 'set',
                        key: data.key,
                        revision: entry.revision,
                        requestId,
                    };
                    if (setWarnings.length > 0) setResponse.warnings = setWarnings;
                    safeSend(ws, setResponse);
                    upsertSuggestionMemory(data.key, entry);
                    notifyKeyUpdate(agents, data.key, entry);
                    notifyLinkedAgents(agents, agentId, { action: 'set', key: data.key, entry });
                    break;
                }

                case 'get': {
                    safeSend(ws, { type: 'result', key: data.key, entry: memory.get(data.key), requestId });
                    break;
                }

                case 'subscribe': {
                    agents.subscribe(agentId, data.key);
                    safeSend(ws, { type: 'subscribed', key: data.key, requestId });

                    const entry = memory.get(data.key);
                    if (entry) {
                        safeSend(ws, { type: 'update', key: data.key, entry });
                    }
                    break;
                }

                case 'unsubscribe': {
                    agents.unsubscribe(agentId, data.key);
                    safeSend(ws, { type: 'unsubscribed', key: data.key, requestId });
                    break;
                }

                case 'touch': {
                    const metadata = {
                        ttlMs: data.ttlMs,
                        expiresAt: data.expiresAt,
                    };
                    if (hasOwn(data, 'ifRevision')) metadata.ifRevision = data.ifRevision;

                    const result = memory.touch(data.key, agentId, metadata);

                    if (!result.ok) {
                        sendStoreError(ws, result, requestId);
                        break;
                    }

                    safeSend(ws, { type: 'touched', key: data.key, entry: result.entry, requestId });
                    upsertSuggestionMemory(data.key, result.entry);
                    notifyKeyUpdate(agents, data.key, result.entry);
                    break;
                }

                case 'link': {
                    agents.link(agentId, data.target);
                    safeSend(ws, { type: 'linked', target: data.target, requestId });
                    break;
                }

                case 'unlink': {
                    agents.unlink(agentId, data.target);
                    safeSend(ws, { type: 'unlinked', target: data.target, requestId });
                    break;
                }

                case 'list': {
                    safeSend(ws, {
                        type: 'list',
                        agents: agents.ids(),
                        memoryKeys: memory.keys(),
                        requestId,
                    });
                    break;
                }

                case 'relate': {
                    const result = memory.relate(data.from, data.to, data.relation, agentId, {
                        reason: data.reason,
                        weight: data.weight,
                    });

                    if (!result.ok) {
                        safeSend(ws, { type: 'error', message: result.error, requestId });
                        break;
                    }

                    const edge = publicEdge(result.edge);
                    safeSend(ws, { type: 'related', action: result.action, edge, requestId });
                    notifyRelationUpdate(agents, result.action, edge);
                    break;
                }

                case 'unrelate': {
                    const result = memory.unrelate(data.from, data.to, data.relation);
                    const edge = publicEdge(result.edge);
                    safeSend(ws, {
                        type: 'unrelated',
                        from: data.from,
                        to: data.to,
                        relation: data.relation,
                        requestId,
                    });
                    if (result.removed) {
                        notifyRelationUpdate(agents, 'deleted', edge);
                    }
                    break;
                }

                case 'delete': {
                    const options = {};
                    if (hasOwn(data, 'ifRevision')) options.ifRevision = data.ifRevision;

                    const result = memory.delete(data.key, options);
                    if (result.ok === false) {
                        sendStoreError(ws, result, requestId);
                        break;
                    }

                    safeSend(ws, {
                        type: 'deleted',
                        key: data.key,
                        removed: result.removed,
                        revision: result.revision,
                        requestId,
                    });
                    if (result.removed) {
                        removeSuggestionMemory(data.key);
                        notifyKeyUpdate(agents, data.key, null, { action: 'deleted' });
                    }

                    for (const removedEdge of result.removedEdges) {
                        notifyRelationUpdate(agents, 'cascade-deleted', publicEdge(removedEdge));
                    }
                    break;
                }

                case 'map': {
                    const result = memory.map(data.key, {
                        depth: data.depth,
                        limit: data.limit,
                    });

                    if (!result) {
                        safeSend(ws, { type: 'error', message: 'missing-node', requestId });
                        break;
                    }

                    safeSend(ws, { type: 'map-result', ...result, requestId });
                    break;
                }

                case 'search': {
                    const { results, total } = memory.search({
                        query: data.query,
                        tags: data.tags,
                        minImportance: data.minImportance,
                        limit: data.limit,
                    });
                    safeSend(ws, { type: 'search-result', results, total, requestId });
                    break;
                }

                case 'suggest': {
                    try {
                        const suggestions = await suggestionEngine.suggest({
                            context: data.context,
                            tags: data.tags,
                            limit: data.limit,
                            agentId,
                        });
                        safeSend(ws, { type: 'suggest-result', suggestions, requestId });
                    } catch (error) {
                        safeSend(ws, { type: 'error', message: 'suggest-failed', requestId });
                        logSuggestionError('run', 'context', error);
                    }
                    break;
                }

                case 'bulk_set': {
                    const result = memory.bulkSet(data.entries, agentId);
                    safeSend(ws, { type: 'bulk-set-result', results: result.results, requestId });
                    for (let i = 0; i < result.results.length; i++) {
                        const r = result.results[i];
                        if (!r.ok) continue;
                        const entry = memory.get(r.key);
                        if (entry) {
                            upsertSuggestionMemory(r.key, entry);
                            notifyKeyUpdate(agents, r.key, entry);
                        }
                    }
                    break;
                }

                case 'bulk_relate': {
                    const result = memory.bulkRelate(data.relations, agentId);
                    safeSend(ws, { type: 'bulk-relate-result', results: result.results, requestId });
                    for (const r of result.results) {
                        if (r.ok) notifyRelationUpdate(agents, r.action, publicEdge(r.edge));
                    }
                    break;
                }

                case 'audit': {
                    const result = memory.audit({ staleMs: data.staleMs });
                    safeSend(ws, { type: 'audit-result', ...result, requestId });
                    break;
                }

                case 'prune': {
                    const result = memory.pruneExpired();
                    safeSend(ws, { type: 'pruned', keys: result.keys, count: result.count, requestId });
                    notifyPruned(result);
                    break;
                }

                case 'export': {
                    const snapshot = memory.exportState();
                    const stats = snapshotStats(snapshot);
                    lastExportedAt = now();
                    safeSend(ws, { type: 'export-result', snapshot, stats, requestId });
                    break;
                }

                case 'validate-import': {
                    const mode = data.mode === 'merge' ? 'merge' : 'replace';
                    const existingState = mode === 'merge' ? memory.exportState() : null;
                    const result = memory.validateSnapshot(data.snapshot, mode === 'merge' ? {
                        mode,
                        existingKeys: new Set(Object.keys(existingState.entries)),
                        existingEdgeIds: new Set(existingState.edges.map((edge) => `${edge.from}\u001f${edge.relation}\u001f${edge.to}`)),
                    } : {});
                    safeSend(ws, {
                        type: 'import-validation',
                        ok: result.ok,
                        errors: result.errors,
                        stats: result.stats,
                        ...(mode === 'merge' ? { mode } : {}),
                        requestId,
                    });
                    break;
                }

                case 'import': {
                    const mode = data.mode === 'merge' ? 'merge' : 'replace';
                    const previousKeys = new Set(Object.keys(memory.exportState().entries));
                    const result = memory.importSnapshot(data.snapshot, { mode });
                    if (!result.ok) {
                        safeSend(ws, {
                            type: 'import-result',
                            ok: false,
                            error: 'invalid-snapshot',
                            errors: result.errors,
                            requestId,
                        });
                        break;
                    }

                    lastImportedAt = now();
                    lastImportStats = result.stats;
                    refreshSuggestionsAfterImport(previousKeys, mode);
                    safeSend(ws, {
                        type: 'import-result',
                        ok: true,
                        ...(mode === 'merge' ? { mode } : {}),
                        stats: result.stats,
                        requestId,
                    });
                    notifySnapshotImported(result.stats, mode);
                    break;
                }

                default:
                    safeSend(ws, { type: 'error', message: 'unknown-type', requestId });
            }
        });

        ws.on('close', () => {
            agents.disconnect(agentId, ws);
        });
    });

    return {
        app,
        server,
        wss,
        agents,
        memory,
        suggestionEngine,

        listen(...args) {
            return server.listen(...args);
        },

        // Flushes memory, terminates all WS clients, then closes both WSS and HTTP server.
        // ERR_SERVER_NOT_RUNNING is swallowed so double-close in tests doesn't throw.
        async close() {
            if (pruneTimer) {
                pruneScheduler.clearInterval(pruneTimer);
                pruneTimer = null;
            }

            await memory.flush();
            if (suggestionEngine && typeof suggestionEngine.close === 'function') {
                await suggestionEngine.close();
            }

            for (const client of wss.clients) {
                client.terminate();
            }

            return new Promise((resolve, reject) => {
                wss.close((wssError) => {
                    server.close((serverError) => {
                        const error = wssError || serverError;
                        if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
                            reject(error);
                            return;
                        }
                        resolve();
                    });
                });
            });
        },
    };
}

module.exports = {
    createSharedMemoryServer,
};
