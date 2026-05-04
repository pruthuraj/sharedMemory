// Fan-out helpers that push events to subscribed and linked agents.

const OPEN = 1;

// Returns false silently if the socket is closed or serialization fails — callers don't need to check.
function safeSend(ws, obj) {
    if (!ws || ws.readyState !== OPEN) return false;

    try {
        ws.send(JSON.stringify(obj));
        return true;
    } catch (error) {
        return false;
    }
}

// Sends an 'update' event to every agent subscribed to key; entry is null when the key was deleted/expired.
function notifyKeyUpdate(agents, key, entry, options = {}) {
    for (const agentId of agents.ids()) {
        const info = agents.get(agentId);
        if (info && info.subscriptions.has(key)) {
            safeSend(info.ws, { type: 'update', key, entry, ...options });
        }
    }
}

// Deduplicates via a Set so agents subscribed to both endpoints receive only one notification.
function notifyRelationUpdate(agents, action, edge) {
    const targets = new Set();

    for (const agentId of agents.ids()) {
        const info = agents.get(agentId);
        if (!info) continue;

        if (info.subscriptions.has(edge.from) || info.subscriptions.has(edge.to)) {
            targets.add(info.ws);
        }
    }

    for (const ws of targets) {
        safeSend(ws, {
            type: 'relation-update',
            action,
            keys: [edge.from, edge.to],
            edge,
        });
    }
}

// Sends only to agents that fromAgentId has linked TO (outbound links); inbound linkers are not notified.
function notifyLinkedAgents(agents, fromAgentId, payload) {
    const info = agents.get(fromAgentId);
    if (!info) return;

    for (const target of info.links) {
        const targetInfo = agents.get(target);
        if (targetInfo) {
            safeSend(targetInfo.ws, { type: 'linked', from: fromAgentId, payload });
        }
    }
}

module.exports = {
    notifyKeyUpdate,
    notifyLinkedAgents,
    notifyRelationUpdate,
    safeSend,
};
