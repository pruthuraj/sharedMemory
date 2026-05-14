// Key/value store with metadata, typed graph relations, TTL expiry, and SQLite persistence.

const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const { RELATION_TYPES } = require('./protocol');

const DEFAULT_IMPORTANCE = 0;
const DEFAULT_MAP_DEPTH = 1;
const DEFAULT_MAP_LIMIT = 10;
const DEFAULT_PERSISTENCE_DEBOUNCE_MS = 500;
const DEFAULT_PRUNE_INTERVAL_MS = 600000;
const FALLBACK_SUMMARY_LIMIT = 120;

// Unit-separator (U+001F) prevents keys containing the relation name from colliding with a real edge id.
function edgeId(from, relation, to) {
    return `${from}${relation}${to}`;
}

function safeSummary(value) {
    let text;

    if (typeof value === 'string') {
        text = value;
    } else {
        try {
            text = JSON.stringify(value);
        } catch (error) {
            text = String(value);
        }
    }

    const collapsed = String(text).replace(/\s+/g, ' ').trim();
    return collapsed.length > FALLBACK_SUMMARY_LIMIT
        ? `${collapsed.slice(0, FALLBACK_SUMMARY_LIMIT - 3)}...`
        : collapsed;
}

function normalizeTags(tags) {
    if (!Array.isArray(tags)) return [];
    return tags.map((tag) => tag.trim()).filter(Boolean);
}

function hasValidTags(tags) {
    return Array.isArray(tags) && tags.every(isNonEmptyString);
}

function nodeMetadata(key, entry) {
    return {
        key,
        summary: entry.summary,
        tags: entry.tags.slice(),
        importance: entry.importance,
        revision: entry.revision,
        expiresAt: entry.expiresAt,
        updatedAt: entry.updatedAt,
        updatedBy: entry.updatedBy,
    };
}

