// Scoring and filtering helpers for ranking memory entries by semantic relevance, recency, and importance.

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STALE_AFTER_MS = 30 * DAY_MS;

// decayLambda: exponential half-life ≈ 35 days. importanceWeight and recencyBoost are additive
// score bonuses applied on top of the similarity×decay base score.
const DEFAULT_RANKING_CONFIG = {
    minActiveImportance: 4,    // importance floor for a memory to stay in the active index
    staleAfterMs: DEFAULT_STALE_AFTER_MS, // time after which low-importance memories are archived
    decayLambda: 0.02,         // exponential decay rate (per day)
    importanceWeight: 0.01,    // score bonus per importance point
    recencyBoost: 0.03,        // flat bonus for memories updated within recentAfterMs
    highImportanceThreshold: 7,
    recentAfterMs: 7 * DAY_MS,
};

// Merge caller-supplied ranking config over DEFAULT_RANKING_CONFIG.
function withDefaults(config = {}) {
    return {
        ...DEFAULT_RANKING_CONFIG,
        ...config,
    };
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

// Returns cosine similarity in [0, 1] for normalized vectors; 0 for mismatched or zero-norm inputs.
function cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
        return 0;
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let index = 0; index < a.length; index += 1) {
        const left = isFiniteNumber(a[index]) ? a[index] : 0;
        const right = isFiniteNumber(b[index]) ? b[index] : 0;
        dot += left * right;
        normA += left * left;
        normB += right * right;
    }

    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function ageMs(memory, now) {
    const timestamp = isFiniteNumber(memory.updatedAt) ? memory.updatedAt : now;
    return Math.max(0, now - timestamp);
}

// Exponential decay: exp(-lambda * daysOld). Returns 1 for non-finite timestamps.
function calculateTimeDecay(timestamp, now, lambda = DEFAULT_RANKING_CONFIG.decayLambda) {
    if (!isFiniteNumber(timestamp)) return 1;
    const daysOld = Math.max(0, now - timestamp) / DAY_MS;
    return Math.exp(-lambda * daysOld);
}

function isExpiredMemory(memory, now) {
    return isFiniteNumber(memory.expiresAt) && memory.expiresAt > 0 && memory.expiresAt <= now;
}

// A memory is active if it is not expired AND (importance >= minActiveImportance OR age <= staleAfterMs).
function isActiveMemory(memory, now, config = {}) {
    const ranking = withDefaults(config);
    if (!memory || isExpiredMemory(memory, now)) return false;

    const importance = Number.isInteger(memory.importance) ? memory.importance : 0;
    const isImportant = importance >= ranking.minActiveImportance;
    const isRecent = ageMs(memory, now) <= ranking.staleAfterMs;
    return isImportant || isRecent;
}

function normalizeTags(tags = []) {
    if (!Array.isArray(tags)) return [];
    return tags
        .map((tag) => (typeof tag === 'string' ? tag.trim().toLowerCase() : ''))
        .filter(Boolean);
}

function hasAllTags(memory, requiredTags = []) {
    const wanted = normalizeTags(requiredTags);
    if (wanted.length === 0) return true;

    const existing = new Set(normalizeTags(memory.tags));
    return wanted.every((tag) => existing.has(tag));
}

/**
 * Compute a composite relevance score for a memory entry.
 *
 * score = (similarity × timeDecay) + (importance × importanceWeight) + recencyBoost
 *
 * @param {{ similarity: number, memory: object, now: number, config?: object }} params
 * @returns {{ score: number, reasons: string[] }} reasons lists which bonuses fired.
 */
function scoreMemory({ similarity, memory, now, config = {} }) {
    const ranking = withDefaults(config);
    const importance = Number.isInteger(memory.importance) ? memory.importance : 0;
    const decay = calculateTimeDecay(memory.updatedAt, now, ranking.decayLambda);
    const recent = ageMs(memory, now) <= ranking.recentAfterMs;
    const highImportance = importance >= ranking.highImportanceThreshold;
    const importanceBoost = importance * ranking.importanceWeight;
    const recencyBoost = recent ? ranking.recencyBoost : 0;
    const score = (similarity * decay) + importanceBoost + recencyBoost;
    const reasons = [];

    if (similarity > 0) reasons.push('semantic-match');
    if (highImportance) reasons.push('high-importance');
    if (recent) reasons.push('recent');

    return {
        score,
        reasons,
    };
}

module.exports = {
    DAY_MS,
    DEFAULT_RANKING_CONFIG,
    calculateTimeDecay,
    cosineSimilarity,
    hasAllTags,
    isActiveMemory,
    isExpiredMemory,
    scoreMemory,
    withDefaults,
};
