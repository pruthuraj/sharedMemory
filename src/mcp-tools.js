// Shared MCP tool handlers kept transport-independent for deterministic tests.

const { RELATION_TYPES } = require('./protocol.js');

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function isIntegerInRange(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
}

function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
}

function hasValidTags(tags) {
    return Array.isArray(tags) && tags.every(isNonEmptyString);
}

// Coerce helpers — handle type mismatches from MCP JSON-RPC transport
function coerceArray(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') {
        try { const p = JSON.parse(v); if (Array.isArray(p)) return p; } catch {}
    }
    return v;
}

function coerceInt(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { const n = Math.round(Number(v)); if (Number.isFinite(n)) return n; }
    return v;
}

function coerceFloat(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { const n = Number(v); if (Number.isFinite(n)) return n; }
    return v;
}

function normalizeSetInput(input) {
    const o = { ...input };
    if (hasOwn(o, 'tags'))       o.tags       = coerceArray(o.tags);
    if (hasOwn(o, 'importance')) o.importance = coerceInt(o.importance);
    if (hasOwn(o, 'ttlMs'))      o.ttlMs      = coerceInt(o.ttlMs);
    if (hasOwn(o, 'expiresAt'))  o.expiresAt  = coerceInt(o.expiresAt);
    if (hasOwn(o, 'ifRevision')) o.ifRevision = coerceInt(o.ifRevision);
    return o;
}

function normalizeSearchInput(input) {
    const o = { ...input };
    if (hasOwn(o, 'tags'))          o.tags          = coerceArray(o.tags);
    if (hasOwn(o, 'minImportance')) o.minImportance = coerceInt(o.minImportance);
    if (hasOwn(o, 'limit'))         o.limit         = coerceInt(o.limit);
    return o;
}

function normalizeSuggestInput(input) {
    const o = { ...input };
    if (hasOwn(o, 'tags'))  o.tags  = coerceArray(o.tags);
    if (hasOwn(o, 'limit')) o.limit = coerceInt(o.limit);
    return o;
}

function normalizeMapInput(input) {
    const o = { ...input };
    if (hasOwn(o, 'depth')) o.depth = coerceInt(o.depth);
    if (hasOwn(o, 'limit')) o.limit = coerceInt(o.limit);
    return o;
}

function normalizeRelateInput(input) {
    const o = { ...input };
    if (hasOwn(o, 'weight')) o.weight = coerceFloat(o.weight);
    return o;
}

function metadataOnly(entry) {
    if (!entry) return null;
    return {
        summary: entry.summary,
        tags: Array.isArray(entry.tags) ? entry.tags.slice() : [],
        importance: entry.importance,
        revision: entry.revision,
        expiresAt: entry.expiresAt ?? null,
        updatedAt: entry.updatedAt,
        updatedBy: entry.updatedBy,
    };
}

function ok(payload = {}) {
    return { ok: true, ...payload };
}

function fail(error, details = {}) {
    return { ok: false, error, ...details };
}

function validateKey(input) {
    return isNonEmptyString(input.key) ? null : 'missing-key';
}

function validateSetInput(input) {
    const keyError = validateKey(input);
    if (keyError) return keyError;
    if (!hasOwn(input, 'value')) return 'missing-value';
    if (hasOwn(input, 'ttlMs') && hasOwn(input, 'expiresAt')) return 'invalid-expiry';
    if (hasOwn(input, 'ttlMs') && !isPositiveInteger(input.ttlMs)) return 'invalid-expiry';
    if (hasOwn(input, 'expiresAt') && !isPositiveInteger(input.expiresAt)) return 'invalid-expiry';
    if (hasOwn(input, 'summary') && !isNonEmptyString(input.summary)) return 'invalid-summary';
    if (hasOwn(input, 'tags') && !hasValidTags(input.tags)) return 'invalid-tags';
    if (hasOwn(input, 'importance') && !isIntegerInRange(input.importance, 0, 10)) return 'invalid-importance';
    if (
        hasOwn(input, 'ifRevision')
        && input.ifRevision !== null
        && !isPositiveInteger(input.ifRevision)
    ) {
        return 'invalid-ifRevision';
    }
    return null;
}

function validateSearchInput(input) {
    if (hasOwn(input, 'query') && !isNonEmptyString(input.query)) return 'invalid-query';
    if (hasOwn(input, 'tags') && !hasValidTags(input.tags)) return 'invalid-tags';
    if (hasOwn(input, 'minImportance') && !isIntegerInRange(input.minImportance, 0, 10)) {
        return 'invalid-importance';
    }
    if (hasOwn(input, 'limit') && !isIntegerInRange(input.limit, 1, 100)) return 'invalid-limit';

    const hasQuery = hasOwn(input, 'query');
    const hasTags = hasOwn(input, 'tags') && input.tags.length > 0;
    const hasMinImportance = hasOwn(input, 'minImportance');
    return hasQuery || hasTags || hasMinImportance ? null : 'missing-filter';
}

