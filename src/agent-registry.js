const OPEN = 1;

function genId() {
    return 'agent_' + Math.random().toString(36).slice(2, 10);
}

function isLive(info) {
    return Boolean(info && info.ws && info.ws.readyState === OPEN);
}

function mergeSets(...sets) {
    const merged = new Set();
    for (const set of sets) {
        if (!set) continue;
        for (const value of set) merged.add(value);
    }
    return merged;
}

function createRecord(ws, existing, fallback) {
    return {
        ws,
        subscriptions: mergeSets(existing && existing.subscriptions, fallback && fallback.subscriptions),
        links: mergeSets(existing && existing.links, fallback && fallback.links),
    };
}

function createAgentRegistry(options = {}) {
    const agents = new Map();
    const makeId = options.genId || genId;

    return {
        createTemporary(ws) {
            const agentId = makeId();
            agents.set(agentId, createRecord(ws));
            return agentId;
        },

        get(agentId) {
            return agents.get(agentId) || null;
        },

        ids() {
            return Array.from(agents.keys());
        },

        connectedIds() {
            return Array.from(agents.entries())
                .filter(([, info]) => isLive(info))
                .map(([agentId]) => agentId);
        },

        register(currentId, requestedId, ws) {
            const nextId = requestedId || currentId;
            const current = agents.get(currentId) || createRecord(ws);
            const existing = agents.get(nextId);

            if (existing && existing.ws !== ws && isLive(existing)) {
                return { ok: false, error: 'duplicate-agent', agentId: currentId };
            }

            if (nextId !== currentId) {
                agents.delete(currentId);
            }

            agents.set(nextId, createRecord(ws, existing, current));
            return { ok: true, agentId: nextId };
        },

        subscribe(agentId, key) {
            const info = agents.get(agentId) || createRecord(null);
            info.subscriptions.add(key);
            agents.set(agentId, info);
        },

        unsubscribe(agentId, key) {
            const info = agents.get(agentId);
            if (!info) return;
            info.subscriptions.delete(key);
        },

        link(agentId, target) {
            const info = agents.get(agentId) || createRecord(null);
            info.links.add(target);
            agents.set(agentId, info);

            if (!agents.has(target)) {
                agents.set(target, createRecord(null));
            }
        },

        unlink(agentId, target) {
            const info = agents.get(agentId);
            if (!info) return;
            info.links.delete(target);
        },

        disconnect(agentId, ws) {
            const info = agents.get(agentId);
            if (!info || info.ws !== ws) return;
            agents.set(agentId, createRecord(null, info));
        },
    };
}

module.exports = {
    createAgentRegistry,
    genId,
    isLive,
};
