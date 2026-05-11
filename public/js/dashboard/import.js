'use strict';

// ── Import Constants ───────────────────────────────────────────────────

const IMPORT_MODE = 'merge';
const IMPORT_MAX_VISIBLE_ERRORS = 12;
const IMPORT_PANEL_CLOSE_DELAY_MS = 700;
const IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;

const IMPORT_DEFAULT_MESSAGE = 'Choose a JSON snapshot file';
const IMPORT_VALID_MESSAGE =
    'Snapshot is valid. Import will add to the current memory. Existing memories will not be deleted or overwritten.';

const IMPORT_CONFIRM_MESSAGE =
    'Import will add to the current memory. Existing memories will not be deleted or overwritten. Continue?';

// Browsers do not always provide a MIME type for local JSON files, so the
// extension remains the primary preflight signal.
const IMPORT_ALLOWED_EXTENSIONS = ['.json'];

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

function formatFileSize(bytes) {
    if (!Number.isFinite(bytes)) return 'unknown size';

    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function hasAllowedImportExtension(fileName) {
    const lowerName = String(fileName || '').toLowerCase();

    return IMPORT_ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}

function validateImportFile(file) {
    if (!file) {
        return { ok: false, error: 'Choose a JSON snapshot file.' };
    }

    if (!hasAllowedImportExtension(file.name)) {
        return { ok: false, error: 'Only .json snapshot files are supported.' };
    }

    if (file.size > IMPORT_MAX_FILE_BYTES) {
        return {
            ok: false,
            error: `File is ${formatFileSize(file.size)}. Maximum size is ${formatFileSize(IMPORT_MAX_FILE_BYTES)}.`,
        };
    }

    return { ok: true };
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

function setImportBusy(isBusy) {
    if (importFile) importFile.disabled = isBusy;
    if (importConfirmBtn) importConfirmBtn.disabled = isBusy || !importSnapshotDraft;
    if (importCancelBtn) importCancelBtn.disabled = isBusy;
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

    const fileValidation = validateImportFile(file);

    if (!fileValidation.ok) {
        setImportSummary('Unsupported file');
        setImportResult('error', esc(fileValidation.error));
        return;
    }

    setImportSummary(`Validating ${file.name} (${formatFileSize(file.size)})`);
    setImportResult('pending', 'Reading file...');
    setImportBusy(true);

    const parsed = await readJsonFile(file);

    setImportBusy(false);

    if (!parsed.ok) {
        setImportSummary('Invalid JSON file');
        setImportResult('error', `JSON parse failed: ${esc(parsed.error.message)}`);
        return;
    }

    const snapshot = unwrapSnapshotPayload(parsed.value);

    setImportResult('pending', 'Validating snapshot with server...');
    setImportBusy(true);

    const response = await validateSnapshotWithServer(snapshot);

    setImportBusy(false);

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

    setImportBusy(true);
    setImportResult('pending', 'Importing snapshot...');

    const response = await importSnapshotWithServer(importSnapshotDraft);

    if (response.type === 'error' || response.ok === false) {
        setImportBusy(false);
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
    setImportBusy(false);
    setImportConfirmEnabled(false);

    if (importFile) {
        importFile.value = '';
    }

    await loadGraph({
        preserveView: false,
    });

    window.setTimeout(closeImportPanel, IMPORT_PANEL_CLOSE_DELAY_MS);
}