function validateSuggestInput(input) {
    if (!isNonEmptyString(input.context)) return hasOwn(input, 'context') ? 'invalid-context' : 'missing-context';
    if (hasOwn(input, 'tags') && !hasValidTags(input.tags)) return 'invalid-tags';
    if (hasOwn(input, 'limit') && !isIntegerInRange(input.limit, 1, 20)) return 'invalid-limit';
    return null;
}

function validateMapInput(input) {
    const keyError = validateKey(input);
    if (keyError) return keyError;
    if (hasOwn(input, 'depth') && !isIntegerInRange(input.depth, 0, 10)) return 'invalid-depth';
    if (hasOwn(input, 'limit') && !isIntegerInRange(input.limit, 1, 100)) return 'invalid-limit';
    return null;
}

function validateRelateInput(input) {
    if (!isNonEmptyString(input.from)) return 'missing-from';
    if (!isNonEmptyString(input.to)) return 'missing-to';
    if (!isNonEmptyString(input.relation) || !RELATION_TYPES.has(input.relation)) {
        return 'invalid-relation';
    }
    if (hasOwn(input, 'reason') && !isNonEmptyString(input.reason)) return 'invalid-reason';
    if (hasOwn(input, 'weight') && !(typeof input.weight === 'number' && Number.isFinite(input.weight))) {
        return 'invalid-weight';
    }
    return null;
}

function validateUnrelateInput(input) {
    if (!isNonEmptyString(input.from)) return 'missing-from';
    if (!isNonEmptyString(input.to)) return 'missing-to';
    if (!isNonEmptyString(input.relation) || !RELATION_TYPES.has(input.relation)) {
        return 'invalid-relation';
    }
    return null;
}

function validateSnapshotInput(input) {
    return hasOwn(input, 'snapshot') ? null : 'missing-snapshot';
}

function validateImportMode(input) {
    if (!hasOwn(input, 'mode')) return null;
    return input.mode === 'replace' || input.mode === 'merge' ? null : 'invalid-mode';
}

function statsForSnapshot(snapshot) {
    return {
        entryCount: Object.keys(snapshot.entries).length,
        edgeCount: snapshot.edges.length,
    };
}

async function refreshSuggestionIndex(memory, suggestionEngine) {
    if (!suggestionEngine || typeof suggestionEngine.status !== 'function') return;
    if (suggestionEngine.status().enabled !== true) return;
    if (typeof suggestionEngine.upsertMemory !== 'function') return;

    for (const key of memory.keys()) {
        const entry = memory.get(key);
        if (entry) {
            await suggestionEngine.upsertMemory(key, entry);
        }
    }

    if (typeof suggestionEngine.flushQueue === 'function') {
        await suggestionEngine.flushQueue();
    }
}

async function refreshSuggestionIndexAfterImport(memory, suggestionEngine, previousKeys) {
    if (!suggestionEngine || typeof suggestionEngine.status !== 'function') return;
    if (suggestionEngine.status().enabled !== true) return;

    const visibleKeys = new Set(memory.keys());
    if (typeof suggestionEngine.removeMemory === 'function') {
        for (const key of previousKeys) {
            if (!visibleKeys.has(key)) {
                await suggestionEngine.removeMemory(key);
            }
        }
    }

    await refreshSuggestionIndex(memory, suggestionEngine);
}

async function refreshSuggestionIndexAfterMerge(memory, suggestionEngine, previousKeys) {
    if (!suggestionEngine || typeof suggestionEngine.status !== 'function') return;
    if (suggestionEngine.status().enabled !== true) return;

    const visibleKeys = new Set(memory.keys());
    if (typeof suggestionEngine.upsertMemory !== 'function') return;

    for (const key of visibleKeys) {
        if (previousKeys.has(key)) continue;
        const entry = memory.get(key);
        if (entry) {
            await suggestionEngine.upsertMemory(key, entry);
        }
    }

    if (typeof suggestionEngine.flushQueue === 'function') {
        await suggestionEngine.flushQueue();
    }
}

