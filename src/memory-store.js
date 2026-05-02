function createMemoryStore(options = {}) {
    const now = options.now || Date.now;
    const entries = new Map();

    return {
        set(key, value, updatedBy) {
            const entry = {
                value,
                updatedAt: now(),
                updatedBy,
            };
            entries.set(key, entry);
            return entry;
        },

        get(key) {
            return entries.has(key) ? entries.get(key) : null;
        },

        keys() {
            return Array.from(entries.keys());
        },
    };
}

module.exports = {
    createMemoryStore,
};
