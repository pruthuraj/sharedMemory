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

function createSharedMemoryServer(options = {}) {
    const app = express();
    const server = http.createServer(app);
    const wss = new WebSocket.Server({ server });
    const memory = options.memoryStore || createMemoryStore({ now: options.now });
    const agents = options.agentRegistry || createAgentRegistry({ genId: options.genId });

    app.get('/status', (req, res) => {
        res.json({
            agents: agents.ids(),
            connectedAgents: agents.connectedIds(),
            memoryKeys: memory.keys(),
            memoryCount: memory.count(),
            relationCount: memory.relationCount(),
        });
    });

    function publicEdge(edge) {
        if (!edge) return edge;
        const { id, ...rest } = edge;
        return rest;
    }

    wss.on('connection', (ws) => {
        let agentId = agents.createTemporary(ws);
        safeSend(ws, { type: 'welcome', agentId });

        ws.on('message', (raw) => {
            const parsed = parseMessage(raw);
            if (!parsed.ok) {
                safeSend(ws, { type: 'error', message: parsed.error });
                return;
            }

            const data = parsed.message;

            switch (data.type) {
                case 'register': {
                    const result = agents.register(agentId, data.agentId || agentId, ws);
                    if (!result.ok) {
                        safeSend(ws, { type: 'error', message: result.error });
                        break;
                    }

                    agentId = result.agentId;
                    safeSend(ws, { type: 'registered', agentId });
                    break;
                }

                case 'set': {
                    const entry = memory.set(data.key, data.value, agentId, {
                        summary: data.summary,
                        tags: data.tags,
                        importance: data.importance,
                    });
                    safeSend(ws, { type: 'ok', action: 'set', key: data.key });
                    notifyKeyUpdate(agents, data.key, entry);
                    notifyLinkedAgents(agents, agentId, { action: 'set', key: data.key, entry });
                    break;
                }

                case 'get': {
                    safeSend(ws, { type: 'result', key: data.key, entry: memory.get(data.key) });
                    break;
                }

                case 'subscribe': {
                    agents.subscribe(agentId, data.key);
                    safeSend(ws, { type: 'subscribed', key: data.key });

                    const entry = memory.get(data.key);
                    if (entry) {
                        safeSend(ws, { type: 'update', key: data.key, entry });
                    }
                    break;
                }

                case 'unsubscribe': {
                    agents.unsubscribe(agentId, data.key);
                    safeSend(ws, { type: 'unsubscribed', key: data.key });
                    break;
                }

                case 'link': {
                    agents.link(agentId, data.target);
                    safeSend(ws, { type: 'linked', target: data.target });
                    break;
                }

                case 'unlink': {
                    agents.unlink(agentId, data.target);
                    safeSend(ws, { type: 'unlinked', target: data.target });
                    break;
                }

                case 'list': {
                    safeSend(ws, {
                        type: 'list',
                        agents: agents.ids(),
                        memoryKeys: memory.keys(),
                    });
                    break;
                }

                case 'relate': {
                    const result = memory.relate(data.from, data.to, data.relation, agentId, {
                        reason: data.reason,
                        weight: data.weight,
                    });

                    if (!result.ok) {
                        safeSend(ws, { type: 'error', message: result.error });
                        break;
                    }

                    const edge = publicEdge(result.edge);
                    safeSend(ws, { type: 'related', action: result.action, edge });
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
                    });
                    notifyRelationUpdate(agents, 'deleted', edge);
                    break;
                }

                case 'delete': {
                    const result = memory.delete(data.key);
                    safeSend(ws, { type: 'deleted', key: data.key, removed: result.removed });
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
                        safeSend(ws, { type: 'error', message: 'missing-node' });
                        break;
                    }

                    safeSend(ws, { type: 'map-result', ...result });
                    break;
                }

                default:
                    safeSend(ws, { type: 'error', message: 'unknown-type' });
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

        close() {
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
