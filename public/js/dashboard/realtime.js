'use strict';

// ── WebSocket ──────────────────────────────────────────────────────────
function wsSend(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function wsRpc(obj) {
    if (!obj.requestId) obj.requestId = makeRequestId(obj.type || 'rpc');
    return new Promise(res => { pending[obj.requestId] = res; wsSend(obj); });
}

function drainQueue(type) {
    const idx = msgQueue.findIndex(m => m.type === type);
    if (idx !== -1) return msgQueue.splice(idx, 1)[0];
    return null;
}

function subscribeToKey(key) {
    if (!key || subscribedKeys.has(key) || !ws || ws.readyState !== WebSocket.OPEN) return;
    subscribedKeys.add(key);
    wsSend({ type: 'subscribe', key, requestId: makeRequestId('sub') });
}

function syncSubscriptions() {
    for (const key of Object.keys(currentEntries)) subscribeToKey(key);
}

function upsertEdge(edge) {
    const id = edgeKey(edge);
    const index = currentEdges.findIndex(existing => edgeKey(existing) === id);
    if (index === -1) currentEdges.push(edge);
    else currentEdges[index] = edge;
}

function removeEdge(edge) {
    const id = edgeKey(edge);
    currentEdges = currentEdges.filter(existing => edgeKey(existing) !== id);
}

function markNodeUpdating(key) {
    const el = scene.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (!el) return;
    el.classList.remove('updating');
    void el.offsetWidth;
    el.classList.add('updating');
    window.setTimeout(() => el.classList.remove('updating'), 750);
}

function queueGraphReload(options = {}) {
    if (refreshQueued) return;
    refreshQueued = true;
    window.setTimeout(async () => {
        refreshQueued = false;
        if (ws && ws.readyState === WebSocket.OPEN) {
            await loadGraph({
                preserveView: true,
                preservePositions: Boolean(options.preservePositions),
                silent: true,
            });
        }
    }, 120);
}

function startLiveRefresh() {
    if (!graphSettings.liveRefresh) return;
    stopLiveRefresh();
    liveRefreshTimer = window.setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            loadGraph({ preserveView: true, preservePositions: true, silent: true });
        }
    }, LIVE_REFRESH_MS);
}

function stopLiveRefresh() {
    if (liveRefreshTimer) {
        window.clearInterval(liveRefreshTimer);
        liveRefreshTimer = null;
    }
}

function handleLiveMessage(msg) {
    if (msg.type === 'update' && msg.key) {
        if (msg.entry === null) {
            if (!currentEntries[msg.key]) return true;
            delete currentEntries[msg.key];
            currentEdges = currentEdges.filter(edge => edge.from !== msg.key && edge.to !== msg.key);
            if (selectedKey === msg.key) document.getElementById('dp-close').click();
            renderGraph(currentEntries, currentEdges, { preserveSelection: true, preservePositions: true, fit: false });
            updateStatusCount();
            return true;
        }

        const changed = !sameJson(currentEntries[msg.key], msg.entry);
        currentEntries[msg.key] = msg.entry;
        subscribeToKey(msg.key);
        if (changed) {
            renderGraph(currentEntries, currentEdges, { preserveSelection: true, preservePositions: true, fit: false });
            markNodeUpdating(msg.key);
            updateStatusCount();
        }
        return true;
    }

    if (msg.type === 'relation-update' && msg.edge) {
        if (!currentEntries[msg.edge.from] || !currentEntries[msg.edge.to]) {
            queueGraphReload({ preservePositions: true });
            return true;
        }

        if (msg.action === 'deleted' || msg.action === 'cascade-deleted') {
            removeEdge(msg.edge);
        } else {
            upsertEdge(msg.edge);
        }

        renderGraph(currentEntries, currentEdges, { preserveSelection: true, preservePositions: true, fit: false });
        markNodeUpdating(msg.edge.from);
        markNodeUpdating(msg.edge.to);
        updateStatusCount();
        return true;
    }

    if (msg.type === 'snapshot-update') {
        queueGraphReload({ preservePositions: false });
        return true;
    }

    return false;
}

async function connect() {
    const token = tokenInput.value.trim();
    connectBtn.disabled = true;
    setStatus('Connecting...');

    if (ws) { try { ws.close(); } catch { } ws = null; }
    msgQueue.length = 0;

    ws = new WebSocket(`ws://${location.host}/`);

    ws.onmessage = e => {
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.requestId && pending[msg.requestId]) {
            const res = pending[msg.requestId];
            delete pending[msg.requestId];
            res(msg);
        } else if (!msg.requestId) {
            if (pending[`__${msg.type}__`]) {
                const res = pending[`__${msg.type}__`];
                delete pending[`__${msg.type}__`];
                res(msg);
            } else if (handleLiveMessage(msg)) {
                return;
            } else {
                msgQueue.push(msg);
            }
        }
    };

    ws.onerror = () => { setStatus('Connection failed', 'error'); connectBtn.disabled = false; };
    ws.onclose = () => {
        stopLiveRefresh();
        subscribedKeys.clear();
        setStatus('Disconnected', 'error');
        connectBtn.disabled = false;
        refreshBtn.disabled = true;
        importBtn.disabled = true;
    };

    const opened = await new Promise(res => { ws.onopen = () => res(true); ws.onerror = () => res(false); });
    if (!opened || ws.readyState !== WebSocket.OPEN) { connectBtn.disabled = false; return; }

    // Welcome (no requestId - may already be queued)
    const welcome = drainQueue('welcome') || await new Promise(res => { pending['__welcome__'] = res; });
    if (!welcome || welcome.type !== 'welcome') {
        setStatus('Bad server response', 'error'); connectBtn.disabled = false; return;
    }

    if (token) {
        const r = await wsRpc({ type: 'auth', token, requestId: '__auth__' });
        if (r.type === 'error') {
            setStatus('Auth failed', 'error'); ws.close(); connectBtn.disabled = false; return;
        }
    }

    refreshBtn.disabled = false;
    importBtn.disabled = false;
    connectBtn.disabled = false;
    await loadGraph();
    startLiveRefresh();
}

async function loadGraph(options = {}) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!options.silent) {
        loadingEl.classList.add('visible');
        setStatus('Loading...');
    }

    const r = await wsRpc({ type: 'export', requestId: makeRequestId('export') });
    if (!options.silent) loadingEl.classList.remove('visible');

    if (r.type === 'error') {
        if (!options.silent) setStatus('Export failed', 'error');
        return;
    }

    currentEntries = r.snapshot.entries;
    currentEdges = r.snapshot.edges;
    syncSubscriptions();
    renderGraph(currentEntries, currentEdges, {
        preserveSelection: Boolean(options.preserveView),
        preservePositions: Boolean(options.preservePositions),
        fit: options.preserveView ? false : true,
    });

    updateStatusCount();
}
