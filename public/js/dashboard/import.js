'use strict';

// ── Import Constants ───────────────────────────────────────────────────

const IMPORT_MODE = 'merge';
const IMPORT_MAX_VISIBLE_ERRORS = 12;
const IMPORT_PANEL_CLOSE_DELAY_MS = 700;

const IMPORT_DEFAULT_MESSAGE = 'Choose a JSON snapshot file';
const IMPORT_VALID_MESSAGE =
    'Snapshot is valid. Import will add to the current memory. Existing memories will not be deleted or overwritten.';

const IMPORT_CONFIRM_MESSAGE =
    'Import will add to the current memory. Existing memories will not be deleted or overwritten. Continue?';

// ── Snapshot Helpers ───────────────────────────────────────────────────

function unwrapSnapshotPayload(payload) {
    if (
        payload &&
        typeof payload === 'object' &&
        !Array.isArray(payload) &&
        payload.snapshot
    ) {
        return payload.snapshot;
    }

    return payload;
}

async function readJsonFile(file) {
    try {
        return {
            ok: true,
            value: JSON.parse(await file.text()),
        };
    } catch (error) {
        return {
            ok: false,
            error,
        };
    }
}

function hasOpenSocket() {
    return Boolean(ws && ws.readyState === WebSocket.OPEN);
}

// ── Import Panel State ─────────────────────────────────────────────────

function setImportResult(kind, content) {
    if (!importResult) return;

    importResult.className = `import-result ${kind}`;
    importResult.innerHTML = content;
}

function setImportSummary(text) {
    if (!importSummary) return;

    importSummary.textContent = text;
}

function setImportConfirmEnabled(enabled) {
    if (!importConfirmBtn) return;

    importConfirmBtn.disabled = !enabled;
}

function setImportPanelOpen(isOpen) {
    if (!importPanel || !importBtn) return;

    importPanel.classList.toggle('visible', isOpen);
    importPanel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');

    importBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function resetImportPanel() {
    importSnapshotDraft = null;

    setImportConfirmEnabled(false);
    setImportSummary(IMPORT_DEFAULT_MESSAGE);
    setImportResult('', '');

    if (importFile) {
        importFile.value = '';
    }
}

function openImportPanel() {
    setImportPanelOpen(true);

    if (!importSnapshotDraft) {
        setImportSummary(IMPORT_DEFAULT_MESSAGE);
    }
}

function closeImportPanel() {
    setImportPanelOpen(false);
}

// ── Formatting Helpers ─────────────────────────────────────────────────

function formatImportErrors(errors = []) {
    if (!Array.isArray(errors) || !errors.length) {
        return 'Unknown validation error.';
    }

    const visibleErrors = errors.slice(0, IMPORT_MAX_VISIBLE_ERRORS);
    const hiddenCount = errors.length - visibleErrors.length;

    return `
<div class="import-error-title">
  ${errors.length} validation ${errors.length === 1 ? 'error' : 'errors'}
</div>

<ul>
  ${visibleErrors
            .map((error) => {
                const path = error.path || 'snapshot';
                const message = error.message || 'invalid';

                return `<li><code>${esc(path)}</code>: ${esc(message)}</li>`;
            })
            .join('')}
</ul>

${hiddenCount > 0 ? `<div class="import-more">+${hiddenCount} more errors</div>` : ''}`;
}

function formatImportStats(stats = {}, mode = IMPORT_MODE) {
    if (mode === 'merge') {
        return (
            `${stats.entriesAdded ?? 0} entries will be added, ` +
            `${stats.entriesSkipped ?? 0} existing entries skipped, ` +
            `${stats.edgesAdded ?? 0} edges will be added, and ` +
            `${stats.edgesSkipped ?? 0} duplicate edges skipped.`
        );
    }

    return `${stats.entryCount ?? 0} entries, ${stats.edgeCount ?? 0} edges`;
}

function formatImportSuccess(stats = {}) {
    return (
        `Added ${stats.entriesAdded ?? 0} entries and ${stats.edgesAdded ?? 0} edges. ` +
        `Skipped ${stats.entriesSkipped ?? 0} existing entries and ` +
        `${stats.edgesSkipped ?? 0} duplicate edges.`
    );
}

function getResponseErrorMessage(response, fallback) {
    if (response?.errors) {
        return formatImportErrors(response.errors);
    }

    return esc(response?.error || response?.message || fallback);
}

// ── Server Requests ────────────────────────────────────────────────────

async function validateSnapshotWithServer(snapshot) {
    return wsRpc({
        type: 'validate-import',
        mode: IMPORT_MODE,
        snapshot,
        requestId: makeRequestId('validate_import'),
    });
}

async function importSnapshotWithServer(snapshot) {
    return wsRpc({
        type: 'import',
        mode: IMPORT_MODE,
        snapshot,
        requestId: makeRequestId('import_snapshot'),
    });
}

// ── Import Flow ────────────────────────────────────────────────────────

function resetImportDraft() {
    importSnapshotDraft = null;
    setImportConfirmEnabled(false);
}

function showImportValidationFailure(response) {
    setImportSummary('Snapshot failed validation');
    setImportResult('error', formatImportErrors(response.errors));
}

function showImportValidationSuccess(snapshot, response) {
    importSnapshotDraft = snapshot;

    setImportConfirmEnabled(true);
    setImportSummary(formatImportStats(response.stats || {}, response.mode || IMPORT_MODE));
    setImportResult('ok', IMPORT_VALID_MESSAGE);
}

async function handleImportFile(file) {
    if (!file) return;

    if (!hasOpenSocket()) {
        setImportResult('error', 'Connect before importing a snapshot.');
        return;
    }

    resetImportDraft();

    setImportSummary(`Validating ${file.name}`);
    setImportResult('pending', 'Reading file...');

    const parsed = await readJsonFile(file);

    if (!parsed.ok) {
        setImportSummary('Invalid JSON file');
        setImportResult('error', `JSON parse failed: ${esc(parsed.error.message)}`);
        return;
    }

    const snapshot = unwrapSnapshotPayload(parsed.value);

    setImportResult('pending', 'Validating snapshot with server...');

    const response = await validateSnapshotWithServer(snapshot);

    if (response.type === 'error') {
        setImportSummary('Validation request failed');
        setImportResult(
            'error',
            getResponseErrorMessage(response, 'validation-failed')
        );
        return;
    }

    if (!response.ok) {
        showImportValidationFailure(response);
        return;
    }

    showImportValidationSuccess(snapshot, response);
}

async function importValidatedSnapshot() {
    if (!importSnapshotDraft) return;

    if (!window.confirm(IMPORT_CONFIRM_MESSAGE)) return;

    setImportConfirmEnabled(false);
    setImportResult('pending', 'Importing snapshot...');

    const response = await importSnapshotWithServer(importSnapshotDraft);

    if (response.type === 'error' || response.ok === false) {
        setImportConfirmEnabled(true);
        setImportSummary('Import failed');
        setImportResult(
            'error',
            getResponseErrorMessage(response, 'import-failed')
        );
        return;
    }

    setImportResult('ok', formatImportSuccess(response.stats || {}));

    importSnapshotDraft = null;
    setImportConfirmEnabled(false);

    await loadGraph({
        preserveView: false,
    });

    window.setTimeout(closeImportPanel, IMPORT_PANEL_CLOSE_DELAY_MS);
}