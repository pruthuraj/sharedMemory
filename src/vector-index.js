// In-memory key/vector store with O(n) linear scan; suitable for small-to-medium corpora.

/**
 * Create an in-memory vector index keyed by string.
 *
 * Records are plain objects with at minimum `{ key, vector, tags }`. All other fields
 * are stored as-is. `vector` and `tags` are shallow-copied on write and read to prevent
 * external mutation from affecting stored state.
 *
 * @returns {{ upsert, remove, get, values, size, clear }}
 */
function createLinearVectorIndex() {
    const records = new Map();

    return {
        // Insert or replace the record at record.key.
        upsert(record) {
            records.set(record.key, {
                ...record,
                tags: Array.isArray(record.tags) ? record.tags.slice() : [],
                vector: Array.isArray(record.vector) ? record.vector.slice() : [],
            });
        },

        remove(key) {
            return records.delete(key);
        },

        get(key) {
            return records.get(key) || null;
        },

        // Returns a snapshot of all records with defensive copies of vector and tags.
        values() {
            return Array.from(records.values()).map((record) => ({
                ...record,
                tags: record.tags.slice(),
                vector: record.vector.slice(),
            }));
        },

        size() {
            return records.size;
        },

        clear() {
            records.clear();
        },
    };
}

module.exports = {
    createLinearVectorIndex,
};
