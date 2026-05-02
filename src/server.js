const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const { createAgentRegistry } = require('./agent-registry');
const { notifyKeyUpdate, notifyLinkedAgents, safeSend } = require('./delivery');
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
        });
    });

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
                    const entry = memory.set(data.key, data.value, agentId);
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
