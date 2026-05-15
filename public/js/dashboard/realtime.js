'use strict';

// ── WebSocket / Realtime ───────────────────────────────────────────────

const RPC_TIMEOUT_MS = 10000;
const GRAPH_RELOAD_DELAY_MS = 120;
const NODE_UPDATE_ANIMATION_MS = 750;

// ── Connection Resilience ──────────────────────────────────────────────

const RECONNECT_INITIAL_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 16000;
const RECONNECT_MAX_ATTEMPTS = 10;
const WELCOME_TIMEOUT_MS = 5000;

let reconnectDelayMs = RECONNECT_INITIAL_DELAY_MS;
let reconnectAttempts = 0;
let reconnectTimer = null;
let isReconnecting = false;
let connectInFlight = false;

function isWsOpen() {
    return ws && ws.readyState === WebSocket.OPEN;
}

function isSocketOpen(socket) {
    return socket && socket.readyState === WebSocket.OPEN;
}

function setConnectionUiState(state) {
    const connected = state === 'connected';
    const connecting = state === 'connecting';

    if (connectBtn) connectBtn.disabled = connecting;
    if (refreshBtn) refreshBtn.disabled = !connected;
    if (importBtn) importBtn.disabled = !connected;
    if (exportBtn) exportBtn.disabled = !connected;
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

function closeCurrentSocket(options = {}) {
    if (!ws) return;

    if (options.suppressReconnect) {
        ws.__skipReconnect = true;
    }

    try {
        ws.close();
    } catch {
        // Ignore close errors.
    }

    ws = null;
}

function clearPendingRequests() {
    Object.keys(pending).forEach((key) => {
        const resolve = pending[key];

        if (typeof resolve === 'function') {
            resolve({
                type: 'error',
                error: 'connection-closed',
                requestId: key,
            });
        }
    });

    Object.keys(pending).forEach((key) => {
        delete pending[key];
    });
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
    if (!key || !cy) return;

    const node = cy.$id(key);

    if (!node.length) return;

    node.removeClass('updating');
    node.addClass('updating');

    window.setTimeout(() => {
        node.removeClass('updating');
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
        if (typeof visibleNodeIds !== 'undefined') {
            visibleNodeIds.delete(msg.key);
            expandedNodeIds.delete(msg.key);
            if (typeof recomputeVisibleEdges === 'function') recomputeVisibleEdges();
        }

        if (selectedKey === msg.key) {
            document.getElementById('dp-close')?.click();
        }

        renderLiveGraph();
        if (typeof refreshSlideshow === 'function') refreshSlideshow();
        return true;
    }

    const changed = !sameJson(currentEntries[msg.key], msg.entry);

    currentEntries[msg.key] = msg.entry;
    subscribeToKey(msg.key);
    if (typeof syncMainNodeVisibility === 'function') syncMainNodeVisibility();

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

async function waitForSocketOpen(socket) {
    return new Promise((resolve) => {
        let settled = false;

        const cleanup = () => {
            socket.removeEventListener('open', handleOpen);
            socket.removeEventListener('error', handleFailure);
            socket.removeEventListener('close', handleFailure);
        };

        const settle = (value) => {
            if (settled) return;

            settled = true;
            cleanup();
            resolve(value);
        };

        const handleOpen = () => settle(true);
        const handleFailure = () => settle(false);

        socket.addEventListener('open', handleOpen);
        socket.addEventListener('error', handleFailure);
        socket.addEventListener('close', handleFailure);
    });
}

async function waitForWelcome() {
    const queuedWelcome = drainQueue('welcome');

    if (queuedWelcome) return queuedWelcome;

    return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
            delete pending.__welcome__;

            resolve({
                type: 'error',
                error: 'timeout',
                requestId: '__welcome__',
            });
        }, WELCOME_TIMEOUT_MS);

        pending.__welcome__ = (msg) => {
            window.clearTimeout(timer);
            resolve(msg);
        };
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

function handleSocketClose(event) {
    const closedSocket = event?.currentTarget || null;

    if (closedSocket && closedSocket !== ws) {
        return;
    }

    stopLiveRefresh();
    subscribedKeys.clear();
    clearPendingRequests();
    ws = null;

    setStatus('Disconnected', 'error');
    setConnectionUiState('disconnected');

    if (closedSocket?.__skipReconnect) {
        return;
    }

    // Attempt automatic reconnect unless we've exceeded max attempts.
    if (reconnectAttempts < RECONNECT_MAX_ATTEMPTS) {
        scheduleReconnect();
    }
}

function scheduleReconnect() {
    if (reconnectTimer || isReconnecting || !tokenInput) return;

    isReconnecting = true;

    window.clearTimeout(reconnectTimer);

    setStatus(`Reconnecting in ${Math.round(reconnectDelayMs / 1000)}s...`, 'warning');

    reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        isReconnecting = false;
        reconnectAttempts += 1;

        setStatus(`Reconnect attempt ${reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS}...`);

        connect({ reconnect: true });

        // Exponential backoff with cap.
        reconnectDelayMs = Math.min(
            reconnectDelayMs * 1.5,
            RECONNECT_MAX_DELAY_MS
        );
    }, reconnectDelayMs);
}

