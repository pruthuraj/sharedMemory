const DEFAULT_IMPORTANCE = 0;
const DEFAULT_MAP_DEPTH = 1;
const DEFAULT_MAP_LIMIT = 10;
const FALLBACK_SUMMARY_LIMIT = 120;

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

function createMemoryStore(options = {}) {
    const now = options.now || Date.now;
    const entries = new Map();
    const edges = new Map();

    function incidentEdges(key) {
        return Array.from(edges.values()).filter((edge) => edge.from === key || edge.to === key);
    }

    function sortedIncidentEdges(key) {
        return incidentEdges(key)
            .filter((edge) => entries.has(edge.from) && entries.has(edge.to))
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
        if (!entries.has(key)) {
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
                if (!entries.has(nextKey) || visited.has(nextKey)) continue;

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
            .filter((edge) => edge && selectedKeySet.has(edge.from) && selectedKeySet.has(edge.to))
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

    return {
        set(key, value, updatedBy, metadata = {}) {
            const entry = {
                value,
                summary: metadata.summary || safeSummary(value),
                tags: normalizeTags(metadata.tags),
                importance: metadata.importance ?? DEFAULT_IMPORTANCE,
                updatedAt: now(),
                updatedBy,
            };
            entries.set(key, entry);
            return entry;
        },

        get(key) {
            return entries.has(key) ? entries.get(key) : null;
        },

        delete(key) {
            const removed = entries.delete(key);
            const removedEdges = [];

            for (const [id, edge] of edges.entries()) {
                if (edge.from === key || edge.to === key) {
                    removedEdges.push(edge);
                    edges.delete(id);
                }
            }

            return { removed, removedEdges };
        },

        keys() {
            return Array.from(entries.keys());
        },

        count() {
            return entries.size;
        },

        relationCount() {
            return edges.size;
        },

        relate(from, to, relation, updatedBy, metadata = {}) {
            if (from === to) {
                return { ok: false, error: 'self-relation-not-allowed' };
            }

            if (!entries.has(from) || !entries.has(to)) {
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
            edges.delete(id);
            return edge;
        },

        map,

        safeSummary,
    };
}

module.exports = {
    createMemoryStore,
    safeSummary,
};
