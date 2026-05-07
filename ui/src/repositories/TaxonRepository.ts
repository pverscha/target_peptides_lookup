import type { TaxonSuggestion } from '@/types'
import type { UnipeptService } from '@/services/UnipeptService'

/**
 * Provides access to taxon and organism data via the Unipept API.
 *
 * This repository is the single point of contact for all taxon-related
 * queries in the pipeline. It abstracts the Unipept API from the rest of
 * the application, so callers work with domain concepts (taxa, descendants,
 * LCA lineages) rather than HTTP details.
 */
export class TaxonRepository {
  constructor(private readonly unipept: UnipeptService) {}

  /**
   * Checks which of the given NCBI taxon IDs are known to Unipept.
   *
   * IDs are validated in batches against the Unipept taxonomy endpoint.
   * Any ID not present in the Unipept database is returned in `invalid`;
   * the rest are returned in `valid` and can safely be used in downstream
   * pipeline steps.
   *
   * @param taxaIds - NCBI taxon IDs to validate.
   * @param signal - Abort signal; rejects the returned promise on abort.
   * @param onProgress - Optional callback invoked after each batch with
   *   the number of batches completed and the total batch count.
   */
  validate(
    taxaIds: number[],
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ valid: number[]; invalid: number[] }> {
    return this.unipept.validateTaxa(taxaIds, signal, onProgress)
  }

  /**
   * Retrieves all species-level descendants for the given taxon IDs.
   *
   * For each input taxon, Unipept returns the NCBI taxon IDs of all
   * species that fall under it in the taxonomic hierarchy. The result is
   * the union of descendants across all input taxa, deduplicated. Input
   * taxa that have no species-level descendants produce a warning entry.
   *
   * @param taxaIds - NCBI taxon IDs whose descendants should be fetched.
   * @param signal - Abort signal; rejects the returned promise on abort.
   * @param onProgress - Optional callback invoked after each batch with
   *   the number of batches completed and the total batch count.
   */
  getDescendants(
    taxaIds: number[],
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ descendants: number[]; warnings: string[] }> {
    return this.unipept.collectDescendants(taxaIds, signal, onProgress)
  }

  /**
   * Looks up the lowest common ancestor (LCA) lineage for each peptide.
   *
   * For every peptide, Unipept returns the LCA taxon together with its
   * full NCBI lineage (all taxonomic ranks from domain down to forma).
   * The result maps each peptide to the set of all taxon IDs that appear
   * anywhere in its LCA lineage, including the LCA taxon itself. Peptides
   * not found in Unipept are absent from the returned map.
   *
   * @param peptides - Tryptic peptide sequences to look up.
   * @param signal - Abort signal; rejects the returned promise on abort.
   * @param onProgress - Optional callback invoked after each batch with
   *   the number of batches completed and the total batch count.
   */
  getLcas(
    peptides: string[],
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Map<string, Set<number>>> {
    return this.unipept.lookupLcas(peptides, signal, onProgress)
  }

  /**
   * Fetches one page of taxa matching a text query against Unipept.
   *
   * The filter string is matched against taxon name, NCBI ID, and rank
   * simultaneously. Results are ordered by the specified column. Use
   * `count()` to determine the total number of matching taxa for pagination.
   *
   * @param query - Text to filter by.
   * @param start - Zero-based start index of the requested page (inclusive).
   * @param end - Zero-based end index of the requested page (exclusive).
   * @param sortBy - Column to sort by.
   * @param sortDesc - Sort in descending order when true.
   * @param signal - Abort signal; rejects the returned promise on abort.
   */
  search(
    query: string,
    start: number,
    end: number,
    sortBy: 'id' | 'name' | 'rank',
    sortDesc: boolean,
    signal: AbortSignal,
  ): Promise<TaxonSuggestion[]> {
    return this.unipept.searchTaxa(query, start, end, sortBy, sortDesc, signal)
  }

  /**
   * Returns the total number of taxa matching a text query.
   *
   * Intended to be paired with `search()` to configure server-side
   * pagination: call both in parallel, use this result as `items-length`
   * in the data table.
   *
   * @param query - Text to filter by.
   * @param signal - Abort signal; rejects the returned promise on abort.
   */
  count(query: string, signal: AbortSignal): Promise<number> {
    return this.unipept.countTaxa(query, signal)
  }

  /**
   * Resolves NCBI taxon IDs to their display data (name and rank).
   *
   * IDs not found in Unipept are absent from the result. Used to convert
   * a list of file-imported IDs into displayable taxa without a text search.
   *
   * @param ids - NCBI taxon IDs to resolve.
   * @param signal - Abort signal; rejects the returned promise on abort.
   */
  fetchById(ids: number[], signal: AbortSignal): Promise<TaxonSuggestion[]> {
    return this.unipept.fetchTaxaById(ids, signal)
  }
}