function resetReconnectState() {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnectAttempts = 0;
    reconnectDelayMs = RECONNECT_INITIAL_DELAY_MS;
    isReconnecting = false;
}

function handleSocketError(event) {
    if (event?.currentTarget && event.currentTarget !== ws) return;

    setStatus('Connection failed', 'error');
    setConnectionUiState('disconnected');
}

function createDashboardSocket() {
    const socket = new WebSocket(`ws://${location.host}/`);

    ws = socket;

    socket.onmessage = handleSocketMessage;
    socket.onerror = handleSocketError;
    socket.onclose = handleSocketClose;

    return socket;
}

async function connect(options = {}) {
    if (connectInFlight && options.reconnect) return;

    connectInFlight = true;

    if (!options.reconnect) {
        resetReconnectState();
    }

    const token = tokenInput ? tokenInput.value.trim() : '';

    setConnectionUiState('connecting');
    setStatus('Connecting...');

    closeCurrentSocket({ suppressReconnect: true });
    clearPendingRequests();
    msgQueue.length = 0;

    const socket = createDashboardSocket();

    const opened = await waitForSocketOpen(socket);

    if (ws !== socket) {
        connectInFlight = false;
        return;
    }

    if (!opened || !isSocketOpen(socket)) {
        setConnectionUiState('disconnected');
        connectInFlight = false;
        scheduleReconnect();
        return;
    }

    const welcome = await waitForWelcome();

    if (ws !== socket) {
        connectInFlight = false;
        return;
    }

    if (!welcome || welcome.type !== 'welcome') {
        setStatus('Bad server response', 'error');
        setConnectionUiState('disconnected');
        connectInFlight = false;
        closeCurrentSocket({ suppressReconnect: true });
        return;
    }

    const authenticated = await authenticateIfNeeded(token);

    if (!authenticated) {
        setStatus('Auth failed', 'error');
        setConnectionUiState('disconnected');
        connectInFlight = false;
        closeCurrentSocket({ suppressReconnect: true });
        return;
    }

    // Successful connection resets reconnect state.
    resetReconnectState();

    setConnectionUiState('connected');
    connectInFlight = false;

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

    if (options.preserveView && typeof syncMainNodeVisibility === 'function') {
        syncMainNodeVisibility();
    } else if (typeof initVisibility === 'function') {
        initVisibility();
    }

    renderGraph(currentEntries, currentEdges, {
        preserveSelection: Boolean(options.preserveView),
        preservePositions: Boolean(options.preservePositions),
        fit: options.preserveView ? false : true,
    });

    updateStatusCount();

    if (typeof refreshSlideshow === 'function') refreshSlideshow();
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