function createSharedMemoryToolHandlers(options) {
    const memory = options.memory;
    const suggestionEngine = options.suggestionEngine;
    const updatedBy = options.updatedBy || 'mcp';

    return {
        async memory_set(input = {}) {
            input = normalizeSetInput(input);
            const error = validateSetInput(input);
            if (error) return fail(error);

            const metadata = {
                summary: input.summary,
                tags: input.tags,
                importance: input.importance,
                ttlMs: input.ttlMs,
                expiresAt: input.expiresAt,
            };
            if (hasOwn(input, 'ifRevision')) metadata.ifRevision = input.ifRevision;

            const entry = memory.set(input.key, input.value, updatedBy, metadata);
            if (entry && entry.ok === false) {
                return fail(entry.error, {
                    key: entry.key,
                    currentRevision: entry.currentRevision,
                });
            }

            if (suggestionEngine && typeof suggestionEngine.upsertMemory === 'function') {
                await suggestionEngine.upsertMemory(input.key, entry);
            }

            return ok({ key: input.key, entry: metadataOnly(entry) });
        },

        async memory_get(input = {}) {
            const error = validateKey(input);
            if (error) return fail(error);
            return ok({ key: input.key, entry: memory.get(input.key) });
        },

        async memory_search(input = {}) {
            input = normalizeSearchInput(input);
            const error = validateSearchInput(input);
            if (error) return fail(error);
            const { results, total } = memory.search({
                query: input.query,
                tags: input.tags,
                minImportance: input.minImportance,
                limit: input.limit,
            });
            return ok({ results, total });
        },

        async memory_suggest(input = {}) {
            input = normalizeSuggestInput(input);
            const error = validateSuggestInput(input);
            if (error) return fail(error);

            if (!suggestionEngine || typeof suggestionEngine.status !== 'function') {
                return ok({ enabled: false, suggestions: [] });
            }

            const status = suggestionEngine.status();
            if (status.enabled !== true) {
                return ok({ enabled: false, suggestions: [] });
            }

            await refreshSuggestionIndex(memory, suggestionEngine);
            const suggestions = await suggestionEngine.suggest({
                context: input.context,
                tags: input.tags,
                limit: input.limit,
                agentId: updatedBy,
            });
            return ok({ enabled: true, suggestions });
        },

        async memory_map(input = {}) {
            input = normalizeMapInput(input);
            const error = validateMapInput(input);
            if (error) return fail(error);
            const graph = memory.map(input.key, {
                depth: input.depth,
                limit: input.limit,
            });
            return graph ? ok(graph) : fail('missing-node');
        },

        async memory_relate(input = {}) {
            input = normalizeRelateInput(input);
            const error = validateRelateInput(input);
            if (error) return fail(error);

            const result = memory.relate(input.from, input.to, input.relation, updatedBy, {
                reason: input.reason,
                weight: input.weight,
            });
            if (!result.ok) return fail(result.error);
            return ok({ action: result.action, edge: result.edge });
        },

        async memory_unrelate(input = {}) {
            const error = validateUnrelateInput(input);
            if (error) return fail(error);

            const result = memory.unrelate(input.from, input.to, input.relation);
            return ok({ removed: Boolean(result.removed), edge: result.edge });
        },

        async memory_export() {
            const snapshot = memory.exportState();
            return ok({ snapshot, stats: statsForSnapshot(snapshot) });
        },

        async memory_validate_import(input = {}) {
            const error = validateSnapshotInput(input);
            if (error) return fail(error);
            const modeError = validateImportMode(input);
            if (modeError) return fail(modeError);
            const mode = input.mode === 'merge' ? 'merge' : 'replace';
            const state = mode === 'merge' ? memory.exportState() : null;
            const result = memory.validateSnapshot(input.snapshot, mode === 'merge' ? {
                mode,
                existingKeys: new Set(Object.keys(state.entries)),
                existingEdgeIds: new Set(state.edges.map((edge) => `${edge.from}\u001f${edge.relation}\u001f${edge.to}`)),
            } : {});
            if (!result.ok) {
                return {
                    ok: false,
                    error: 'invalid-snapshot',
                    errors: result.errors,
                    stats: result.stats,
                    ...(mode === 'merge' ? { mode } : {}),
                };
            }
            return ok({ errors: [], stats: result.stats, ...(mode === 'merge' ? { mode } : {}) });
        },

        async memory_import(input = {}) {
            const error = validateSnapshotInput(input);
            if (error) return fail(error);
            const modeError = validateImportMode(input);
            if (modeError) return fail(modeError);
            const mode = input.mode === 'merge' ? 'merge' : 'replace';
            const previousKeys = new Set(Object.keys(memory.exportState().entries));
            const result = memory.importSnapshot(input.snapshot, { mode });
            if (!result.ok) {
                return {
                    ok: false,
                    error: 'invalid-snapshot',
                    errors: result.errors,
                    ...(mode === 'merge' ? { mode } : {}),
                };
            }

            if (mode === 'merge') {
                await refreshSuggestionIndexAfterMerge(memory, suggestionEngine, previousKeys);
            } else {
                await refreshSuggestionIndexAfterImport(memory, suggestionEngine, previousKeys);
            }

            return ok({ ...(mode === 'merge' ? { mode } : {}), stats: result.stats });
        },
    };
}

function mcpToolResult(output) {
    return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
    };
}

module.exports = {
    createSharedMemoryToolHandlers,
    mcpToolResult,
    refreshSuggestionIndex,
    refreshSuggestionIndexAfterImport,
};
