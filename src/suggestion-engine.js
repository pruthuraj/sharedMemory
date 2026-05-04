// Debounced suggestion engine: embeds memory entries on write and ranks them by semantic similarity at query time.

const { DEFAULT_EMBED_MODEL, createTransformersEmbedder } = require('./embedding-adapter');
const {
    cosineSimilarity,
    hasAllTags,
    isActiveMemory,
    scoreMemory,
    withDefaults,
} = require('./suggestion-ranking');
const { createLinearVectorIndex } = require('./vector-index');

const DEFAULT_SUGGEST_LIMIT = 5;
const DEFAULT_QUEUE_DEBOUNCE_MS = 500;

function isDisabledByEnv() {
    return String(process.env.MEMORY_SUGGEST_ENABLED || '').toLowerCase() === 'false';
}

// Coerce a raw memory entry into a canonical shape with safe defaults for all fields.
function normalizeMetadata(key, metadata = {}, now = Date.now()) {
    return {
        key,
        summary: typeof metadata.summary === 'string' ? metadata.summary : '',
        tags: Array.isArray(metadata.tags) ? metadata.tags.slice() : [],
        importance: Number.isInteger(metadata.importance) ? metadata.importance : 0,
        expiresAt: typeof metadata.expiresAt === 'number' && Number.isFinite(metadata.expiresAt)
            ? metadata.expiresAt
            : null,
        updatedAt: typeof metadata.updatedAt === 'number' && Number.isFinite(metadata.updatedAt)
            ? metadata.updatedAt
            : now,
        updatedBy: metadata.updatedBy ?? null,
    };
}

// Build the plain-text string that gets embedded for a memory entry: "key summary tag1 tag2 …".
function memoryText(memory) {
    return [
        memory.key,
        memory.summary,
        ...memory.tags,
    ].filter(Boolean).join(' ');
}

function normalizeVector(vector) {
    if (!Array.isArray(vector) && !ArrayBuffer.isView(vector)) return [];
    return Array.from(vector).map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0));
}

async function embedText(embedder, text) {
    if (typeof embedder === 'function') {
        return normalizeVector(await embedder(text));
    }
    return normalizeVector(await embedder.embed(text));
}

/**
 * Create a suggestion engine that maintains an embedding index of active memory entries.
 *
 * Writes are queued and flushed after a debounce window so burst writes don't trigger
 * redundant embedding calls. Inactive or expired memories are evicted from the index on flush.
 *
 * @param {object} [options]
 * @param {boolean} [options.enabled] - Explicitly enable/disable; defaults to !MEMORY_SUGGEST_ENABLED=false env var.
 * @param {string} [options.modelId] - Embedding model ID; falls back to MEMORY_EMBED_MODEL env var.
 * @param {object} [options.embedder] - Pre-built embedder instance (for testing).
 * @param {object} [options.index] - Pre-built vector index instance (for testing).
 * @param {number} [options.debounceMs=500] - Queue flush debounce window in milliseconds.
 * @param {number} [options.defaultLimit=5] - Default number of suggestions returned by suggest().
 * @param {object} [options.ranking] - Ranking config overrides; see DEFAULT_RANKING_CONFIG.
 * @param {object} [options.scheduler] - Injectable {setTimeout, clearTimeout} for testing.
 * @param {Function} [options.clock] - Clock function returning ms since epoch.
 * @param {object} [options.logger] - Logger with .error() method (default: console).
 */
