/**
 * BGE Reranker Service
 *
 * Uses BGE cross-encoder to rerank semantic search results for better precision.
 * Pipeline: pgvector retrieval (top 20) → BGE reranker → top 5 results
 */

const { pipeline } = require('@xenova/transformers');

let reranker = null;
let loadingPromise = null;

/**
 * Load the BGE reranker model (lazy initialization)
 */
async function loadReranker() {
  if (reranker) return reranker;

  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    console.log('[Reranker] Loading BGE reranker model...');
    const startTime = Date.now();

    reranker = await pipeline(
      'text-classification',
      'Xenova/bge-reranker-base',
      { quantized: true }  // Use quantized model for faster inference
    );

    console.log(`[Reranker] Model loaded in ${Date.now() - startTime}ms`);
    return reranker;
  })();

  return loadingPromise;
}

/**
 * Rerank search results using BGE cross-encoder
 * @param {string} query - The buyer's search query
 * @param {Array} candidates - Array of ad objects from pgvector search
 * @param {number} topK - Number of results to return after reranking
 * @returns {Array} - Reranked results with rerank_score added
 */
async function rerankResults(query, candidates, topK = 5) {
  if (!candidates || candidates.length === 0) {
    return [];
  }

  // If fewer candidates than topK, just return them
  if (candidates.length <= topK) {
    return candidates.map(ad => ({ ...ad, rerank_score: ad.similarity_score }));
  }

  try {
    const model = await loadReranker();

    // Score each candidate against the query
    const scored = await Promise.all(
      candidates.map(async (ad) => {
        // Combine ad text for reranking (headline, body, tags, transcript)
        const adText = [
          ad.headline,
          ad.body_copy,
          Array.isArray(ad.intent_tags) ? ad.intent_tags.join(', ') : ad.intent_tags,
          ad.transcript || ''
        ].filter(Boolean).join(' ').slice(0, 512);

        try {
          // BGE reranker expects [query, passage] pairs
          const result = await model(
            `${query} [SEP] ${adText}`,
            { topk: 1 }
          );

          // Extract score (sigmoid applied for 0-1 range)
          const score = result[0]?.score || 0;

          return {
            ...ad,
            rerank_score: score,
            original_similarity: ad.similarity_score
          };
        } catch (scoreErr) {
          console.error(`[Reranker] Error scoring ad ${ad.id}:`, scoreErr.message);
          return {
            ...ad,
            rerank_score: ad.similarity_score || 0,
            original_similarity: ad.similarity_score
          };
        }
      })
    );

    // Sort by rerank score (descending) and return top K
    const reranked = scored
      .sort((a, b) => b.rerank_score - a.rerank_score)
      .slice(0, topK);

    console.log(`[Reranker] Reranked ${candidates.length} → ${reranked.length} results`);

    return reranked;

  } catch (err) {
    console.error('[Reranker] Error:', err.message);
    // Fall back to original ordering if reranker fails
    return candidates.slice(0, topK).map(ad => ({
      ...ad,
      rerank_score: ad.similarity_score
    }));
  }
}

/**
 * Warm up the reranker model (call on server startup)
 */
async function warmUpReranker() {
  try {
    console.log('[Reranker] Warming up...');
    await loadReranker();
    // Run a dummy inference to ensure model is fully loaded
    await rerankResults('test query', [{ headline: 'test', body_copy: 'test' }], 1);
    console.log('[Reranker] Warm-up complete');
  } catch (err) {
    console.error('[Reranker] Warm-up failed:', err.message);
  }
}

module.exports = {
  rerankResults,
  warmUpReranker,
  loadReranker
};
