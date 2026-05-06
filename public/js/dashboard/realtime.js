'use strict';

// WebSocket RPC, subscriptions, live updates, live refresh, connect/disconnect, load, and audit badge.

function wsSend(obj) {
    try {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(obj));
            return true;
        }
        // If socket not open, queue the message for later delivery and warn
        msgQueue.push(obj);
        console.warn('wsSend: socket not open, queued message', obj.type || obj);
        return false;
    } catch (err) {
        console.error('wsSend error', err);
        return false;
    }
}

function wsRpc(obj, { timeout = 8000 } = {}) {
    if (!obj.requestId) obj.requestId = makeRequestId(obj.type || 'rpc');
    return new Promise((resolve, reject) => {
        let settled = false;
        pending[obj.requestId] = (res) => {
            if (settled) return;
            settled = true;
            clearTimeout(tmr);
            resolve(res);
        };
        const ok = wsSend(obj);
        if (!ok) {
            // If sending failed immediately, reject fast
            delete pending[obj.requestId];
            return reject(new Error('ws not open'));
        }
        const tmr = setTimeout(() => {
            if (settled) return;
            settled = true;
            delete pending[obj.requestId];
            reject(new Error('wsRpc timeout'));
        }, timeout);
    });
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
    isManualDisconnect = false;
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

    ws.onerror = () => {
        setStatus('Connection failed', 'error');
        connectBtn.disabled = false;
        connectBtn.textContent = 'Connect';
        connectBtn.classList.remove('connected');
    };
    ws.onclose = () => {
        stopLiveRefresh();
        subscribedKeys.clear();
        setStatus(isManualDisconnect ? 'Not connected' : 'Disconnected', isManualDisconnect ? '' : 'error');
        isManualDisconnect = false;
        connectBtn.disabled = false;
        connectBtn.textContent = 'Connect';
        connectBtn.classList.remove('connected');
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
    // Mark connect button as connected and update label
    connectBtn.textContent = 'Disconnect';
    connectBtn.classList.add('connected');
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

    if (isFirstLoad && !options.preserveView) {
        isFirstLoad = false;
        fitToTopCluster();
    }

    updateStatusCount();
    refreshAuditBadge();
}

function fitToTopCluster() {
    const keys = Object.keys(currentEntries);
    if (keys.length < 8) return;
    let topKey = null;
    let topScore = -1;
    for (const k of keys) {
        const e = currentEntries[k];
        const score = (Number(e && e.importance) || 0) + Math.sqrt(nodeDegree(k)) * 1.5;
        if (score > topScore) { topScore = score; topKey = k; }
    }
    if (!topKey || !nodePositions[topKey]) return;
    const distances = focusDistances(topKey);
    const cluster = {};
    for (const key of distances.keys()) {
        if (nodePositions[key]) cluster[key] = nodePositions[key];
    }
    if (Object.keys(cluster).length < 3) return;
    fitView(cluster);
}

let lastAuditZombies = [];

async function refreshAuditBadge() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !auditBadge) return;
    try {
        const r = await wsRpc({ type: 'audit', requestId: makeRequestId('audit') });
        if (!r || r.type !== 'audit-result' || !r.counts) {
            auditBadge.hidden = true;
            return;
        }
        lastAuditZombies = Array.isArray(r.zombies) ? r.zombies : [];
        const count = r.counts.zombies || 0;
        if (count > 0) {
            auditBadge.hidden = false;
            auditBadge.textContent = `! ${count}`;
            auditBadge.title = `${count} memory ${count === 1 ? 'entry has' : 'entries have'} missing tags / importance / summary — click to view`;
        } else {
            auditBadge.hidden = true;
        }
    } catch (_) {
        auditBadge.hidden = true;
    }
}

if (auditBadge) {
    auditBadge.addEventListener('click', () => {
        if (!identityPanel || lastAuditZombies.length === 0) return;
        identityPanel.setAttribute('aria-hidden', 'false');
        identityBtn.setAttribute('aria-expanded', 'true');
        if (identitySearch) {
            identitySearch.value = lastAuditZombies[0].split('.')[0] || '';
            identitySearch.dispatchEvent(new Event('input', { bubbles: true }));
            identitySearch.focus();
        }
    });
}

if (connectBtn) {
    connectBtn.addEventListener('click', () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            isManualDisconnect = true;
            try { ws.close(); } catch (_) {}
            return;
        }
        connect();
    });
}
if (refreshBtn) refreshBtn.addEventListener('click', loadGraph);
if (tokenInput) tokenInput.addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });

// Initial palette/edge-label/CSS-vars apply happens inside Settings.init().
// Run focus-state once the snapshot is in hand so the radial layout matches.
if (selectedKey) applyRadialFocusLayout(selectedKey);
else applyFocusState();
applyTransform();
