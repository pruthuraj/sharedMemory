'use strict';

// ── WebSocket / Realtime ───────────────────────────────────────────────

const RPC_TIMEOUT_MS = 10000;
const GRAPH_RELOAD_DELAY_MS = 120;
const NODE_UPDATE_ANIMATION_MS = 750;

function isWsOpen() {
    return ws && ws.readyState === WebSocket.OPEN;
}

function setConnectionUiState(state) {
    const connected = state === 'connected';
    const connecting = state === 'connecting';

    connectBtn.disabled = connecting;
    refreshBtn.disabled = !connected;
    importBtn.disabled = !connected;
    exportBtn.disabled = !connected;
}

function safeJsonParse(raw) {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function wsSend(obj) {
    if (!isWsOpen()) return false;

    ws.send(JSON.stringify(obj));
    return true;
}

function wsRpc(obj, timeoutMs = RPC_TIMEOUT_MS) {
    if (!obj.requestId) {
        obj.requestId = makeRequestId(obj.type || 'rpc');
    }

    return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
            delete pending[obj.requestId];
            resolve({
                type: 'error',
                error: 'timeout',
                requestId: obj.requestId,
            });
        }, timeoutMs);

        pending[obj.requestId] = (msg) => {
            window.clearTimeout(timer);
            resolve(msg);
        };

        const sent = wsSend(obj);

        if (!sent) {
            window.clearTimeout(timer);
            delete pending[obj.requestId];

            resolve({
                type: 'error',
                error: 'socket-not-open',
                requestId: obj.requestId,
            });
        }
    });
}

function drainQueue(type) {
    const idx = msgQueue.findIndex((msg) => msg.type === type);

    if (idx === -1) return null;

    return msgQueue.splice(idx, 1)[0];
}

function closeCurrentSocket() {
    if (!ws) return;

    try {
        ws.close();
    } catch {
        // Ignore close errors.
    }

    ws = null;
}

function subscribeToKey(key) {
    if (!key || subscribedKeys.has(key) || !isWsOpen()) return;

    subscribedKeys.add(key);

    wsSend({
        type: 'subscribe',
        key,
        requestId: makeRequestId('sub'),
    });
}

function syncSubscriptions() {
    Object.keys(currentEntries).forEach(subscribeToKey);
}

// ── Edge Updates ───────────────────────────────────────────────────────

function upsertEdge(edge) {
    const id = edgeKey(edge);
    const index = currentEdges.findIndex((existing) => edgeKey(existing) === id);

    if (index === -1) {
        currentEdges.push(edge);
    } else {
        currentEdges[index] = edge;
    }
}

function removeEdge(edge) {
    const id = edgeKey(edge);

    currentEdges = currentEdges.filter((existing) => edgeKey(existing) !== id);
}

function removeNodeAndConnectedEdges(key) {
    delete currentEntries[key];

    currentEdges = currentEdges.filter((edge) => {
        return edge.from !== key && edge.to !== key;
    });
}

// ── Graph Rendering Helpers ────────────────────────────────────────────

function renderLiveGraph() {
    renderGraph(currentEntries, currentEdges, {
        preserveSelection: true,
        preservePositions: true,
        fit: false,
    });

    updateStatusCount();
}

function markNodeUpdating(key) {
    if (!key || !scene) return;

    const el = scene.querySelector(`[data-key="${CSS.escape(key)}"]`);

    if (!el) return;

    el.classList.remove('updating');

    // Force animation restart.
    void el.offsetWidth;

    el.classList.add('updating');

    window.setTimeout(() => {
        el.classList.remove('updating');
    }, NODE_UPDATE_ANIMATION_MS);
}

function markEdgeNodesUpdating(edge) {
    if (!edge) return;

    markNodeUpdating(edge.from);
    markNodeUpdating(edge.to);
}

function queueGraphReload(options = {}) {
    if (refreshQueued) return;

    refreshQueued = true;

    window.setTimeout(async () => {
        refreshQueued = false;

        if (!isWsOpen()) return;

        await loadGraph({
            preserveView: true,
            preservePositions: Boolean(options.preservePositions),
            silent: true,
        });
    }, GRAPH_RELOAD_DELAY_MS);
}

// ── Live Refresh ───────────────────────────────────────────────────────

function startLiveRefresh() {
    if (!graphSettings.liveRefresh) return;

    stopLiveRefresh();

    liveRefreshTimer = window.setInterval(() => {
        if (!isWsOpen()) return;

        loadGraph({
            preserveView: true,
            preservePositions: true,
            silent: true,
        });
    }, LIVE_REFRESH_MS);
}

function stopLiveRefresh() {
    if (!liveRefreshTimer) return;

    window.clearInterval(liveRefreshTimer);
    liveRefreshTimer = null;
}

// ── Incoming Message Handling ──────────────────────────────────────────

function resolvePendingMessage(msg) {
    if (!msg.requestId || !pending[msg.requestId]) return false;

    const resolve = pending[msg.requestId];

    delete pending[msg.requestId];
    resolve(msg);

    return true;
}

function resolveTypeWaitingMessage(msg) {
    const pendingKey = `__${msg.type}__`;

    if (!pending[pendingKey]) return false;

    const resolve = pending[pendingKey];

    delete pending[pendingKey];
    resolve(msg);

    return true;
}

