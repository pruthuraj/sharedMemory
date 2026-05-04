// Lazy-loading HuggingFace Transformers embedder with coalesced initialization.

const DEFAULT_EMBED_MODEL = 'onnx-community/all-MiniLM-L6-v2-ONNX';

/**
 * Create a feature-extraction embedder backed by a HuggingFace ONNX model.
 *
 * The underlying pipeline is loaded on the first `embed` call and reused thereafter.
 * Concurrent calls before the pipeline is ready share a single load promise.
 *
 * @param {object} [options]
 * @param {string} [options.modelId] - HuggingFace model ID (default: all-MiniLM-L6-v2-ONNX).
 * @param {object} [options.pipelineOptions] - Passed through to `@huggingface/transformers` pipeline().
 * @returns {{ modelId, embed, status, dispose }}
 */
function createTransformersEmbedder(options = {}) {
    const modelId = options.modelId || DEFAULT_EMBED_MODEL;
    const pipelineOptions = options.pipelineOptions || {};
    let extractor = null;
    let extractorPromise = null;

    async function loadExtractor() {
        if (extractor) return extractor;
        if (!extractorPromise) {
            extractorPromise = import('@huggingface/transformers')
                .then(({ pipeline }) => pipeline('feature-extraction', modelId, pipelineOptions))
                .then((loaded) => {
                    extractor = loaded;
                    return loaded;
                });
        }
        return extractorPromise;
    }

    return {
        modelId,

        // Returns a mean-pooled, L2-normalized float[] embedding for text.
        async embed(text) {
            const loaded = await loadExtractor();
            const output = await loaded(text, { pooling: 'mean', normalize: true });
            return Array.from(output.data);
        },

        // Returns { modelId, loaded } — loaded is false until the first embed() call completes.
        status() {
            return {
                modelId,
                loaded: Boolean(extractor),
            };
        },

        // Releases the underlying ONNX session if the pipeline exposes a dispose method.
        async dispose() {
            if (extractor && typeof extractor.dispose === 'function') {
                await extractor.dispose();
            }
            extractor = null;
            extractorPromise = null;
        },
    };
}

module.exports = {
    DEFAULT_EMBED_MODEL,
    createTransformersEmbedder,
};
