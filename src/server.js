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
const { parseMessage } = require('./protocol');

const DEFAULT_PRUNE_INTERVAL_MS = 600000;

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

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
    let pruneTimer = null;

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
        });
    });

    function publicEdge(edge) {
        if (!edge) return edge;
        const { id, ...rest } = edge;
        return rest;
    }

    function notifyPruned(result) {
        for (const key of result.keys) {
            notifyKeyUpdate(agents, key, null, { action: 'expired' });
        }

        for (const removedEdge of result.removedEdges) {
            notifyRelationUpdate(agents, 'cascade-deleted', publicEdge(removedEdge));
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
        safeSend(ws, { type: 'welcome', agentId });

        ws.on('message', (raw) => {
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
                    const entry = memory.set(data.key, data.value, agentId, {
                        summary: data.summary,
                        tags: data.tags,
                        importance: data.importance,
                        ttlMs: data.ttlMs,
                        expiresAt: data.expiresAt,
                    });
                    safeSend(ws, { type: 'ok', action: 'set', key: data.key, requestId });
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
                    const result = memory.touch(data.key, agentId, {
                        ttlMs: data.ttlMs,
                        expiresAt: data.expiresAt,
                    });

                    if (!result.ok) {
                        safeSend(ws, { type: 'error', message: result.error, requestId });
                        break;
                    }

                    safeSend(ws, { type: 'touched', key: data.key, entry: result.entry, requestId });
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
                    const edge = publicEdge(memory.unrelate(data.from, data.to, data.relation));
                    safeSend(ws, {
                        type: 'unrelated',
                        from: data.from,
                        to: data.to,
                        relation: data.relation,
                        requestId,
                    });
                    notifyRelationUpdate(agents, 'deleted', edge);
                    break;
                }

                case 'delete': {
                    const result = memory.delete(data.key);
                    safeSend(ws, { type: 'deleted', key: data.key, removed: result.removed, requestId });
                    notifyKeyUpdate(agents, data.key, null, { action: 'deleted' });

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

                case 'prune': {
                    const result = memory.pruneExpired();
                    safeSend(ws, { type: 'pruned', keys: result.keys, count: result.count, requestId });
                    notifyPruned(result);
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

        listen(...args) {
            return server.listen(...args);
        },

        async close() {
            if (pruneTimer) {
                pruneScheduler.clearInterval(pruneTimer);
                pruneTimer = null;
            }

            await memory.flush();

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
