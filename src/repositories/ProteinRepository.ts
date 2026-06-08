import type { OpensearchService } from '@/services/OpensearchService'

/**
 * Provides access to protein data stored in the OpenSearch index.
 *
 * This repository is the single point of contact for all protein-related
 * queries in the pipeline. It abstracts the OpenSearch REST API from the
 * rest of the application, so callers work with domain concepts (protein
 * counts per taxon, protein sequences) rather than scroll contexts,
 * aggregation queries, or HTTP details.
 */
export class ProteinRepository {
  constructor(private readonly opensearch: OpensearchService) {}

  /**
   * Returns the number of proteins stored in OpenSearch for each taxon.
   *
   * Taxon IDs are queried in large chunks using OpenSearch term aggregations.
   * Taxon IDs that have no matching documents are absent from the returned
   * record (not present with a count of zero).
   *
   * @param taxonIds - NCBI taxon IDs to count proteins for.
   * @param signal - Abort signal; rejects the returned promise on abort.
   * @param onProgress - Optional callback invoked after each chunk with
   *   the number of chunks completed and the total chunk count.
   */
  countByTaxon(
    taxonIds: number[],
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Record<number, number>> {
    return this.opensearch.countProteinsByTaxon(taxonIds, signal, onProgress)
  }

  /**
   * Streams protein sequences for a single taxon from OpenSearch.
   *
   * Sequences are retrieved page by page using the OpenSearch scroll API
   * and yielded one at a time, keeping memory usage bounded regardless of
   * how many proteins the taxon has. The scroll context is cleaned up
   * automatically when the generator is exhausted or when iteration is
   * interrupted (e.g. by an abort or an early `break`).
   *
   * @param taxonId - NCBI taxon ID whose protein sequences to stream.
   * @param signal - Abort signal; stops iteration and triggers scroll cleanup.
   */
  streamSequences(
    taxonId: number,
    signal: AbortSignal,
  ): AsyncGenerator<string, void, undefined> {
    return this.opensearch.streamProteins(taxonId, signal)
  }
}
