const fs = require('fs');
const path = require('path');

const DEFAULT_IMPORTANCE = 0;
const DEFAULT_MAP_DEPTH = 1;
const DEFAULT_MAP_LIMIT = 10;
const DEFAULT_PERSISTENCE_DEBOUNCE_MS = 500;
const DEFAULT_PRUNE_INTERVAL_MS = 600000;
const FALLBACK_SUMMARY_LIMIT = 120;
const RELATION_TYPES = new Set([
    'related_to',
    'depends_on',
    'supports',
    'contradicts',
    'mentions',
    'derived_from',
    'next_step',
]);

function edgeId(from, relation, to) {
    return `${from}\u0000${relation}\u0000${to}`;
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

function nodeMetadata(key, entry) {
    return {
        key,
        summary: entry.summary,
        tags: entry.tags.slice(),
        importance: entry.importance,
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

function atomicTempFile(file) {
    return path.join(
        path.dirname(file),
        `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`,
    );
}

async function atomicWriteJson(file, state) {
    const dir = path.dirname(file);
    const tempFile = atomicTempFile(file);
    const json = `${JSON.stringify(state, null, 2)}\n`;

    await fs.promises.mkdir(dir, { recursive: true });

    try {
        await fs.promises.writeFile(tempFile, json, 'utf8');
        await fs.promises.rename(tempFile, file);
    } catch (error) {
        try {
            await fs.promises.unlink(tempFile);
        } catch (unlinkError) {
            if (unlinkError.code !== 'ENOENT') {
                // Ignore cleanup failures; preserve the original write error.
            }
        }
        throw error;
    }
}

function atomicWriteJsonSync(file, state) {
    const dir = path.dirname(file);
    const tempFile = atomicTempFile(file);
    const json = `${JSON.stringify(state, null, 2)}\n`;

    fs.mkdirSync(dir, { recursive: true });

    try {
        fs.writeFileSync(tempFile, json, 'utf8');
        fs.renameSync(tempFile, file);
    } catch (error) {
        try {
            fs.unlinkSync(tempFile);
        } catch (unlinkError) {
            if (unlinkError.code !== 'ENOENT') {
                // Ignore cleanup failures; preserve the original write error.
            }
        }
        throw error;
    }
}

function createMemoryStore(options = {}) {
    const now = options.clock || options.now || Date.now;
    const entries = new Map();
    const edges = new Map();
    const persistenceOptions = options.persistence || null;
    const persistence = persistenceOptions && persistenceOptions.file
        ? {
            enabled: true,
            file: path.resolve(persistenceOptions.file),
            debounceMs: persistenceOptions.debounceMs ?? DEFAULT_PERSISTENCE_DEBOUNCE_MS,
            scheduler: persistenceOptions.scheduler || {
                setTimeout,
                clearTimeout,
            },
        }
        : {
            enabled: false,
            file: null,
            debounceMs: DEFAULT_PERSISTENCE_DEBOUNCE_MS,
            scheduler: {
                setTimeout,
                clearTimeout,
            },
        };
    let dirty = false;
    let flushTimer = null;
    let flushPromise = null;
    let lastLoadedAt = null;
    let lastFlushedAt = null;
    let lastFlushError = null;
    let lastPrunedAt = null;

    function normalizeExpiry(metadata = {}) {
        if (isPositiveInteger(metadata.ttlMs)) {
            return now() + metadata.ttlMs;
        }

        if (isPositiveInteger(metadata.expiresAt)) {
            return metadata.expiresAt;
        }

        return null;
    }

    function isExpiredEntry(entry) {
        return Boolean(entry && isPositiveInteger(entry.expiresAt) && entry.expiresAt <= now());
    }

    function isExpired(key) {
        return isExpiredEntry(entries.get(key));
    }

    function visibleEntry(key) {
        const entry = entries.get(key);
        return entry && !isExpiredEntry(entry) ? entry : null;
    }

    function incidentEdges(key) {
        return Array.from(edges.values()).filter((edge) => edge.from === key || edge.to === key);
    }

    function visibleKeys() {
        return Array.from(entries.entries())
            .filter(([, entry]) => !isExpiredEntry(entry))
            .map(([key]) => key);
    }

    function sortedIncidentEdges(key) {
        return incidentEdges(key)
            .filter((edge) => visibleEntry(edge.from) && visibleEntry(edge.to))
            .sort((a, b) => {
                const aNeighborKey = a.from === key ? a.to : a.from;
                const bNeighborKey = b.from === key ? b.to : b.from;
                const byNeighbor = sortNodeRecords(
                    { key: aNeighborKey, entry: entries.get(aNeighborKey) },
                    { key: bNeighborKey, entry: entries.get(bNeighborKey) },
                );
                if (byNeighbor !== 0) return byNeighbor;

                const byFrom = a.from.localeCompare(b.from);
                if (byFrom !== 0) return byFrom;
                const byRelation = a.relation.localeCompare(b.relation);
                if (byRelation !== 0) return byRelation;
                return a.to.localeCompare(b.to);
            });
    }

    function map(key, options = {}) {
        if (!visibleEntry(key)) {
            return null;
        }

        const depth = options.depth ?? DEFAULT_MAP_DEPTH;
        const limit = options.limit ?? DEFAULT_MAP_LIMIT;
        const visited = new Set([key]);
        const queue = [{ key, depth: 0 }];
        const edgeIds = new Set();

        for (let index = 0; index < queue.length; index += 1) {
            const current = queue[index];
            if (current.depth >= depth) continue;

            for (const edge of sortedIncidentEdges(current.key)) {
                edgeIds.add(edge.id);

                const nextKey = edge.from === current.key ? edge.to : edge.from;
                if (!visibleEntry(nextKey) || visited.has(nextKey)) continue;

                visited.add(nextKey);
                queue.push({ key: nextKey, depth: current.depth + 1 });
            }
        }

        const sortedKeys = Array.from(visited)
            .map((nodeKey) => ({ key: nodeKey, entry: entries.get(nodeKey) }))
            .sort(sortNodeRecords)
            .map((record) => record.key);
        const selectedKeys = [key]
            .concat(sortedKeys.filter((nodeKey) => nodeKey !== key))
            .slice(0, limit);

        const selectedKeySet = new Set(selectedKeys);
        const selectedEdges = Array.from(edgeIds)
            .map((id) => edges.get(id))
            .filter((edge) => (
                edge
                && selectedKeySet.has(edge.from)
                && selectedKeySet.has(edge.to)
                && visibleEntry(edge.from)
                && visibleEntry(edge.to)
            ))
            .sort((a, b) => {
                const byFrom = a.from.localeCompare(b.from);
                if (byFrom !== 0) return byFrom;
                const byRelation = a.relation.localeCompare(b.relation);
                if (byRelation !== 0) return byRelation;
                return a.to.localeCompare(b.to);
            });

        return {
            key,
            nodes: selectedKeys.map((nodeKey) => nodeMetadata(nodeKey, entries.get(nodeKey))),
            edges: selectedEdges.map(({ id, ...edge }) => edge),
        };
    }

    function exportState() {
        const exportedEntries = {};

        for (const [key, entry] of entries.entries()) {
            exportedEntries[key] = {
                value: entry.value,
                summary: entry.summary,
                tags: entry.tags.slice(),
                importance: entry.importance,
                expiresAt: entry.expiresAt ?? null,
                updatedAt: entry.updatedAt,
                updatedBy: entry.updatedBy,
            };
        }

        const exportedEdges = Array.from(edges.values())
            .map(({ id, ...edge }) => edge)
            .sort((a, b) => {
                const byFrom = a.from.localeCompare(b.from);
                if (byFrom !== 0) return byFrom;
                const byRelation = a.relation.localeCompare(b.relation);
                if (byRelation !== 0) return byRelation;
                return a.to.localeCompare(b.to);
            });

        return {
            entries: exportedEntries,
            edges: exportedEdges,
        };
    }

    function importState(state) {
        entries.clear();
        edges.clear();

        if (!isPlainObject(state)) return;

        const loadedEntries = isPlainObject(state.entries) ? state.entries : {};
        for (const [key, entry] of Object.entries(loadedEntries)) {
            if (!isNonEmptyString(key) || !isPlainObject(entry)) continue;

            entries.set(key, {
                value: entry.value,
                summary: isNonEmptyString(entry.summary) ? entry.summary : safeSummary(entry.value),
                tags: normalizeTags(entry.tags),
                importance: isValidImportance(entry.importance) ? entry.importance : DEFAULT_IMPORTANCE,
                expiresAt: isPositiveInteger(entry.expiresAt) ? entry.expiresAt : null,
                updatedAt: typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)
                    ? entry.updatedAt
                    : now(),
                updatedBy: entry.updatedBy ?? null,
            });
        }

        const loadedEdges = Array.isArray(state.edges) ? state.edges : [];
        for (const edge of loadedEdges) {
            if (!isPlainObject(edge)) continue;
            if (!isNonEmptyString(edge.from) || !isNonEmptyString(edge.to)) continue;
            if (edge.from === edge.to) continue;
            if (!entries.has(edge.from) || !entries.has(edge.to)) continue;
            if (!isNonEmptyString(edge.relation) || !RELATION_TYPES.has(edge.relation)) continue;

            const id = edgeId(edge.from, edge.relation, edge.to);
            edges.set(id, {
                id,
                from: edge.from,
                to: edge.to,
                relation: edge.relation,
                reason: isNonEmptyString(edge.reason) ? edge.reason : '',
                weight: isValidWeight(edge.weight) ? edge.weight : 1,
                updatedAt: typeof edge.updatedAt === 'number' && Number.isFinite(edge.updatedAt)
                    ? edge.updatedAt
                    : now(),
                updatedBy: edge.updatedBy ?? null,
            });
        }
    }

    function loadPersistedState() {
        if (!persistence.enabled) return;
        if (!fs.existsSync(persistence.file)) {
            lastLoadedAt = Date.now();
            return;
        }

        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(persistence.file, 'utf8'));
        } catch (error) {
            throw new Error(`Failed to load memory persistence file ${persistence.file}: ${error.message}`);
        }

        importState(parsed);
        lastLoadedAt = Date.now();
    }

    function persistenceStatus() {
        return {
            enabled: persistence.enabled,
            file: persistence.file,
            dirty,
            lastLoadedAt,
            lastFlushedAt,
            lastFlushError,
        };
    }

    function expiryStatus() {
        return {
            expiredMemoryCount: expiredCount(),
            pruneIntervalMs: options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS,
            lastPrunedAt,
        };
    }

    function clearPendingFlush() {
        if (!flushTimer) return;
        persistence.scheduler.clearTimeout(flushTimer);
        flushTimer = null;
    }

    async function flush() {
        if (!persistence.enabled) return false;
        clearPendingFlush();
        if (!dirty) return false;
        if (flushPromise) return flushPromise;

        flushPromise = atomicWriteJson(persistence.file, exportState())
            .then(() => {
                dirty = false;
                lastFlushedAt = Date.now();
                lastFlushError = null;
                return true;
            })
            .catch((error) => {
                dirty = true;
                lastFlushError = error.message;
                console.error(`Failed to flush memory persistence: ${error.message}`);
                return false;
            })
            .finally(() => {
                flushPromise = null;
            });

        return flushPromise;
    }

    function flushSync() {
        if (!persistence.enabled || !dirty) return false;
        clearPendingFlush();

        try {
            atomicWriteJsonSync(persistence.file, exportState());
            dirty = false;
            lastFlushedAt = Date.now();
            lastFlushError = null;
            return true;
        } catch (error) {
            dirty = true;
            lastFlushError = error.message;
            console.error(`Failed to synchronously flush memory persistence: ${error.message}`);
            return false;
        }
    }

    function scheduleFlush() {
        if (!persistence.enabled || flushTimer) return;

        flushTimer = persistence.scheduler.setTimeout(async () => {
            flushTimer = null;
            try {
                await flush();
            } catch (error) {
                dirty = true;
                lastFlushError = error.message;
                console.error(`Failed to flush memory persistence: ${error.message}`);
            }
        }, persistence.debounceMs);
    }

    function markDirty() {
        if (!persistence.enabled) return;
        dirty = true;
        scheduleFlush();
    }

    function deleteEntry(key) {
        const removed = entries.delete(key);
        const removedEdges = [];

        for (const [id, edge] of edges.entries()) {
            if (edge.from === key || edge.to === key) {
                removedEdges.push(edge);
                edges.delete(id);
            }
        }

        return { removed, removedEdges };
    }

    function expiredCount() {
        let count = 0;
        for (const entry of entries.values()) {
            if (isExpiredEntry(entry)) count += 1;
        }
        return count;
    }

    function pruneExpired() {
        const keys = [];
        const removedEdges = [];

        for (const [key, entry] of Array.from(entries.entries())) {
            if (!isExpiredEntry(entry)) continue;
            const result = deleteEntry(key);
            if (result.removed) keys.push(key);
            removedEdges.push(...result.removedEdges);
        }

        if (keys.length > 0 || removedEdges.length > 0) {
            lastPrunedAt = now();
            markDirty();
        } else {
            lastPrunedAt = now();
        }

        return {
            keys,
            count: keys.length,
            removedEdges,
        };
    }

    loadPersistedState();

    return {
        set(key, value, updatedBy, metadata = {}) {
            const entry = {
                value,
                summary: metadata.summary || safeSummary(value),
                tags: normalizeTags(metadata.tags),
                importance: metadata.importance ?? DEFAULT_IMPORTANCE,
                expiresAt: normalizeExpiry(metadata),
                updatedAt: now(),
                updatedBy,
            };
            entries.set(key, entry);
            markDirty();
            return entry;
        },

        get(key) {
            return visibleEntry(key);
        },

        delete(key) {
            const { removed, removedEdges } = deleteEntry(key);

            if (removed || removedEdges.length > 0) {
                markDirty();
            }
            return { removed, removedEdges };
        },

        keys() {
            return visibleKeys();
        },

        count() {
            return visibleKeys().length;
        },

        relationCount() {
            return Array.from(edges.values()).filter((edge) => visibleEntry(edge.from) && visibleEntry(edge.to)).length;
        },

        relate(from, to, relation, updatedBy, metadata = {}) {
            if (from === to) {
                return { ok: false, error: 'self-relation-not-allowed' };
            }

            if (!visibleEntry(from) || !visibleEntry(to)) {
                return { ok: false, error: 'missing-node' };
            }

            const id = edgeId(from, relation, to);
            const action = edges.has(id) ? 'updated' : 'created';
            const edge = {
                id,
                from,
                to,
                relation,
                reason: metadata.reason || '',
                weight: metadata.weight ?? 1,
                updatedAt: now(),
                updatedBy,
            };

            edges.set(id, edge);
            markDirty();
            return { ok: true, action, edge };
        },

        unrelate(from, to, relation) {
            const id = edgeId(from, relation, to);
            const edge = edges.get(id) || {
                id,
                from,
                to,
                relation,
                reason: '',
                weight: 1,
                updatedAt: now(),
                updatedBy: null,
            };
            if (edges.delete(id)) {
                markDirty();
            }
            return edge;
        },

        map,

        touch(key, updatedBy, metadata = {}) {
            const entry = entries.get(key);
            if (!entry) return { ok: false, error: 'missing-node' };

            entry.expiresAt = normalizeExpiry(metadata);
            entry.updatedAt = now();
            entry.updatedBy = updatedBy;
            entries.set(key, entry);
            markDirty();
            return { ok: true, key, entry };
        },

        pruneExpired,

        isExpired,

        expiredCount,

        expiryStatus,

        search(filters = {}) {
            const rawQuery = typeof filters.query === 'string' ? filters.query.trim().toLowerCase() : '';
            const query = rawQuery.length > 0 ? rawQuery : null;

            const rawTags = Array.isArray(filters.tags)
                ? filters.tags.map((tag) => (typeof tag === 'string' ? tag.trim().toLowerCase() : '')).filter(Boolean)
                : [];
            const tags = rawTags.length > 0 ? rawTags : null;

            const minImportance = Number.isInteger(filters.minImportance) ? filters.minImportance : null;
            const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : 20;

            const matched = [];
            for (const [key, entry] of entries.entries()) {
                if (isExpiredEntry(entry)) continue;
                if (minImportance !== null && entry.importance < minImportance) continue;

                if (tags) {
                    const entryTagsLower = entry.tags.map((tag) => tag.toLowerCase());
                    const hasAll = tags.every((tag) => entryTagsLower.includes(tag));
                    if (!hasAll) continue;
                }

                if (query) {
                    const haystack = [
                        key.toLowerCase(),
                        (entry.summary || '').toLowerCase(),
                        ...entry.tags.map((tag) => tag.toLowerCase()),
                    ];
                    if (!haystack.some((field) => field.includes(query))) continue;
                }

                matched.push({ key, entry });
            }

            matched.sort(sortNodeRecords);
            const results = matched.slice(0, limit).map(({ key, entry }) => nodeMetadata(key, entry));
            return { results, total: matched.length };
        },

        exportState,

        importState,

        flush,

        flushSync,

        persistenceStatus,

        safeSummary,
    };
}

module.exports = {
    createMemoryStore,
    safeSummary,
};