function handleEntryUpdate(msg) {
    if (!msg.key) return false;

    if (msg.entry === null) {
        if (!currentEntries[msg.key]) return true;

        removeNodeAndConnectedEdges(msg.key);

        if (selectedKey === msg.key) {
            document.getElementById('dp-close')?.click();
        }

        renderLiveGraph();
        return true;
    }

    const changed = !sameJson(currentEntries[msg.key], msg.entry);

    currentEntries[msg.key] = msg.entry;
    subscribeToKey(msg.key);

    if (changed) {
        renderLiveGraph();
        markNodeUpdating(msg.key);
    }

    return true;
}

function handleRelationUpdate(msg) {
    if (!msg.edge) return false;

    const { from, to } = msg.edge;
    const hasBothNodes = currentEntries[from] && currentEntries[to];

    if (!hasBothNodes) {
        queueGraphReload({ preservePositions: true });
        return true;
    }

    if (msg.action === 'deleted' || msg.action === 'cascade-deleted') {
        removeEdge(msg.edge);
    } else {
        upsertEdge(msg.edge);
    }

    renderLiveGraph();
    markEdgeNodesUpdating(msg.edge);

    return true;
}

function handleLiveMessage(msg) {
    if (!msg || !msg.type) return false;

    if (msg.type === 'update') {
        return handleEntryUpdate(msg);
    }

    if (msg.type === 'relation-update') {
        return handleRelationUpdate(msg);
    }

    if (msg.type === 'snapshot-update') {
        queueGraphReload({ preservePositions: false });
        return true;
    }

    return false;
}

function handleSocketMessage(event) {
    const msg = safeJsonParse(event.data);

    if (!msg) return;

    if (resolvePendingMessage(msg)) return;

    if (!msg.requestId) {
        if (resolveTypeWaitingMessage(msg)) return;
        if (handleLiveMessage(msg)) return;

        msgQueue.push(msg);
    }
}

// ── Connection ─────────────────────────────────────────────────────────

async function waitForSocketOpen() {
    return new Promise((resolve) => {
        ws.onopen = () => resolve(true);

        ws.onerror = () => {
            resolve(false);
        };
    });
}

async function waitForWelcome() {
    const queuedWelcome = drainQueue('welcome');

    if (queuedWelcome) return queuedWelcome;

    return new Promise((resolve) => {
        pending.__welcome__ = resolve;
    });
}

async function authenticateIfNeeded(token) {
    if (!token) return true;

    const response = await wsRpc({
        type: 'auth',
        token,
        requestId: '__auth__',
    });

    return response.type !== 'error';
}

function handleSocketClose() {
    stopLiveRefresh();
    subscribedKeys.clear();

    setStatus('Disconnected', 'error');
    setConnectionUiState('disconnected');
}

function handleSocketError() {
    setStatus('Connection failed', 'error');
    setConnectionUiState('disconnected');
}

async function connect() {
    const token = tokenInput.value.trim();

    setConnectionUiState('connecting');
    setStatus('Connecting...');

    closeCurrentSocket();
    msgQueue.length = 0;

    ws = new WebSocket(`ws://${location.host}/`);

    ws.onmessage = handleSocketMessage;
    ws.onerror = handleSocketError;
    ws.onclose = handleSocketClose;

    const opened = await waitForSocketOpen();

    if (!opened || !isWsOpen()) {
        setConnectionUiState('disconnected');
        return;
    }

    const welcome = await waitForWelcome();

    if (!welcome || welcome.type !== 'welcome') {
        setStatus('Bad server response', 'error');
        setConnectionUiState('disconnected');
        closeCurrentSocket();
        return;
    }

    const authenticated = await authenticateIfNeeded(token);

    if (!authenticated) {
        setStatus('Auth failed', 'error');
        setConnectionUiState('disconnected');
        closeCurrentSocket();
        return;
    }

    setConnectionUiState('connected');

    await loadGraph();

    startLiveRefresh();
}

// ── Graph Loading ──────────────────────────────────────────────────────

function isValidSnapshotResponse(response) {
    return Boolean(
        response &&
        response.type !== 'error' &&
        response.snapshot &&
        response.snapshot.entries &&
        Array.isArray(response.snapshot.edges)
    );
}

function applySnapshot(snapshot, options = {}) {
    currentEntries = snapshot.entries;
    currentEdges = snapshot.edges;

    syncSubscriptions();

    renderGraph(currentEntries, currentEdges, {
        preserveSelection: Boolean(options.preserveView),
        preservePositions: Boolean(options.preservePositions),
        fit: options.preserveView ? false : true,
    });

    updateStatusCount();
}

async function loadGraph(options = {}) {
    if (!isWsOpen()) return;

    if (!options.silent) {
        loadingEl.classList.add('visible');
        setStatus('Loading...');
    }

    const response = await wsRpc({
        type: 'export',
        requestId: makeRequestId('export'),
    });

    if (!options.silent) {
        loadingEl.classList.remove('visible');
    }

    if (!isValidSnapshotResponse(response)) {
        if (!options.silent) {
            const reason = response?.error === 'timeout'
                ? 'Server timeout while loading graph'
                : 'Export failed';

            setStatus(reason, 'error');
        }

        return;
    }

    applySnapshot(response.snapshot, options);

    if (!options.silent) {
        setStatus('Connected');
    }
}