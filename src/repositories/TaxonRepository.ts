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
   * @returns Object with `valid` (recognised IDs), `invalid` (unrecognised IDs),
   *   and `names` (display name keyed by taxon ID) for each valid taxon.
   */
  validate(
    taxaIds: number[],
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ valid: number[]; invalid: number[]; names: Record<number, string> }> {
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
   * @returns Object with `descendants` (deduplicated union of all species-level
   *   descendant IDs), `descendantsPerTaxon` (per-input-taxon descendant lists), and
   *   `taxaWithoutDescendants` (input IDs that had no species-level descendants).
   */
  getDescendants(
    taxaIds: number[],
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ descendants: number[]; descendantsPerTaxon: Record<number, number[]>; taxaWithoutDescendants: number[] }> {
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
   * @returns Object with `lineageByPeptide` (maps each peptide to the set of all
   *   taxon IDs in its LCA lineage) and `lcaByPeptide` (maps each peptide to its
   *   LCA taxon with `id`, `name`, and `rank`). Peptides absent from Unipept are
   *   omitted from both maps.
   */
  getLcas(
    peptides: string[],
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ lineageByPeptide: Map<string, Set<number>>; lcaByPeptide: Map<string, { id: number; name: string; rank: string }> }> {
    return this.unipept.lookupLcas(peptides, signal, onProgress)
  }

  /**
   * Returns the peptides shared across all taxa in `taxonIds`.
   *
   * Each taxon must be at species or strain rank. The server digests each
   * taxon's proteins and returns the set intersection. Batching across
   * multiple calls (and intersecting the results) is mathematically equivalent
   * to a single call with all IDs.
   *
   * @param taxonIds - NCBI taxon IDs at species or strain rank.
   * @param cleavageRegex - Regular expression used to cleave protein sequences
   *   into peptides (e.g. `[KR](?!P)` for trypsin).
   * @param minLength - Minimum peptide length; shorter fragments are discarded.
   * @param signal - Abort signal; rejects the returned promise on abort.
   * @returns Array of tryptic peptide sequences present in every taxon's proteome.
   */
  getSharedPeptides(
    taxonIds: number[],
    cleavageRegex: string,
    minLength: number,
    signal: AbortSignal,
  ): Promise<string[]> {
    return this.unipept.computeSharedPeptides(taxonIds, cleavageRegex, minLength, signal)
  }

  /**
   * Returns the peptides that are globally unique to `taxonId`, and optionally
   * the peptides unique to a parent taxon that contains `taxonId`.
   *
   * The taxon must be at species or strain rank. The implementation calls the
   * count endpoint first, then fans out sequential GET requests over disjoint
   * protein ranges of size UNIQUE_PEPTIDES_BATCH_SIZE. Results are merged by
   * set union (classification is deterministic per peptide across batches).
   *
   * When `parentId` is provided, the response additionally contains
   * `uniqueToParent`: peptides that are not strictly unique to `taxonId` but
   * are unique to the parent taxon `parentId`. This allows computing partial
   * coverage for higher-level taxa: call once per species descendant with the
   * parent taxon ID, then aggregate `uniqueToParent` across all descendants.
   *
   * @param taxonId - NCBI taxon ID at species or strain rank.
   * @param cleavageRegex - Regular expression used to cleave protein sequences
   *   into peptides (e.g. `[KR](?!P)` for trypsin).
   * @param minLength - Minimum peptide length; shorter fragments are discarded.
   * @param signal - Abort signal; rejects the returned promise on abort.
   * @param parentId - Optional NCBI taxon ID of the parent (higher-level) taxon.
   *   When provided, the response also includes `uniqueToParent`.
   * @returns Object with `unique` (peptides globally unique to `taxonId`) and
   *   `uniqueToParent` (peptides unique to `parentId` but not strictly to `taxonId`;
   *   empty array when `parentId` is omitted).
   */
  getUniquePeptides(
    taxonId: number,
    cleavageRegex: string,
    minLength: number,
    signal: AbortSignal,
    parentId?: number,
  ): Promise<{ unique: string[]; uniqueToParent: string[] }> {
    return this.unipept.computeUniquePeptides(taxonId, cleavageRegex, minLength, signal, parentId)
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
   * @returns Array of `TaxonSuggestion` objects for the requested page, ordered
   *   by the specified column.
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
   * @returns Total number of taxa matching `query`.
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
   * @returns Array of `TaxonSuggestion` objects for each recognised ID.
   *   IDs not found in Unipept are omitted.
   */
  fetchById(ids: number[], signal: AbortSignal): Promise<TaxonSuggestion[]> {
    return this.unipept.fetchTaxaById(ids, signal)
  }
}