function sortNodeRecords(a, b) {
    if (b.entry.importance !== a.entry.importance) {
        return b.entry.importance - a.entry.importance;
    }

    if (b.entry.updatedAt !== a.entry.updatedAt) {
        return b.entry.updatedAt - a.entry.updatedAt;
    }

    return a.key.localeCompare(b.key);
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function isValidImportance(value) {
    return Number.isInteger(value) && value >= 0 && value <= 10;
}

function isValidWeight(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value) {
    return Number.isInteger(value) && value >= 0;
}

function isNullableString(value) {
    return value === null || typeof value === 'string';
}

function canSerializeJsonValue(value) {
    try {
        return JSON.stringify(value) !== undefined;
    } catch (error) {
        return false;
    }
}

function snapshotStats(snapshot) {
    return {
        entryCount: Object.keys(snapshot.entries).length,
        edgeCount: snapshot.edges.length,
    };
}

function snapshotError(pathValue, message) {
    return { path: pathValue, message };
}

function validateSnapshotEntry(key, entry, errors) {
    const pathPrefix = `entries.${key}`;
    const initialErrorCount = errors.length;
    if (!isNonEmptyString(key)) {
        errors.push(snapshotError(pathPrefix, 'invalid-key'));
        return null;
    }

    if (!isPlainObject(entry)) {
        errors.push(snapshotError(pathPrefix, 'invalid-entry'));
        return null;
    }

    if (!hasOwn(entry, 'value') || !canSerializeJsonValue(entry.value)) {
        errors.push(snapshotError(`${pathPrefix}.value`, 'missing-value'));
    }

    if (!hasOwn(entry, 'summary') || !isNonEmptyString(entry.summary)) {
        errors.push(snapshotError(`${pathPrefix}.summary`, 'invalid-summary'));
    }

    if (!hasOwn(entry, 'tags') || !Array.isArray(entry.tags) || !entry.tags.every(isNonEmptyString)) {
        errors.push(snapshotError(`${pathPrefix}.tags`, 'invalid-tags'));
    }

    if (!hasOwn(entry, 'importance') || !isValidImportance(entry.importance)) {
        errors.push(snapshotError(`${pathPrefix}.importance`, 'invalid-importance'));
    }

    const revision = hasOwn(entry, 'revision') ? entry.revision : 1;
    if (!isPositiveInteger(revision)) {
        errors.push(snapshotError(`${pathPrefix}.revision`, 'invalid-revision'));
    }

    if (!hasOwn(entry, 'expiresAt') || !(entry.expiresAt === null || isPositiveInteger(entry.expiresAt))) {
        errors.push(snapshotError(`${pathPrefix}.expiresAt`, 'invalid-expiresAt'));
    }

    if (!hasOwn(entry, 'updatedAt') || !isNonNegativeInteger(entry.updatedAt)) {
        errors.push(snapshotError(`${pathPrefix}.updatedAt`, 'invalid-updatedAt'));
    }

    if (!hasOwn(entry, 'updatedBy') || !isNullableString(entry.updatedBy)) {
        errors.push(snapshotError(`${pathPrefix}.updatedBy`, 'invalid-updatedBy'));
    }

    if (errors.length > initialErrorCount) return null;

    return {
        value: entry.value,
        summary: entry.summary,
        tags: entry.tags.slice(),
        importance: entry.importance,
        revision,
        expiresAt: entry.expiresAt,
        updatedAt: entry.updatedAt,
        updatedBy: entry.updatedBy,
    };
}

function validateSnapshotEdge(edge, index, validKeys, seenEdges, errors) {
    const pathPrefix = `edges.${index}`;
    const initialErrorCount = errors.length;
    if (!isPlainObject(edge)) {
        errors.push(snapshotError(pathPrefix, 'invalid-edge'));
        return null;
    }

    if (!isNonEmptyString(edge.from)) {
        errors.push(snapshotError(`${pathPrefix}.from`, 'missing-from'));
    }

    if (!isNonEmptyString(edge.to)) {
        errors.push(snapshotError(`${pathPrefix}.to`, 'missing-to'));
    }

    if (edge.from === edge.to && isNonEmptyString(edge.from)) {
        errors.push(snapshotError(pathPrefix, 'self-relation-not-allowed'));
    }

    if (!isNonEmptyString(edge.relation) || !RELATION_TYPES.has(edge.relation)) {
        errors.push(snapshotError(`${pathPrefix}.relation`, 'invalid-relation'));
    }

    if (isNonEmptyString(edge.from) && !validKeys.has(edge.from)) {
        errors.push(snapshotError(`${pathPrefix}.from`, 'dangling-edge'));
    }

    if (isNonEmptyString(edge.to) && !validKeys.has(edge.to)) {
        errors.push(snapshotError(`${pathPrefix}.to`, 'dangling-edge'));
    }

    const id = isNonEmptyString(edge.from) && isNonEmptyString(edge.to) && isNonEmptyString(edge.relation)
        ? edgeId(edge.from, edge.relation, edge.to)
        : null;
    if (id && seenEdges.has(id)) {
        errors.push(snapshotError(pathPrefix, 'duplicate-edge'));
    } else if (id) {
        seenEdges.add(id);
    }

    if (!hasOwn(edge, 'reason') || typeof edge.reason !== 'string') {
        errors.push(snapshotError(`${pathPrefix}.reason`, 'invalid-reason'));
    }

    if (!hasOwn(edge, 'weight') || !isValidWeight(edge.weight)) {
        errors.push(snapshotError(`${pathPrefix}.weight`, 'invalid-weight'));
    }

    if (!hasOwn(edge, 'updatedAt') || !isNonNegativeInteger(edge.updatedAt)) {
        errors.push(snapshotError(`${pathPrefix}.updatedAt`, 'invalid-updatedAt'));
    }

    if (!hasOwn(edge, 'updatedBy') || !isNullableString(edge.updatedBy)) {
        errors.push(snapshotError(`${pathPrefix}.updatedBy`, 'invalid-updatedBy'));
    }

    if (errors.length > initialErrorCount) return null;

    return {
        from: edge.from,
        to: edge.to,
        relation: edge.relation,
        reason: edge.reason,
        weight: edge.weight,
        updatedAt: edge.updatedAt,
        updatedBy: edge.updatedBy,
    };
}

function validateSnapshotReplace(snapshot) {
    const errors = [];

    if (!isPlainObject(snapshot)) {
        return {
            ok: false,
            errors: [snapshotError('snapshot', 'invalid-snapshot')],
            stats: null,
        };
    }

    if (!isPlainObject(snapshot.entries)) {
        errors.push(snapshotError('entries', 'invalid-entries'));
    }

    if (!Array.isArray(snapshot.edges)) {
        errors.push(snapshotError('edges', 'invalid-edges'));
    }

    if (errors.length > 0) {
        return { ok: false, errors, stats: null };
    }

    const normalizedEntries = {};
    const validKeys = new Set();
    for (const key of Object.keys(snapshot.entries).sort()) {
        const normalized = validateSnapshotEntry(key, snapshot.entries[key], errors);
        if (normalized) {
            normalizedEntries[key] = normalized;
            validKeys.add(key);
        }
    }

    const normalizedEdges = [];
    const seenEdges = new Set();
    snapshot.edges.forEach((edge, index) => {
        const normalized = validateSnapshotEdge(edge, index, validKeys, seenEdges, errors);
        if (normalized) normalizedEdges.push(normalized);
    });

    if (errors.length > 0) {
        return { ok: false, errors, stats: null };
    }

    normalizedEdges.sort((a, b) => {
        const byFrom = a.from.localeCompare(b.from);
        if (byFrom !== 0) return byFrom;
        const byRelation = a.relation.localeCompare(b.relation);
        if (byRelation !== 0) return byRelation;
        return a.to.localeCompare(b.to);
    });

    const normalizedSnapshot = {
        entries: normalizedEntries,
        edges: normalizedEdges,
    };

    return {
        ok: true,
        errors: [],
        stats: snapshotStats(normalizedSnapshot),
        snapshot: normalizedSnapshot,
    };
}

function validateMergeSnapshotEdge(edge, index, validKeys, seenEdges, existingEdgeIds, errors) {
    const pathPrefix = `edges.${index}`;
    const initialErrorCount = errors.length;

    if (!isPlainObject(edge)) {
        errors.push(snapshotError(pathPrefix, 'invalid-edge'));
        return null;
    }

    if (!isNonEmptyString(edge.from)) {
        errors.push(snapshotError(`${pathPrefix}.from`, 'missing-from'));
    }

    if (!isNonEmptyString(edge.to)) {
        errors.push(snapshotError(`${pathPrefix}.to`, 'missing-to'));
    }

    if (edge.from === edge.to && isNonEmptyString(edge.from)) {
        errors.push(snapshotError(pathPrefix, 'self-relation-not-allowed'));
    }

    if (!isNonEmptyString(edge.relation) || !RELATION_TYPES.has(edge.relation)) {
        errors.push(snapshotError(`${pathPrefix}.relation`, 'invalid-relation'));
    }

    if (isNonEmptyString(edge.from) && !validKeys.has(edge.from)) {
        errors.push(snapshotError(`${pathPrefix}.from`, 'dangling-edge'));
    }

    if (isNonEmptyString(edge.to) && !validKeys.has(edge.to)) {
        errors.push(snapshotError(`${pathPrefix}.to`, 'dangling-edge'));
    }

    const id = isNonEmptyString(edge.from) && isNonEmptyString(edge.to) && isNonEmptyString(edge.relation)
        ? edgeId(edge.from, edge.relation, edge.to)
        : null;
    const duplicate = Boolean(id && (existingEdgeIds.has(id) || seenEdges.has(id)));
    if (id && !duplicate) {
        seenEdges.add(id);
    }

    if (!hasOwn(edge, 'reason') || typeof edge.reason !== 'string') {
        errors.push(snapshotError(`${pathPrefix}.reason`, 'invalid-reason'));
    }

    if (!hasOwn(edge, 'weight') || !isValidWeight(edge.weight)) {
        errors.push(snapshotError(`${pathPrefix}.weight`, 'invalid-weight'));
    }

    if (!hasOwn(edge, 'updatedAt') || !isNonNegativeInteger(edge.updatedAt)) {
        errors.push(snapshotError(`${pathPrefix}.updatedAt`, 'invalid-updatedAt'));
    }

    if (!hasOwn(edge, 'updatedBy') || !isNullableString(edge.updatedBy)) {
        errors.push(snapshotError(`${pathPrefix}.updatedBy`, 'invalid-updatedBy'));
    }

    if (errors.length > initialErrorCount) return null;
    if (duplicate) return { duplicate: true };

    return {
        from: edge.from,
        to: edge.to,
        relation: edge.relation,
        reason: edge.reason,
        weight: edge.weight,
        updatedAt: edge.updatedAt,
        updatedBy: edge.updatedBy,
    };
}

function validateSnapshotMerge(snapshot, existingKeys = new Set(), existingEdgeIds = new Set()) {
    const errors = [];

    if (!isPlainObject(snapshot)) {
        return {
            ok: false,
            errors: [snapshotError('snapshot', 'invalid-snapshot')],
            stats: null,
        };
    }

    if (!isPlainObject(snapshot.entries)) {
        errors.push(snapshotError('entries', 'invalid-entries'));
    }

    if (!Array.isArray(snapshot.edges)) {
        errors.push(snapshotError('edges', 'invalid-edges'));
    }

    if (errors.length > 0) {
        return { ok: false, errors, stats: null };
    }

    const normalizedEntries = {};
    const validKeys = new Set(existingKeys);
    let entriesAdded = 0;
    let entriesSkipped = 0;

    for (const key of Object.keys(snapshot.entries).sort()) {
        const normalized = validateSnapshotEntry(key, snapshot.entries[key], errors);
        if (!normalized) continue;

        if (existingKeys.has(key)) {
            entriesSkipped += 1;
            continue;
        }

        normalizedEntries[key] = normalized;
        validKeys.add(key);
        entriesAdded += 1;
    }

    const normalizedEdges = [];
    const seenEdges = new Set(existingEdgeIds);
    let edgesAdded = 0;
    let edgesSkipped = 0;

    snapshot.edges.forEach((edge, index) => {
        const normalized = validateMergeSnapshotEdge(edge, index, validKeys, seenEdges, existingEdgeIds, errors);
        if (!normalized) return;
        if (normalized.duplicate) {
            edgesSkipped += 1;
            return;
        }

        normalizedEdges.push(normalized);
        edgesAdded += 1;
    });

    if (errors.length > 0) {
        return { ok: false, errors, stats: null };
    }

    normalizedEdges.sort((a, b) => {
        const byFrom = a.from.localeCompare(b.from);
        if (byFrom !== 0) return byFrom;
        const byRelation = a.relation.localeCompare(b.relation);
        if (byRelation !== 0) return byRelation;
        return a.to.localeCompare(b.to);
    });

    return {
        ok: true,
        errors: [],
        stats: {
            entriesAdded,
            entriesSkipped,
            edgesAdded,
            edgesSkipped,
        },
        snapshot: {
            entries: normalizedEntries,
            edges: normalizedEdges,
        },
    };
}

function validateSnapshot(snapshot, options = {}) {
    if (options.mode === 'merge') {
        return validateSnapshotMerge(snapshot, options.existingKeys, options.existingEdgeIds);
    }

    return validateSnapshotReplace(snapshot);
}

function initSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS entries (
            key        TEXT    NOT NULL PRIMARY KEY,
            value_json TEXT    NOT NULL,
            summary    TEXT    NOT NULL DEFAULT '',
            importance INTEGER NOT NULL DEFAULT 0,
            revision   INTEGER NOT NULL DEFAULT 1,
            expires_at INTEGER,
            updated_at INTEGER NOT NULL,
            updated_by TEXT
        );

        CREATE TABLE IF NOT EXISTS tags (
            key TEXT NOT NULL REFERENCES entries(key) ON DELETE CASCADE,
            tag TEXT NOT NULL,
            PRIMARY KEY (key, tag)
        );

        CREATE TABLE IF NOT EXISTS edges (
            edge_id    TEXT NOT NULL PRIMARY KEY,
            from_key   TEXT NOT NULL REFERENCES entries(key) ON DELETE CASCADE,
            to_key     TEXT NOT NULL REFERENCES entries(key) ON DELETE CASCADE,
            relation   TEXT NOT NULL,
            reason     TEXT NOT NULL DEFAULT '',
            weight     REAL NOT NULL DEFAULT 1,
            updated_at INTEGER NOT NULL,
            updated_by TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_entries_importance ON entries(importance);
        CREATE INDEX IF NOT EXISTS idx_entries_expires_at ON entries(expires_at) WHERE expires_at IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
        CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_key);
        CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_key);

        CREATE VIRTUAL TABLE IF NOT EXISTS fts_entries USING fts5(
            key  UNINDEXED,
            body,
            tokenize='trigram'
        );
    `);

    const columns = db.prepare('PRAGMA table_info(entries)').all();
    if (!columns.some((column) => column.name === 'revision')) {
        db.exec('ALTER TABLE entries ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
    }
}

// Concatenate key, summary, and tags into a single string for FTS5 indexing.
function ftsBody(key, summary, tags) {
    return [key, summary, ...tags].filter(Boolean).join(' ');
}

function rowToEntry(row, tags) {
    return {
        value: JSON.parse(row.value_json),
        summary: row.summary,
        tags,
        importance: row.importance,
        revision: row.revision,
        expiresAt: row.expires_at !== null && row.expires_at !== undefined ? row.expires_at : null,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by !== null && row.updated_by !== undefined ? row.updated_by : null,
    };
}

function rowToEdge(row) {
    return {
        id: row.edge_id,
        from: row.from_key,
        to: row.to_key,
        relation: row.relation,
        reason: row.reason,
        weight: row.weight,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by !== null && row.updated_by !== undefined ? row.updated_by : null,
    };
}

/**
 * Create a shared memory store.
 *
 * @param {object} [options]
 * @param {Function} [options.clock] - Clock returning ms since epoch (default: Date.now).
 * @param {object} [options.persistence] - Enables SQLite persistence when set with a file path.
 * @param {string} options.persistence.file - Path to the SQLite database file.
 * @param {number} [options.persistence.debounceMs=500] - Debounce window for WAL checkpoint/status cleanup.
 * @param {object} [options.persistence.scheduler] - Injectable {setTimeout, clearTimeout} for testing.
 * @param {number} [options.pruneIntervalMs=600000] - Advisory interval hint for callers of pruneExpired.
 */
function createMemoryStore(options = {}) {
    const now = options.clock || options.now || Date.now;
    const persistenceOptions = options.persistence || null;
    const dbFile = persistenceOptions && persistenceOptions.file
        ? path.resolve(persistenceOptions.file)
        : null;

    let db;
    try {
        db = new DatabaseSync(dbFile !== null ? dbFile : ':memory:');
        db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA wal_autocheckpoint = 1000;');
        initSchema(db);
    } catch (error) {
        throw new Error(`Failed to load memory persistence file ${dbFile}: ${error.message}`);
    }

    const persistence = {
        enabled: dbFile !== null,
        file: dbFile,
        debounceMs: (persistenceOptions && persistenceOptions.debounceMs != null)
            ? persistenceOptions.debounceMs
            : DEFAULT_PERSISTENCE_DEBOUNCE_MS,
        scheduler: (persistenceOptions && persistenceOptions.scheduler)
            ? persistenceOptions.scheduler
            : { setTimeout, clearTimeout },
    };

    let dirty = false;
    let flushTimer = null;
    let lastLoadedAt = dbFile !== null ? Date.now() : null;
    let lastFlushedAt = null;
    let lastFlushError = null;
    let lastCheckpointAt = null;
    let lastCheckpointMode = null;
    let lastCheckpointError = null;
    let lastPrunedAt = null;
    const testHooks = options.testHooks || {};

    // Prepared statements compiled once and reused for every call.
    const stmts = {
        // ON CONFLICT DO UPDATE avoids triggering ON DELETE CASCADE on the old row.
        upsertEntry: db.prepare(`
            INSERT INTO entries (key, value_json, summary, importance, revision, expires_at, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value_json = excluded.value_json,
                summary    = excluded.summary,
                importance = excluded.importance,
                revision   = excluded.revision,
                expires_at = excluded.expires_at,
                updated_at = excluded.updated_at,
                updated_by = excluded.updated_by
        `),
        deleteTags: db.prepare('DELETE FROM tags WHERE key = ?'),
        insertTag: db.prepare('INSERT OR IGNORE INTO tags (key, tag) VALUES (?, ?)'),
        getEntry: db.prepare('SELECT * FROM entries WHERE key = ?'),
        getVisibleEntry: db.prepare(
            'SELECT * FROM entries WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)',
        ),
        deleteEntry: db.prepare('DELETE FROM entries WHERE key = ?'),
        allVisibleKeys: db.prepare(
            'SELECT key FROM entries WHERE expires_at IS NULL OR expires_at > ?',
        ),
        countVisible: db.prepare(
            'SELECT COUNT(*) as cnt FROM entries WHERE expires_at IS NULL OR expires_at > ?',
        ),
        countRelations: db.prepare(`
            SELECT COUNT(*) as cnt FROM edges e
            WHERE EXISTS (SELECT 1 FROM entries WHERE key = e.from_key AND (expires_at IS NULL OR expires_at > ?))
            AND   EXISTS (SELECT 1 FROM entries WHERE key = e.to_key   AND (expires_at IS NULL OR expires_at > ?))
        `),
        getTagsForKey: db.prepare('SELECT tag FROM tags WHERE key = ?'),
        getIncidentEdges: db.prepare(
            'SELECT * FROM edges WHERE from_key = ? OR to_key = ?',
        ),
        getIncidentVisibleEdges: db.prepare(`
            SELECT e.* FROM edges e
            WHERE (e.from_key = ? OR e.to_key = ?)
            AND EXISTS (SELECT 1 FROM entries WHERE key = e.from_key AND (expires_at IS NULL OR expires_at > ?))
            AND EXISTS (SELECT 1 FROM entries WHERE key = e.to_key   AND (expires_at IS NULL OR expires_at > ?))
        `),
        getEdge: db.prepare('SELECT * FROM edges WHERE edge_id = ?'),
        upsertEdge: db.prepare(
            'INSERT OR REPLACE INTO edges (edge_id, from_key, to_key, relation, reason, weight, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ),
        deleteEdge: db.prepare('DELETE FROM edges WHERE edge_id = ?'),
        allEntries: db.prepare('SELECT * FROM entries'),
        allVisibleEntries: db.prepare(
            'SELECT * FROM entries WHERE expires_at IS NULL OR expires_at > ?',
        ),
        allTags: db.prepare('SELECT key, tag FROM tags'),
        allEdges: db.prepare('SELECT * FROM edges'),
        getExpiredEntries: db.prepare(
            'SELECT * FROM entries WHERE expires_at IS NOT NULL AND expires_at <= ?',
        ),
        pruneExpiredEntries: db.prepare(
            'DELETE FROM entries WHERE expires_at IS NOT NULL AND expires_at <= ?',
        ),
        countExpired: db.prepare(
            'SELECT COUNT(*) as cnt FROM entries WHERE expires_at IS NOT NULL AND expires_at <= ?',
        ),
        touchEntry: db.prepare(
            'UPDATE entries SET expires_at = ?, updated_at = ?, updated_by = ?, revision = ? WHERE key = ?',
        ),
        deleteAllEntries: db.prepare('DELETE FROM entries'),
        getEntryRowid: db.prepare('SELECT rowid FROM entries WHERE key = ?'),
        getEntryWithRowid: db.prepare('SELECT rowid, * FROM entries WHERE key = ?'),
        ftsInsert: db.prepare('INSERT INTO fts_entries(rowid, key, body) VALUES (?, ?, ?)'),
        ftsDelete: db.prepare('DELETE FROM fts_entries WHERE rowid = ?'),
        // Wrap query in double-quoted phrase to prevent FTS5 syntax interpretation.
        ftsSearch: db.prepare('SELECT key FROM fts_entries WHERE body MATCH ?'),
        ftsDeleteAll: db.prepare('DELETE FROM fts_entries'),
    };

    // Wraps a function in a BEGIN/COMMIT/ROLLBACK transaction.
    function inTransaction(fn) {
        return function (...args) {
            db.exec('BEGIN');
            try {
                const result = fn(...args);
                db.exec('COMMIT');
                return result;
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        };
    }

    function isVisibleRow(row, t) {
        return Boolean(row) && (row.expires_at === null || row.expires_at === undefined || row.expires_at > t);
    }

    function revisionConflict(key, currentRevision) {
        return {
            ok: false,
            error: 'revision-conflict',
            key,
            currentRevision,
        };
    }

    function validateRevisionCheck(key, row, ifRevision, t, allowCreateOnly) {
        if (ifRevision === undefined) return null;

        if (ifRevision === null) {
            if (!allowCreateOnly) return { ok: false, error: 'invalid-ifRevision', key };
            return isVisibleRow(row, t) ? revisionConflict(key, row.revision) : null;
        }

        if (!isPositiveInteger(ifRevision)) {
            return { ok: false, error: 'invalid-ifRevision', key };
        }

        if (!row) return revisionConflict(key, null);
        return row.revision === ifRevision ? null : revisionConflict(key, row.revision);
    }

    function applySet(key, valueJson, summary, importance, expiresAt, ts, updatedBy, tags, ifRevision) {
        const existing = stmts.getEntryWithRowid.get(key);
        const revisionError = validateRevisionCheck(key, existing, ifRevision, ts, true);
        if (revisionError) return revisionError;

        const nextRevision = existing ? existing.revision + 1 : 1;
        stmts.upsertEntry.run(key, valueJson, summary, importance, nextRevision, expiresAt, ts, updatedBy);
        stmts.deleteTags.run(key);
        for (const tag of tags) {
            stmts.insertTag.run(key, tag);
        }
        if (existing) stmts.ftsDelete.run(existing.rowid);
        const current = stmts.getEntryRowid.get(key);
        stmts.ftsInsert.run(current.rowid, key, ftsBody(key, summary, tags));
        return { ok: true, revision: nextRevision };
    }

    const doSet = inTransaction(applySet);

    const doDelete = inTransaction((key, ifRevision) => {
        const existing = stmts.getEntryWithRowid.get(key);
        const revisionError = validateRevisionCheck(key, existing, ifRevision, now(), false);
        if (revisionError) return revisionError;

        const incidentEdgeRows = stmts.getIncidentEdges.all(key, key);
        const removedEdges = incidentEdgeRows.map(rowToEdge);
        const result = stmts.deleteEntry.run(key);
        if (existing && result.changes > 0) stmts.ftsDelete.run(existing.rowid);
        return {
            ok: true,
            removed: result.changes > 0,
            revision: existing ? existing.revision : null,
            removedEdges,
        };
    });

    const doTouch = inTransaction((key, expiresAt, ts, updatedBy, ifRevision) => {
        const row = stmts.getEntry.get(key);
        if (!row) return { ok: false, error: 'missing-node' };

        const revisionError = validateRevisionCheck(key, row, ifRevision, ts, false);
        if (revisionError) return revisionError;

        const nextRevision = row.revision + 1;
        stmts.touchEntry.run(expiresAt, ts, updatedBy, nextRevision, key);
        return {
            ok: true,
            row,
            revision: nextRevision,
        };
    });

    function applyRelate(from, to, relation, updatedBy, metadata = {}, t = now()) {
        if (from === to) return { ok: false, error: 'self-relation-not-allowed' };
        if (!RELATION_TYPES.has(relation)) return { ok: false, error: 'invalid-relation' };
        if (metadata.weight !== undefined && !isValidWeight(metadata.weight)) {
            return { ok: false, error: 'invalid-weight' };
        }

        if (!stmts.getVisibleEntry.get(from, t) || !stmts.getVisibleEntry.get(to, t)) {
            return { ok: false, error: 'missing-node' };
        }

        const id = edgeId(from, relation, to);
        const action = stmts.getEdge.get(id) ? 'updated' : 'created';
        stmts.upsertEdge.run(id, from, to, relation, metadata.reason || '', metadata.weight ?? 1, t, updatedBy);

        const edge = {
            id,
            from,
            to,
            relation,
            reason: metadata.reason || '',
            weight: metadata.weight ?? 1,
            updatedAt: t,
            updatedBy,
        };
        return { ok: true, action, edge };
    }

    const doRelate = inTransaction(applyRelate);

    const doPrune = inTransaction((t) => {
        const expiredRows = stmts.getExpiredEntries.all(t);
        const keys = expiredRows.map((row) => row.key);

        // Collect FTS rowids and incident edges before CASCADE removes them.
        const edgeMap = new Map();
        const ftsRowids = [];
        for (const row of expiredRows) {
            const rowidRow = stmts.getEntryRowid.get(row.key);
            if (rowidRow) ftsRowids.push(rowidRow.rowid);
            for (const edgeRow of stmts.getIncidentEdges.all(row.key, row.key)) {
                if (!edgeMap.has(edgeRow.edge_id)) {
                    edgeMap.set(edgeRow.edge_id, rowToEdge(edgeRow));
                }
            }
        }

        stmts.pruneExpiredEntries.run(t);
        for (const rowid of ftsRowids) stmts.ftsDelete.run(rowid);
        return { keys, removedEdges: Array.from(edgeMap.values()) };
    });

    const doImport = inTransaction((state) => {
        stmts.deleteAllEntries.run(); // CASCADE removes tags and edges.
        stmts.ftsDeleteAll.run();

        if (!isPlainObject(state)) return;

        const loadedEntries = isPlainObject(state.entries) ? state.entries : {};
        for (const [key, entry] of Object.entries(loadedEntries)) {
            if (!isNonEmptyString(key) || !isPlainObject(entry)) continue;

            const summary = isNonEmptyString(entry.summary) ? entry.summary : safeSummary(entry.value);
            const importance = isValidImportance(entry.importance) ? entry.importance : DEFAULT_IMPORTANCE;
            const revision = isPositiveInteger(entry.revision) ? entry.revision : 1;
            const expiresAt = isPositiveInteger(entry.expiresAt) ? entry.expiresAt : null;
            const updatedAt = typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)
                ? entry.updatedAt
                : now();
            const updatedBy = entry.updatedBy !== undefined ? entry.updatedBy : null;
            const tags = normalizeTags(entry.tags);

            stmts.upsertEntry.run(key, JSON.stringify(entry.value), summary, importance, revision, expiresAt, updatedAt, updatedBy);
            for (const tag of tags) {
                stmts.insertTag.run(key, tag);
            }
            const rowidRow = stmts.getEntryRowid.get(key);
            stmts.ftsInsert.run(rowidRow.rowid, key, ftsBody(key, summary, tags));
        }

        // Drops edges where either endpoint key is absent (dangling edge pruning on import).
        const loadedEdges = Array.isArray(state.edges) ? state.edges : [];
        for (const edge of loadedEdges) {
            if (!isPlainObject(edge)) continue;
            if (!isNonEmptyString(edge.from) || !isNonEmptyString(edge.to)) continue;
            if (edge.from === edge.to) continue;
            if (!isNonEmptyString(edge.relation) || !RELATION_TYPES.has(edge.relation)) continue;
            if (!stmts.getEntry.get(edge.from) || !stmts.getEntry.get(edge.to)) continue;

            const id = edgeId(edge.from, edge.relation, edge.to);
            const reason = isNonEmptyString(edge.reason) ? edge.reason : '';
            const weight = isValidWeight(edge.weight) ? edge.weight : 1;
            const updatedAt = typeof edge.updatedAt === 'number' && Number.isFinite(edge.updatedAt)
                ? edge.updatedAt
                : now();
            const updatedBy = edge.updatedBy !== undefined ? edge.updatedBy : null;

            stmts.upsertEdge.run(id, edge.from, edge.to, edge.relation, reason, weight, updatedAt, updatedBy);
        }
    });

    const doMerge = inTransaction((state) => {
        if (!isPlainObject(state)) return;

        const loadedEntries = isPlainObject(state.entries) ? state.entries : {};
        for (const [key, entry] of Object.entries(loadedEntries)) {
            if (!isNonEmptyString(key) || !isPlainObject(entry)) continue;

            const summary = isNonEmptyString(entry.summary) ? entry.summary : safeSummary(entry.value);
            const importance = isValidImportance(entry.importance) ? entry.importance : DEFAULT_IMPORTANCE;
            const revision = isPositiveInteger(entry.revision) ? entry.revision : 1;
            const expiresAt = isPositiveInteger(entry.expiresAt) ? entry.expiresAt : null;
            const updatedAt = typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)
                ? entry.updatedAt
                : now();
            const updatedBy = entry.updatedBy !== undefined ? entry.updatedBy : null;
            const tags = normalizeTags(entry.tags);

            stmts.upsertEntry.run(key, JSON.stringify(entry.value), summary, importance, revision, expiresAt, updatedAt, updatedBy);
            for (const tag of tags) {
                stmts.insertTag.run(key, tag);
            }
            const rowidRow = stmts.getEntryRowid.get(key);
            stmts.ftsInsert.run(rowidRow.rowid, key, ftsBody(key, summary, tags));
        }

        const loadedEdges = Array.isArray(state.edges) ? state.edges : [];
        for (const edge of loadedEdges) {
            if (!isPlainObject(edge)) continue;
            if (!isNonEmptyString(edge.from) || !isNonEmptyString(edge.to)) continue;
            if (edge.from === edge.to) continue;
            if (!isNonEmptyString(edge.relation) || !RELATION_TYPES.has(edge.relation)) continue;
            if (!stmts.getEntry.get(edge.from) || !stmts.getEntry.get(edge.to)) continue;

            const id = edgeId(edge.from, edge.relation, edge.to);
            const reason = isNonEmptyString(edge.reason) ? edge.reason : '';
            const weight = isValidWeight(edge.weight) ? edge.weight : 1;
            const updatedAt = typeof edge.updatedAt === 'number' && Number.isFinite(edge.updatedAt)
                ? edge.updatedAt
                : now();
            const updatedBy = edge.updatedBy !== undefined ? edge.updatedBy : null;

            stmts.upsertEdge.run(id, edge.from, edge.to, edge.relation, reason, weight, updatedAt, updatedBy);
        }
    });

    // Accepts ttlMs (ms from now) or expiresAt (absolute ms timestamp); ttlMs takes precedence.
    function normalizeExpiry(metadata = {}) {
        if (isPositiveInteger(metadata.ttlMs)) {
            return now() + metadata.ttlMs;
        }

        if (isPositiveInteger(metadata.expiresAt)) {
            return metadata.expiresAt;
        }

        return null;
    }

    function clearPendingFlush() {
        if (!flushTimer) return;
        persistence.scheduler.clearTimeout(flushTimer);
        flushTimer = null;
    }

    function scheduleFlush() {
        if (!persistence.enabled || flushTimer) return;

        flushTimer = persistence.scheduler.setTimeout(async () => {
            flushTimer = null;
            try {
                await flush(); // eslint-disable-line no-use-before-define
            } catch (error) {
                lastFlushError = error.message;
                dirty = true;
                console.error(`Failed to flush memory persistence: ${error.message}`);
            }
        }, persistence.debounceMs);
    }

    function markDirty() {
        if (!persistence.enabled) return;
        dirty = true;
        scheduleFlush();
    }

    function checkpointWal(mode) {
        if (!persistence.enabled) return;
        db.exec(`PRAGMA wal_checkpoint(${mode});`);
        lastCheckpointAt = Date.now();
        lastCheckpointMode = mode;
        lastCheckpointError = null;
    }

    function recordFlushSuccess() {
        dirty = false;
        lastFlushedAt = Date.now();
        lastFlushError = null;
    }

    function recordFlushFailure(error) {
        dirty = true;
        lastFlushError = error.message;
        lastCheckpointError = error.message;
    }

    // Async flush; returns Promise<boolean> (true if checkpointed). SQLite commits are immediate;
    // this coalesces status cleanup and uses RESTART checkpointing to bound WAL growth.
    async function flush() {
        if (!persistence.enabled) return false;
        clearPendingFlush();
        if (!dirty) return false;
        try {
            checkpointWal('RESTART');
            recordFlushSuccess();
            return true;
        } catch (error) {
            recordFlushFailure(error);
            throw error;
        }
    }

    // Synchronous flush for SIGINT/SIGTERM handlers. Returns true if checkpointed.
    function flushSync() {
        if (!persistence.enabled || !dirty) return false;
        clearPendingFlush();
        try {
            checkpointWal('TRUNCATE');
            recordFlushSuccess();
            return true;
        } catch (error) {
            recordFlushFailure(error);
            throw error;
        }
    }

    function persistenceStatus() {
        return {
            enabled: persistence.enabled,
            file: persistence.file,
            dirty,
            lastLoadedAt,
            lastFlushedAt,
            lastFlushError,
            lastCheckpointAt,
            lastCheckpointMode,
            lastCheckpointError,
        };
    }

    function expiredCount() {
        return stmts.countExpired.get(now()).cnt;
    }

    function expiryStatus() {
        return {
            expiredMemoryCount: expiredCount(),
            pruneIntervalMs: options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS,
            lastPrunedAt,
        };
    }

    function isExpired(key) {
        const row = stmts.getEntry.get(key);
        if (!row || row.expires_at === null || row.expires_at === undefined) return false;
        return row.expires_at <= now();
    }

    function currentKeySet() {
        return new Set(stmts.allEntries.all().map((row) => row.key));
    }

    function currentEdgeIdSet() {
        return new Set(stmts.allEdges.all().map((row) => row.edge_id));
    }

    function exportState() {
        const entryRows = stmts.allEntries.all();
        const tagRows = stmts.allTags.all();
        const edgeRows = stmts.allEdges.all();

        const tagsByKey = {};
        for (const row of tagRows) {
            if (!tagsByKey[row.key]) tagsByKey[row.key] = [];
            tagsByKey[row.key].push(row.tag);
        }
        for (const tags of Object.values(tagsByKey)) {
            tags.sort();
        }

        const exportedEntries = {};
        for (const row of entryRows.sort((a, b) => a.key.localeCompare(b.key))) {
            exportedEntries[row.key] = {
                value: JSON.parse(row.value_json),
                summary: row.summary,
                tags: tagsByKey[row.key] || [],
                importance: row.importance,
                revision: row.revision,
                expiresAt: row.expires_at !== null && row.expires_at !== undefined ? row.expires_at : null,
                updatedAt: row.updated_at,
                updatedBy: row.updated_by !== null && row.updated_by !== undefined ? row.updated_by : null,
            };
        }

        const exportedEdges = edgeRows
            .map(rowToEdge)
            .map(({ id, ...edge }) => edge)
            .sort((a, b) => {
                const byFrom = a.from.localeCompare(b.from);
                if (byFrom !== 0) return byFrom;
                const byRelation = a.relation.localeCompare(b.relation);
                if (byRelation !== 0) return byRelation;
                return a.to.localeCompare(b.to);
            });

        return { entries: exportedEntries, edges: exportedEdges };
    }

    /**
     * Return the subgraph reachable from key via BFS up to depth hops.
     *
     * Root key is always first in nodes regardless of importance ordering.
     * limit caps total node count including the root.
     * Returns null if key is missing or expired.
     */
    function map(key, opts = {}) {
        const t = now();
        if (!stmts.getVisibleEntry.get(key, t)) return null;

        const depth = opts.depth ?? DEFAULT_MAP_DEPTH;
        const limit = opts.limit ?? DEFAULT_MAP_LIMIT;
        const visited = new Set([key]);
        const queue = [{ key, depth: 0 }];
        const edgeIds = new Set();

        for (let index = 0; index < queue.length; index++) {
            const current = queue[index];
            if (current.depth >= depth) continue;

            const incidentEdges = stmts.getIncidentVisibleEdges.all(current.key, current.key, t, t);

            incidentEdges.sort((a, b) => {
                const aNext = a.from_key === current.key ? a.to_key : a.from_key;
                const bNext = b.from_key === current.key ? b.to_key : b.from_key;
                const aRow = stmts.getEntry.get(aNext);
                const bRow = stmts.getEntry.get(bNext);

                const byNeighbor = sortNodeRecords(
                    { key: aNext, entry: { importance: aRow ? aRow.importance : 0, updatedAt: aRow ? aRow.updated_at : 0 } },
                    { key: bNext, entry: { importance: bRow ? bRow.importance : 0, updatedAt: bRow ? bRow.updated_at : 0 } },
                );
                if (byNeighbor !== 0) return byNeighbor;

                const byFrom = a.from_key.localeCompare(b.from_key);
                if (byFrom !== 0) return byFrom;
                const byRelation = a.relation.localeCompare(b.relation);
                if (byRelation !== 0) return byRelation;
                return a.to_key.localeCompare(b.to_key);
            });

            for (const edgeRow of incidentEdges) {
                edgeIds.add(edgeRow.edge_id);
                const nextKey = edgeRow.from_key === current.key ? edgeRow.to_key : edgeRow.from_key;
                if (!visited.has(nextKey)) {
                    visited.add(nextKey);
                    queue.push({ key: nextKey, depth: current.depth + 1 });
                }
            }
        }

        // Fetch rows for all visited nodes (used for sort and nodeMetadata).
        const visitedRows = {};
        for (const visitedKey of visited) {
            visitedRows[visitedKey] = stmts.getEntry.get(visitedKey);
        }

        const sortedKeys = Array.from(visited)
            .map((k) => ({
                key: k,
                entry: {
                    importance: visitedRows[k] ? visitedRows[k].importance : 0,
                    updatedAt: visitedRows[k] ? visitedRows[k].updated_at : 0,
                },
            }))
            .sort(sortNodeRecords)
            .map((r) => r.key);

        const selectedKeys = [key]
            .concat(sortedKeys.filter((k) => k !== key))
            .slice(0, limit);

        const selectedKeySet = new Set(selectedKeys);

        const selectedEdges = Array.from(edgeIds)
            .map((id) => stmts.getEdge.get(id))
            .filter((row) => row && selectedKeySet.has(row.from_key) && selectedKeySet.has(row.to_key))
            .map(rowToEdge)
            .map(({ id, ...edge }) => edge)
            .sort((a, b) => {
                const byFrom = a.from.localeCompare(b.from);
                if (byFrom !== 0) return byFrom;
                const byRelation = a.relation.localeCompare(b.relation);
                if (byRelation !== 0) return byRelation;
                return a.to.localeCompare(b.to);
            });

        const nodes = selectedKeys.map((nodeKey) => {
            const row = visitedRows[nodeKey];
            const tags = stmts.getTagsForKey.all(nodeKey).map((r) => r.tag);
            return nodeMetadata(nodeKey, rowToEntry(row, tags));
        });

        return { key, nodes, edges: selectedEdges };
    }

    function searchSqlParts({ query, tags, minImportance, t }) {
        const fromSql = query
            ? 'fts_entries f JOIN entries e ON e.rowid = f.rowid'
            : 'entries e';
        const where = [];
        const params = [];

        if (query) {
            where.push('f.body MATCH ?');
            params.push(`"${query.replace(/"/g, '""')}"`);
        }

        where.push('(e.expires_at IS NULL OR e.expires_at > ?)');
        params.push(t);

        if (minImportance !== null) {
            where.push('e.importance >= ?');
            params.push(minImportance);
        }

        if (tags) {
            tags.forEach((tag, index) => {
                where.push(`EXISTS (SELECT 1 FROM tags t${index} WHERE t${index}.key = e.key AND LOWER(t${index}.tag) = ?)`);
                params.push(tag);
            });
        }

        return {
            fromSql,
            whereSql: where.join(' AND '),
            params,
        };
    }

    // query matches key, summary, and tags through SQLite FTS5 trigram search.
    // tags is an AND filter. Returns { results, total } where total is the pre-limit visible match count.
    function search(filters = {}) {
        const rawQuery = typeof filters.query === 'string' ? filters.query.trim() : '';
        const query = rawQuery.length > 0 ? rawQuery : null;

        const rawTags = Array.isArray(filters.tags)
            ? filters.tags.map((tag) => (typeof tag === 'string' ? tag.trim().toLowerCase() : '')).filter(Boolean)
            : [];
        const tags = rawTags.length > 0 ? rawTags : null;

        const minImportance = Number.isInteger(filters.minImportance) ? filters.minImportance : null;
        const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : 20;
        const t = now();

        const { fromSql, whereSql, params } = searchSqlParts({ query, tags, minImportance, t });
        const total = db.prepare(`SELECT COUNT(*) AS total FROM ${fromSql} WHERE ${whereSql}`).get(...params).total;
        if (total === 0) return { results: [], total: 0 };

        const rows = db.prepare(`
            SELECT e.*
            FROM ${fromSql}
            WHERE ${whereSql}
            ORDER BY e.importance DESC, e.updated_at DESC, e.key ASC
            LIMIT ?
        `).all(...params, limit);

        const results = rows.map((row) => {
            const entryTags = stmts.getTagsForKey.all(row.key).map((tagRow) => tagRow.tag);
            return nodeMetadata(row.key, rowToEntry(row, entryTags));
        });

        return { results, total };
    }

    // Returns zombie/orphan/duplicate/stale/expired lists plus summary counts.
    function audit(options = {}) {
        const staleMs = (typeof options.staleMs === 'number' && Number.isInteger(options.staleMs) && options.staleMs > 0)
            ? options.staleMs
            : 7 * 24 * 60 * 60 * 1000;
        const t = now();
        const staleThreshold = t - staleMs;

        const allEntryRows = stmts.allEntries.all();
        const allTagRows = stmts.allTags.all();
        const allEdgeRows = stmts.allEdges.all();

        const tagsByKey = {};
        for (const row of allTagRows) {
            if (!tagsByKey[row.key]) tagsByKey[row.key] = [];
            tagsByKey[row.key].push(row.tag);
        }

        const zombies = [];
        for (const row of allEntryRows) {
            const tags = tagsByKey[row.key] || [];
            if (row.importance === 0 || tags.length === 0 || !row.summary || row.summary.trim() === '') {
                zombies.push(row.key);
            }
        }

        const keysWithEdges = new Set();
        for (const row of allEdgeRows) {
            keysWithEdges.add(row.from_key);
            keysWithEdges.add(row.to_key);
        }
        const orphans = allEntryRows.filter((row) => !keysWithEdges.has(row.key)).map((row) => row.key);

        const summaryGroups = {};
        for (const row of allEntryRows) {
            const s = row.summary ? row.summary.trim().toLowerCase() : '';
            if (!s) continue;
            if (!summaryGroups[s]) summaryGroups[s] = [];
            summaryGroups[s].push(row.key);
        }
        const duplicates = Object.values(summaryGroups).filter((keys) => keys.length > 1);

        const stale = allEntryRows.filter((row) => row.updated_at < staleThreshold).map((row) => row.key);
        const expired = allEntryRows
            .filter((row) => row.expires_at !== null && row.expires_at !== undefined && row.expires_at <= t)
            .map((row) => row.key);

        return {
            zombies,
            orphans,
            duplicates,
            stale,
            expired,
            counts: {
                total: allEntryRows.length,
                zombieCount: zombies.length,
                orphanCount: orphans.length,
                duplicateGroupCount: duplicates.length,
                staleCount: stale.length,
                expiredCount: expired.length,
            },
        };
    }

    function bulkValidationFailure(results) {
        return {
            ok: false,
            error: 'bulk-validation-failed',
            results: results.map((result) => (result.ok ? { ...result, ok: false, error: 'not-applied' } : result)),
        };
    }

    function setItemFailure(item, error, extra = {}) {
        return { key: item && item.key, ok: false, error, ...extra };
    }

    function relationItemFailure(item, error) {
        return {
            from: item && item.from,
            to: item && item.to,
            relation: item && item.relation,
            ok: false,
            error,
        };
    }

    function validateSetItemShape(item) {
        if (!isPlainObject(item)) return 'invalid-item';
        if (!isNonEmptyString(item.key)) return 'missing-key';
        if (!hasOwn(item, 'value') || !canSerializeJsonValue(item.value)) return 'invalid-value';
        if (hasOwn(item, 'ttlMs') && hasOwn(item, 'expiresAt')) return 'invalid-expiry';
        if (hasOwn(item, 'ttlMs') && !isPositiveInteger(item.ttlMs)) return 'invalid-expiry';
        if (hasOwn(item, 'expiresAt') && !isPositiveInteger(item.expiresAt)) return 'invalid-expiry';
        if (hasOwn(item, 'summary') && !isNonEmptyString(item.summary)) return 'invalid-summary';
        if (hasOwn(item, 'tags') && !hasValidTags(item.tags)) return 'invalid-tags';
        if (hasOwn(item, 'importance') && !isValidImportance(item.importance)) return 'invalid-importance';
        if (hasOwn(item, 'ifRevision')) {
            if (item.ifRevision !== null && !isPositiveInteger(item.ifRevision)) return 'invalid-ifRevision';
        }
        return null;
    }

    function prepareBulkSet(entries) {
        const seenKeys = new Set();
        const prepared = [];
        const results = [];

        for (const item of entries) {
            const shapeError = validateSetItemShape(item);
            if (shapeError) {
                results.push(setItemFailure(item, shapeError));
                continue;
            }

            if (seenKeys.has(item.key)) {
                results.push(setItemFailure(item, 'duplicate-key'));
                continue;
            }
            seenKeys.add(item.key);

            const ts = now();
            const ifRevision = hasOwn(item, 'ifRevision') ? item.ifRevision : undefined;
            const existing = stmts.getEntryWithRowid.get(item.key);
            const revisionError = validateRevisionCheck(item.key, existing, ifRevision, ts, true);
            if (revisionError) {
                results.push(setItemFailure(item, revisionError.error, { currentRevision: revisionError.currentRevision }));
                continue;
            }

            prepared.push({
                key: item.key,
                valueJson: JSON.stringify(item.value),
                summary: item.summary || safeSummary(item.value),
                tags: normalizeTags(item.tags),
                importance: item.importance ?? DEFAULT_IMPORTANCE,
                expiresAt: normalizeExpiry(item),
                ts,
                ifRevision,
                source: item,
            });
            results.push({ key: item.key, ok: true });
        }

        if (results.some((result) => !result.ok)) return bulkValidationFailure(results);
        return { ok: true, prepared };
    }

    function validateRelationItemShape(item) {
        if (!isPlainObject(item)) return 'invalid-item';
        if (!isNonEmptyString(item.from)) return 'missing-from';
        if (!isNonEmptyString(item.to)) return 'missing-to';
        if (item.from === item.to) return 'self-relation-not-allowed';
        if (!isNonEmptyString(item.relation) || !RELATION_TYPES.has(item.relation)) return 'invalid-relation';
        if (hasOwn(item, 'reason') && !isNonEmptyString(item.reason)) return 'invalid-reason';
        if (hasOwn(item, 'weight') && !isValidWeight(item.weight)) return 'invalid-weight';
        return null;
    }

    function prepareBulkRelate(relations) {
        const seenEdges = new Set();
        const prepared = [];
        const results = [];

        for (const item of relations) {
            const shapeError = validateRelationItemShape(item);
            if (shapeError) {
                results.push(relationItemFailure(item, shapeError));
                continue;
            }

            const id = edgeId(item.from, item.relation, item.to);
            if (seenEdges.has(id)) {
                results.push(relationItemFailure(item, 'duplicate-edge'));
                continue;
            }
            seenEdges.add(id);

            const t = now();
            if (!stmts.getVisibleEntry.get(item.from, t) || !stmts.getVisibleEntry.get(item.to, t)) {
                results.push(relationItemFailure(item, 'missing-node'));
                continue;
            }

            prepared.push({
                from: item.from,
                to: item.to,
                relation: item.relation,
                metadata: {
                    reason: item.reason,
                    weight: item.weight,
                },
                t,
                source: item,
            });
            results.push({ from: item.from, to: item.to, relation: item.relation, ok: true });
        }

        if (results.some((result) => !result.ok)) return bulkValidationFailure(results);
        return { ok: true, prepared };
    }

    const doBulkSet = inTransaction((preparedEntries, updatedBy) => {
        const results = preparedEntries.map((item, index) => {
            const result = applySet(
                item.key,
                item.valueJson,
                item.summary,
                item.importance,
                item.expiresAt,
                item.ts,
                updatedBy,
                item.tags,
                item.ifRevision,
            );
            if (result && result.ok === false) {
                throw new Error(result.error);
            }

            const itemResult = { key: item.key, ok: true, revision: result.revision };
            if (testHooks.afterBulkSetItem) {
                testHooks.afterBulkSetItem({ index, item: item.source, result: itemResult });
            }
            return itemResult;
        });

        return { results, changed: results.length > 0 };
    });

    const doBulkRelate = inTransaction((preparedRelations, updatedBy) => {
        const results = preparedRelations.map((item, index) => {
            const result = applyRelate(item.from, item.to, item.relation, updatedBy, item.metadata, item.t);
            if (!result.ok) {
                throw new Error(result.error);
            }

            const itemResult = {
                from: item.from,
                to: item.to,
                relation: item.relation,
                ok: true,
                action: result.action,
                edge: result.edge,
            };
            if (testHooks.afterBulkRelateItem) {
                testHooks.afterBulkRelateItem({ index, item: item.source, result: itemResult });
            }
            return itemResult;
        });

        return { results, changed: results.length > 0 };
    });

    return {
        // metadata fields: summary, tags, importance (0-10), ttlMs (ms from now), expiresAt (absolute ms).
        set(key, value, updatedBy, metadata = {}) {
            const summary = metadata.summary || safeSummary(value);
            const tags = normalizeTags(metadata.tags);
            const importance = metadata.importance ?? DEFAULT_IMPORTANCE;
            const expiresAt = normalizeExpiry(metadata);
            const ts = now();
            const ifRevision = hasOwn(metadata, 'ifRevision') ? metadata.ifRevision : undefined;

            const result = doSet(key, JSON.stringify(value), summary, importance, expiresAt, ts, updatedBy, tags, ifRevision);
            if (result.ok === false) return result;
            markDirty();

            return {
                value,
                summary,
                tags: tags.slice(),
                importance,
                revision: result.revision,
                expiresAt,
                updatedAt: ts,
                updatedBy,
            };
        },

        get(key) {
            const t = now();
            const row = stmts.getVisibleEntry.get(key, t);
            if (!row) return null;
            const tags = stmts.getTagsForKey.all(key).map((r) => r.tag);
            return rowToEntry(row, tags);
        },

        delete(key, options = {}) {
            const ifRevision = hasOwn(options, 'ifRevision') ? options.ifRevision : undefined;
            const result = doDelete(key, ifRevision);
            if (result.ok === false) return result;

            const { removed, removedEdges } = result;
            if (removed || removedEdges.length > 0) markDirty();
            return { removed, revision: result.revision, removedEdges };
        },

        keys() {
            return stmts.allVisibleKeys.all(now()).map((row) => row.key);
        },

        count() {
            return stmts.countVisible.get(now()).cnt;
        },

        relationCount() {
            const t = now();
            return stmts.countRelations.get(t, t).cnt;
        },

        // Both from and to must already be visible keys.
        // Returns { ok: false, error } or { ok: true, action: 'created'|'updated', edge }.
        relate(from, to, relation, updatedBy, metadata = {}) {
            const result = doRelate(from, to, relation, updatedBy, metadata);
            if (result.ok) markDirty();
            return result;
        },

        // Idempotently removes an edge and reports whether the graph actually changed.
        unrelate(from, to, relation) {
            const id = edgeId(from, relation, to);
            const existing = stmts.getEdge.get(id);
            const edge = existing ? rowToEdge(existing) : {
                id,
                from,
                to,
                relation,
                reason: '',
                weight: 1,
                updatedAt: now(),
                updatedBy: null,
            };

            if (existing) {
                stmts.deleteEdge.run(id);
                markDirty();
            }

            return { removed: Boolean(existing), edge };
        },

        map,

        // Update TTL and updatedAt/updatedBy without changing the stored value.
        touch(key, updatedBy, metadata = {}) {
            const expiresAt = normalizeExpiry(metadata);
            const ts = now();
            const ifRevision = hasOwn(metadata, 'ifRevision') ? metadata.ifRevision : undefined;
            const result = doTouch(key, expiresAt, ts, updatedBy, ifRevision);
            if (!result.ok) return result;
            markDirty();

            const tags = stmts.getTagsForKey.all(key).map((r) => r.tag);
            const entry = {
                value: JSON.parse(result.row.value_json),
                summary: result.row.summary,
                tags,
                importance: result.row.importance,
                revision: result.revision,
                expiresAt,
                updatedAt: ts,
                updatedBy,
            };
            return { ok: true, key, entry };
        },

        pruneExpired() {
            const t = now();
            const result = doPrune(t);
            lastPrunedAt = now();

            if (result.keys.length > 0 || result.removedEdges.length > 0) {
                markDirty();
            }

            return { keys: result.keys, count: result.keys.length, removedEdges: result.removedEdges };
        },

        isExpired,

        expiredCount,

        expiryStatus,

        search,

        exportState,

        validateSnapshot,

        importSnapshot(snapshot, options = {}) {
            const mode = options.mode === 'merge' ? 'merge' : 'replace';
            const validation = validateSnapshot(snapshot, mode === 'merge' ? {
                mode,
                existingKeys: currentKeySet(),
                existingEdgeIds: currentEdgeIdSet(),
            } : {});
            if (!validation.ok) return validation;
            if (mode === 'merge') {
                doMerge(validation.snapshot);
            } else {
                doImport(validation.snapshot);
            }
            markDirty();
            return {
                ok: true,
                errors: [],
                ...(mode === 'merge' ? { mode } : {}),
                stats: validation.stats,
            };
        },

        mergeSnapshot(snapshot) {
            return this.importSnapshot(snapshot, { mode: 'merge' });
        },

        importState(state) {
            const validation = validateSnapshot(state);
            if (!validation.ok) return validation;
            doImport(validation.snapshot);
            markDirty();
            return { ok: true, errors: [], stats: validation.stats };
        },

        // Applies many set calls in one SQLite transaction; any item failure rolls back the batch.
        bulkSet(entries, updatedBy) {
            if (!Array.isArray(entries)) {
                return { ok: false, error: 'missing-entries', results: [] };
            }
            const prepared = prepareBulkSet(entries);
            if (!prepared.ok) return prepared;
            const result = doBulkSet(prepared.prepared, updatedBy);
            if (result.changed) markDirty();
            return { ok: true, results: result.results };
        },

        // Applies many relate calls in one SQLite transaction; any item failure rolls back the batch.
        bulkRelate(relations, updatedBy) {
            if (!Array.isArray(relations)) {
                return { ok: false, error: 'missing-relations', results: [] };
            }
            const prepared = prepareBulkRelate(relations);
            if (!prepared.ok) return prepared;
            const result = doBulkRelate(prepared.prepared, updatedBy);
            if (result.changed) markDirty();
            return { ok: true, results: result.results };
        },

        audit,

        // Async flush; returns Promise<boolean> (true if checkpointed). Coalesces concurrent calls.
        flush,

        // Synchronous flush for SIGINT/SIGTERM handlers. Returns true if checkpointed.
        flushSync,

        persistenceStatus,
    };
}

module.exports = {
    createMemoryStore,
    safeSummary,
    validateSnapshot,
};