function createSuggestionEngine(options = {}) {
    const now = options.clock || options.now || Date.now;
    const enabled = Object.prototype.hasOwnProperty.call(options, 'enabled')
        ? options.enabled !== false
        : !isDisabledByEnv();
    const modelId = options.modelId || process.env.MEMORY_EMBED_MODEL || DEFAULT_EMBED_MODEL;
    const embedder = options.embedder || createTransformersEmbedder({
        modelId,
        pipelineOptions: options.pipelineOptions,
    });
    const index = options.index || createLinearVectorIndex();
    const scheduler = options.scheduler || {
        setTimeout,
        clearTimeout,
    };
    const logger = options.logger || console;
    const rankingConfig = withDefaults(options.ranking || options.config || {});
    const debounceMs = options.debounceMs ?? DEFAULT_QUEUE_DEBOUNCE_MS;
    const defaultLimit = options.defaultLimit ?? DEFAULT_SUGGEST_LIMIT;
    const pendingUpdates = new Map();
    let queueTimer = null;
    let processing = false;
    let drainPromise = null;
    let lastIndexedAt = null;
    let lastIndexError = null;

    function clearQueueTimer() {
        if (!queueTimer) return;
        scheduler.clearTimeout(queueTimer);
        queueTimer = null;
    }

    function scheduleQueue() {
        if (!enabled || queueTimer || processing || pendingUpdates.size === 0) return;
        queueTimer = scheduler.setTimeout(() => {
            queueTimer = null;
            return flushQueue();
        }, debounceMs);

        if (queueTimer && typeof queueTimer.unref === 'function') {
            queueTimer.unref();
        }
    }

    async function processUpdate(update) {
        if (update.action === 'remove') {
            index.remove(update.key);
            lastIndexedAt = now();
            return;
        }

        const memory = update.memory;
        if (!isActiveMemory(memory, now(), rankingConfig)) {
            index.remove(update.key);
            lastIndexedAt = now();
            return;
        }

        const vector = await embedText(embedder, memoryText(memory));
        index.upsert({
            ...memory,
            vector,
            indexedAt: now(),
        });
        lastIndexedAt = now();
    }

    async function flushQueue() {
        if (!enabled) return false;
        clearQueueTimer();
        if (processing) return drainPromise;

        processing = true;
        drainPromise = (async () => {
            let changed = false;
            while (pendingUpdates.size > 0) {
                const [key, update] = pendingUpdates.entries().next().value;
                pendingUpdates.delete(key);

                try {
                    await processUpdate(update);
                    changed = true;
                    lastIndexError = null;
                } catch (error) {
                    lastIndexError = error.message;
                    if (logger && typeof logger.error === 'function') {
                        logger.error(`Failed to update suggestion index for ${key}: ${error.message}`);
                    }
                }
            }
            return changed;
        })().finally(() => {
            processing = false;
            drainPromise = null;
            scheduleQueue();
        });

        return drainPromise;
    }

    return {
        // Enqueue an upsert for key; the embedding is computed asynchronously after the debounce window.
        async upsertMemory(key, metadata) {
            if (!enabled) return false;
            pendingUpdates.set(key, {
                action: 'upsert',
                key,
                memory: normalizeMetadata(key, metadata, now()),
            });
            scheduleQueue();
            return true;
        },

        // Enqueue a removal tombstone for key; processed in queue order so it overrides a pending upsert.
        async removeMemory(key) {
            if (!enabled) return false;
            pendingUpdates.set(key, {
                action: 'remove',
                key,
            });
            scheduleQueue();
            return true;
        },

        /**
         * Return ranked suggestions for a context string.
         *
         * Embeds context, scores every active indexed entry by cosine similarity × time decay +
         * importance/recency bonuses, then returns the top-limit results sorted by score descending.
         *
         * @param {{ context: string, tags?: string[], limit?: number, agentId?: string }} options
         * @returns {Promise<Array<{ key, summary, tags, importance, score, reasons }>>}
         */
        async suggest(options = {}) {
            if (!enabled) return [];

            const contextVector = await embedText(embedder, options.context);
            const requiredTags = Array.isArray(options.tags) ? options.tags : [];
            const limit = Number.isInteger(options.limit) ? options.limit : defaultLimit;
            const timestamp = now();
            const scored = [];

            for (const record of index.values()) {
                if (!isActiveMemory(record, timestamp, rankingConfig)) continue;
                if (!hasAllTags(record, requiredTags)) continue;

                const similarity = cosineSimilarity(contextVector, record.vector);
                if (similarity <= 0) continue;

                const ranked = scoreMemory({
                    similarity,
                    memory: record,
                    now: timestamp,
                    config: rankingConfig,
                });

                scored.push({
                    key: record.key,
                    summary: record.summary,
                    tags: record.tags.slice(),
                    importance: record.importance,
                    score: Number(ranked.score.toFixed(6)),
                    reasons: ranked.reasons,
                    updatedAt: record.updatedAt,
                });
            }

            scored.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                if (b.importance !== a.importance) return b.importance - a.importance;
                if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
                return a.key.localeCompare(b.key);
            });

            return scored.slice(0, limit).map(({ updatedAt, ...suggestion }) => suggestion);
        },

        // Drain the pending-update queue immediately. Returns true if any entries were processed.
        flushQueue,

        // Returns engine state snapshot for /status: enabled, modelId, counts, timing, last error.
        status() {
            const embedderStatus = typeof embedder.status === 'function' ? embedder.status() : {};
            return {
                enabled,
                modelId: embedderStatus.modelId || modelId || embedder.modelId || null,
                activeIndexedCount: index.size(),
                queuedUpdateCount: pendingUpdates.size,
                processing,
                lastIndexedAt,
                lastIndexError,
            };
        },

        // Cancel the queue timer, discard pending updates, and dispose the embedder.
        async close() {
            clearQueueTimer();
            pendingUpdates.clear();
            if (embedder && typeof embedder.dispose === 'function') {
                await embedder.dispose();
            }
        },
    };
}

module.exports = {
    DEFAULT_QUEUE_DEBOUNCE_MS,
    DEFAULT_SUGGEST_LIMIT,
    createSuggestionEngine,
    memoryText,
    normalizeMetadata,
};
