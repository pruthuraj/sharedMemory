'use strict';

// ── Export Constants ───────────────────────────────────────────────────

const EXPORT_FILE_PREFIX = 'memory-snapshot';

// ── Export Helpers ────────────────────────────────────────────────────

function buildExportFileName() {
    const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-');

    return `${EXPORT_FILE_PREFIX}-${timestamp}.json`;
}

function downloadJsonFile(data, filename) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], {
        type: 'application/json',
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
}

function buildLocalSnapshotPayload() {
    return {
        snapshot: {
            entries: currentEntries || {},
            edges: currentEdges || [],
        },
        exportedAt: new Date().toISOString(),
        source: 'memory-graph-ui',
    };
}

// ── Server Export Request ──────────────────────────────────────────────

async function fetchSnapshotForExport() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        return {
            type: 'error',
            message: 'Connect before exporting a snapshot.',
        };
    }

    return wsRpc({
        type: 'export',
        requestId: makeRequestId('export_snapshot'),
    });
}

// ── Export Flow ────────────────────────────────────────────────────────

async function exportSnapshot() {
    if (!exportBtn) return;

    exportBtn.disabled = true;

    try {
        const response = await fetchSnapshotForExport();

        if (response.type === 'error') {
            setStatus(response.message || 'Export failed', 'error');
            return;
        }

        const payload = response.snapshot
            ? {
                snapshot: response.snapshot,
                exportedAt: new Date().toISOString(),
                source: 'memory-graph-ui',
            }
            : buildLocalSnapshotPayload();

        downloadJsonFile(payload, buildExportFileName());

        setStatus('Snapshot exported', 'ok');
    } catch {
        setStatus('Export failed', 'error');
    } finally {
        exportBtn.disabled = false;
    }
}
