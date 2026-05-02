const express = require('express');
const http = require('http');
const WebSocket = require('ws');

function genId() {
    return 'agent_' + Math.random().toString(36).slice(2, 10);
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// In-memory shared memory store
const memory = {}; // key -> { value, updatedAt, updatedBy }

// Agents map: agentId -> { ws, subscriptions: Set, links: Set }
const agents = new Map();

app.get('/status', (req, res) => {
    res.json({ agents: Array.from(agents.keys()), memoryKeys: Object.keys(memory) });
});

function safeSend(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
}

function notifyKeyUpdate(key, entry) {
    for (const [id, info] of agents.entries()) {
        if (info.subscriptions && info.subscriptions.has(key)) {
            safeSend(info.ws, { type: 'update', key, entry });
        }
    }
}

function notifyLinkedAgents(fromAgentId, msg) {
    const info = agents.get(fromAgentId);
    if (!info || !info.links) return;
    for (const target of info.links) {
        const t = agents.get(target);
        if (t) safeSend(t.ws, { type: 'linked', from: fromAgentId, payload: msg });
    }
}

wss.on('connection', (ws) => {
    let agentId = genId();
    // Temporary record until registration
    agents.set(agentId, { ws, subscriptions: new Set(), links: new Set() });
    safeSend(ws, { type: 'welcome', agentId });

    ws.on('message', (msg) => {
        let data = null;
        try { data = JSON.parse(msg); } catch (e) {
            safeSend(ws, { type: 'error', message: 'invalid-json' });
            return;
        }

        const info = agents.get(agentId) || {};

        switch (data.type) {
            case 'register': {
                const newId = data.agentId || agentId;
                // allow renaming: remove old map key
                if (newId !== agentId) {
                    agents.delete(agentId);
                    agentId = newId;
                    agents.set(agentId, { ws, subscriptions: info.subscriptions || new Set(), links: info.links || new Set() });
                }
                safeSend(ws, { type: 'registered', agentId });
                break;
            }
            case 'set': {
                const { key, value } = data;
                if (!key) { safeSend(ws, { type: 'error', message: 'missing-key' }); break; }
                memory[key] = { value, updatedAt: Date.now(), updatedBy: agentId };
                safeSend(ws, { type: 'ok', action: 'set', key });
                notifyKeyUpdate(key, memory[key]);
                notifyLinkedAgents(agentId, { action: 'set', key, entry: memory[key] });
                break;
            }
            case 'get': {
                const { key } = data;
                safeSend(ws, { type: 'result', key, entry: memory[key] || null });
                break;
            }
            case 'subscribe': {
                const { key } = data;
                if (!key) { safeSend(ws, { type: 'error', message: 'missing-key' }); break; }
                info.subscriptions = info.subscriptions || new Set();
                info.subscriptions.add(key);
                agents.set(agentId, info);
                safeSend(ws, { type: 'subscribed', key });
                // send current value if exists
                if (memory[key]) safeSend(ws, { type: 'update', key, entry: memory[key] });
                break;
            }
            case 'unsubscribe': {
                const { key } = data;
                if (info.subscriptions) info.subscriptions.delete(key);
                agents.set(agentId, info);
                safeSend(ws, { type: 'unsubscribed', key });
                break;
            }
            case 'link': {
                const { target } = data;
                if (!target) { safeSend(ws, { type: 'error', message: 'missing-target' }); break; }
                info.links = info.links || new Set();
                info.links.add(target);
                // ensure target exists in map with link back reference set (not enforced, optional)
                if (!agents.has(target)) agents.set(target, { ws: null, subscriptions: new Set(), links: new Set() });
                agents.set(agentId, info);
                safeSend(ws, { type: 'linked', target });
                break;
            }
            case 'unlink': {
                const { target } = data;
                if (info.links) info.links.delete(target);
                agents.set(agentId, info);
                safeSend(ws, { type: 'unlinked', target });
                break;
            }
            case 'list': {
                safeSend(ws, { type: 'list', agents: Array.from(agents.keys()), memoryKeys: Object.keys(memory) });
                break;
            }
            default:
                safeSend(ws, { type: 'error', message: 'unknown-type' });
        }
    });

    ws.on('close', () => {
        const info = agents.get(agentId);
        if (info && info.ws === ws) {
            // keep record so future agents can link to the id, but remove ws
            agents.set(agentId, { ws: null, subscriptions: info.subscriptions || new Set(), links: info.links || new Set() });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`MCP shared memory server listening on http://localhost:${PORT}`));
