'use strict';

// ── Import snapshot panel ──────────────────────────────────────────────
function unwrapSnapshotPayload(payload) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.snapshot) {
        return payload.snapshot;
    }
    return payload;
}

function setImportResult(kind, content) {
    importResult.className = `import-result ${kind}`;
    importResult.innerHTML = content;
}

function resetImportPanel() {
    importSnapshotDraft = null;
    importConfirmBtn.disabled = true;
    importSummary.textContent = 'Choose a JSON snapshot file';
    setImportResult('', '');
    importFile.value = '';
}

function openImportPanel() {
    importPanel.classList.add('visible');
    importPanel.setAttribute('aria-hidden', 'false');
    importBtn.setAttribute('aria-expanded', 'true');
    if (!importSnapshotDraft) {
        importSummary.textContent = 'Choose a JSON snapshot file';
    }
}

function closeImportPanel() {
    importPanel.classList.remove('visible');
    importPanel.setAttribute('aria-hidden', 'true');
    importBtn.setAttribute('aria-expanded', 'false');
}

function formatImportErrors(errors = []) {
    if (!Array.isArray(errors) || !errors.length) return 'Unknown validation error.';
    return `
    <div class="import-error-title">${errors.length} validation ${errors.length === 1 ? 'error' : 'errors'}</div>
    <ul>
      ${errors.slice(0, 12).map(error =>
        `<li><code>${esc(error.path || 'snapshot')}</code>: ${esc(error.message || 'invalid')}</li>`
    ).join('')}
    </ul>
    ${errors.length > 12 ? `<div class="import-more">+${errors.length - 12} more errors</div>` : ''}
  `;
}

function formatImportStats(stats = {}, mode = 'replace') {
    if (mode === 'merge') {
        return `${stats.entriesAdded ?? 0} entries will be added, ${stats.entriesSkipped ?? 0} existing entries skipped, ${stats.edgesAdded ?? 0} edges will be added, and ${stats.edgesSkipped ?? 0} duplicate edges skipped.`;
    }

    return `${stats.entryCount ?? 0} entries, ${stats.edgeCount ?? 0} edges`;
}

async function handleImportFile(file) {
    if (!file) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        setImportResult('error', 'Connect before importing a snapshot.');
        return;
    }

    importSnapshotDraft = null;
    importConfirmBtn.disabled = true;
    importSummary.textContent = `Validating ${file.name}`;
    setImportResult('pending', 'Reading file...');

    let parsed;
    try {
        parsed = JSON.parse(await file.text());
    } catch (error) {
        importSummary.textContent = 'Invalid JSON file';
        setImportResult('error', `JSON parse failed: ${esc(error.message)}`);
        return;
    }

    const snapshot = unwrapSnapshotPayload(parsed);
    setImportResult('pending', 'Validating snapshot with server...');
    const response = await wsRpc({
        type: 'validate-import',
        mode: 'merge',
        snapshot,
        requestId: makeRequestId('validate_import'),
    });

    if (response.type === 'error') {
        importSummary.textContent = 'Validation request failed';
        setImportResult('error', esc(response.message || 'validation-failed'));
        return;
    }

    if (!response.ok) {
        importSummary.textContent = 'Snapshot failed validation';
        setImportResult('error', formatImportErrors(response.errors));
        return;
    }

    importSnapshotDraft = snapshot;
    importConfirmBtn.disabled = false;
    importSummary.textContent = formatImportStats(response.stats || {}, response.mode || 'merge');
    setImportResult('ok', 'Snapshot is valid. Import will add to the current memory. Existing memories will not be deleted or overwritten.');
}

async function importValidatedSnapshot() {
    if (!importSnapshotDraft) return;
    if (!window.confirm('Import will add to the current memory. Existing memories will not be deleted or overwritten. Continue?')) return;

    importConfirmBtn.disabled = true;
    setImportResult('pending', 'Importing snapshot...');
    const response = await wsRpc({
        type: 'import',
        mode: 'merge',
        snapshot: importSnapshotDraft,
        requestId: makeRequestId('import_snapshot'),
    });

    if (response.type === 'error' || response.ok === false) {
        importConfirmBtn.disabled = false;
        importSummary.textContent = 'Import failed';
        setImportResult('error', response.errors ? formatImportErrors(response.errors) : esc(response.error || response.message || 'import-failed'));
        return;
    }

    const stats = response.stats || {};
    setImportResult('ok', `Added ${stats.entriesAdded ?? 0} entries and ${stats.edgesAdded ?? 0} edges. Skipped ${stats.entriesSkipped ?? 0} existing entries and ${stats.edgesSkipped ?? 0} duplicate edges.`);
    importSnapshotDraft = null;
    importConfirmBtn.disabled = true;
    await loadGraph({ preserveView: false });
    window.setTimeout(closeImportPanel, 700);
}
