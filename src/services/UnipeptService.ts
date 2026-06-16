import type { UnipeptConfig, TaxonSuggestion } from '@/types'
import {chunked, LINEAGE_ID_FIELDS} from '@/utils/peptides'
import type { PauseController } from '@/utils/PauseController'
import type { RetryController } from '@/utils/RetryController'
import { isAbortError } from '@/utils/abort'
import { RequestPool } from '@/utils/RequestPool'

interface TaxonEntry {
  taxon_id: number
  taxon_name: string
  taxon_rank: string
  descendants?: number[]
}

interface TaxaEntry {
  peptide: string
  taxon_id: number
  taxon_name?: string
  taxon_rank: string
  cutoff_used?: boolean
}

interface LcaEntry {
  peptide: string
  taxon_id: number
  taxon_name?: string
  taxon_rank?: string
  domain_id: number | null
  realm_id: number | null
  kingdom_id: number | null
  subkingdom_id: number | null
  superphylum_id: number | null
  phylum_id: number | null
  subphylum_id: number | null
  superclass_id: number | null
  class_id: number | null
  subclass_id: number | null
  infraclass_id: number | null
  superorder_id: number | null
  order_id: number | null
  suborder_id: number | null
  infraorder_id: number | null
  parvorder_id: number | null
  superfamily_id: number | null
  family_id: number | null
  subfamily_id: number | null
  tribe_id: number | null
  subtribe_id: number | null
  genus_id: number | null
  subgenus_id: number | null
  species_group_id: number | null
  species_subgroup_id: number | null
  species_id: number | null
  subspecies_id: number | null
  varietas_id: number | null
  forma_id: number | null
}

export const UNIQUE_PEPTIDES_BATCH_SIZE = 500

export class UnipeptService {
  constructor(
    private readonly config: UnipeptConfig,
    private readonly pause?: PauseController,
    private readonly retry?: RetryController,
  ) {}

  async validateTaxa(
    taxaIds: number[],
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ valid: number[]; invalid: number[]; names: Record<number, string> }> {
    const valid: number[] = []
    const invalid: number[] = []
    const names: Record<number, string> = {}
    const chunks = chunked(taxaIds, this.config.batchSize)

    for (const [i, chunk] of chunks.entries()) {
      await this.pause?.wait()
      const res = await this.fetchWithRetry(
        `${this.config.unipeptUrl}/api/v2/taxonomy.json`,
        { method: 'POST', body: this.buildParams(chunk) },
        signal,
      )
      const data: TaxonEntry[] = await res.json()
      const returned = new Set(data.map((e) => e.taxon_id))
      for (const entry of data) names[entry.taxon_id] = entry.taxon_name
      for (const id of chunk) {
        if (returned.has(id)) valid.push(id)
        else invalid.push(id)
      }
      onProgress?.(i + 1, chunks.length)
    }

    return { valid, invalid, names }
  }

  /**
   * Fetches all species-level descendants for the given NCBI taxon IDs.
   *
   * IDs are queried in batches. For each batch the API returns only the taxa
   * that have at least one species-level descendant; any ID absent from the
   * response is collected in `taxaWithoutDescendants` so the caller can decide
   * how to handle them (e.g. log a warning).
   *
   * @param taxaIds - NCBI taxon IDs whose descendants should be fetched.
   * @param signal - Abort signal; rejects the returned promise on abort.
   * @param onProgress - Optional callback invoked after each batch with
   *   the number of batches completed and the total batch count.
   * @returns Object with `descendants` (deduplicated union of all species-level
   *   descendant IDs), `descendantsPerTaxon` (per-input-taxon descendant lists),
   *   and `taxaWithoutDescendants` (input IDs that had no species-level descendants).
   */
  async collectDescendants(
    taxaIds: number[],
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ descendants: number[]; descendantsPerTaxon: Record<number, number[]>; taxaWithoutDescendants: number[] }> {
    const allDescendants = new Set<number>()
    const descendantsPerTaxon: Record<number, number[]> = {}
    const taxaWithoutDescendants: number[] = []
    const chunks = chunked(taxaIds, this.config.batchSize)

    for (const [i, chunk] of chunks.entries()) {
      await this.pause?.wait()
      const params = this.buildParams(chunk, { descendants: 'true', 'descendants_ranks[]': 'species' })
      const res = await this.fetchWithRetry(
        `${this.config.unipeptUrl}/api/v2/taxonomy.json`,
        { method: 'POST', body: params },
        signal,
      )
      const data: TaxonEntry[] = await res.json()

      const withDescendants = new Set(data.map((e) => e.taxon_id))
      for (const id of chunk) {
        if (!withDescendants.has(id)) {
          taxaWithoutDescendants.push(id)
        }
      }

      for (const entry of data) {
        if (entry.descendants && entry.descendants.length > 0) {
          descendantsPerTaxon[entry.taxon_id] = entry.descendants
          for (const d of entry.descendants) allDescendants.add(d)
        }
      }
      onProgress?.(i + 1, chunks.length)
    }

    return { descendants: [...allDescendants], descendantsPerTaxon, taxaWithoutDescendants }
  }

  async lookupLcas(
    peptides: string[],
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ lineageByPeptide: Map<string, Set<number>>; lcaByPeptide: Map<string, { id: number; name: string; rank: string }> }> {
    const lineageByPeptide = new Map<string, Set<number>>()
    const lcaByPeptide = new Map<string, { id: number; name: string; rank: string }>()
    const chunks = chunked(peptides, this.config.lcaBatchSize)

    const processChunk = async (chunk: string[]): Promise<void> => {
      const params = new URLSearchParams()
      for (const pep of chunk) params.append('input[]', pep)
      params.append('equate_il', String(this.config.equateIL))
      params.append('extra', 'true')
      params.append('names', 'true')

      const res = await this.fetchWithRetry(
        `${this.config.unipeptUrl}/api/v2/pept2lca.json`,
        { method: 'POST', body: params },
        signal,
      )
      const data: LcaEntry[] = await res.json()

      for (const entry of data) {
        const ids = new Set<number>()
        ids.add(entry.taxon_id)
        for (const field of LINEAGE_ID_FIELDS) {
          const v = entry[field]
          if (v !== null && v !== undefined && v !== 0) ids.add(v)
        }
        lineageByPeptide.set(entry.peptide, ids)
        lcaByPeptide.set(entry.peptide, {
          id: entry.taxon_id,
          name: entry.taxon_name ?? '',
          rank: entry.taxon_rank ?? '',
        })
      }
    }

    await new RequestPool(this.config.parallelRequests, this.pause).execute(chunks, processChunk, onProgress)

    return { lineageByPeptide, lcaByPeptide }
  }

  /**
   * Fetches the species-level taxa for each peptide via the Unipept pept2taxa endpoint.
   *
   * Peptides are batched by `lcaBatchSize` and queried in parallel (up to
   * `parallelRequests` concurrent workers). For each returned row with
   * `taxon_rank === 'species'`, the `taxon_id` is added to the set for that peptide.
   * Peptides that match only organisms at other ranks (strain, no_rank, etc.) will have
   * an empty set; peptides not found in Unipept are absent from the map entirely.
   *
   * @param peptides - Tryptic peptide sequences to look up.
   * @param signal - Abort signal; rejects the returned promise on abort.
   * @param onProgress - Optional callback invoked after each batch completes, with
   *   the number of completed batches and the total batch count.
   * @returns Map from peptide sequence to the set of species-level taxon IDs in which
   *   the peptide occurs, plus a set of peptides for which `cutoff_used` was true
   *   (results may be truncated for those peptides).
   */
  async lookupTaxa(
    peptides: string[],
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ taxaByPeptide: Map<string, Set<number>>; cutoffPeptides: Set<string> }> {
    const taxaByPeptide = new Map<string, Set<number>>()
    const cutoffPeptides = new Set<string>()
    const chunks = chunked(peptides, this.config.lcaBatchSize)

    const processChunk = async (chunk: string[]): Promise<void> => {
      const params = new URLSearchParams()
      for (const pep of chunk) params.append('input[]', pep)
      params.append('equate_il', String(this.config.equateIL))

      const res = await this.fetchWithRetry(
        `${this.config.unipeptUrl}/api/v2/pept2taxa.json`,
        { method: 'POST', body: params },
        signal,
      )
      const data: TaxaEntry[] = await res.json()

      for (const entry of data) {
        if (!taxaByPeptide.has(entry.peptide)) {
          taxaByPeptide.set(entry.peptide, new Set<number>())
        }
        if (entry.taxon_rank === 'species') {
          taxaByPeptide.get(entry.peptide)!.add(entry.taxon_id)
        }
        if (entry.cutoff_used) {
          cutoffPeptides.add(entry.peptide)
        }
      }
    }

    await new RequestPool(this.config.parallelRequests, this.pause).execute(chunks, processChunk, onProgress)

    return { taxaByPeptide, cutoffPeptides }
  }

  async computeSharedPeptides(
    taxonIds: number[],
    cleavageRegex: string,
    minLength: number,
    signal: AbortSignal,
  ): Promise<string[]> {
    const res = await this.fetchWithRetry(
      `${this.config.unipeptUrl}/private_api/taxa/shared_peptides`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxon_ids: taxonIds, cleavage_regex: cleavageRegex, min_length: minLength }),
      },
      signal,
    )
    const data: { shared_peptides: string[] } = await res.json()
    return data.shared_peptides
  }

  async fetchUniquePeptidesCount(taxonId: number, signal: AbortSignal): Promise<number> {
    const res = await this.fetchWithRetry(
      `${this.config.unipeptUrl}/private_api/taxa/unique_peptides/count`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxon_id: taxonId }),
      },
      signal,
    )
    const data: { protein_count: number } = await res.json()
    return data.protein_count
  }

  async fetchUniquePeptidesRange(
    taxonId: number,
    start: number,
    end: number,
    cleavageRegex: string,
    minLength: number,
    signal: AbortSignal,
    parentId?: number,
  ): Promise<{ unique: string[]; uniqueToParent: string[] }> {
    const body: Record<string, unknown> = {
      taxon_id: taxonId,
      start,
      end,
      cleavage_regex: cleavageRegex,
      min_length: minLength,
    }
    if (parentId !== undefined) body.parent_id = parentId

    const res = await this.fetchWithRetry(
      `${this.config.unipeptUrl}/private_api/taxa/unique_peptides`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      signal,
    )
    const data: { unique_peptides: string[]; unique_to_parent?: string[] } = await res.json()
    return {
      unique: data.unique_peptides,
      uniqueToParent: data.unique_to_parent ?? [],
    }
  }

  async searchTaxa(
    query: string,
    start: number,
    end: number,
    sortBy: 'id' | 'name' | 'rank',
    sortDesc: boolean,
    signal: AbortSignal,
  ): Promise<TaxonSuggestion[]> {
    const ids: number[] = await this.postJson(
      `${this.config.unipeptUrl}/private_api/taxa/filter`,
      { filter: query, start, end, sort_by: sortBy, sort_descending: sortDesc },
      signal,
    )
    if (ids.length === 0) return []
    const raw: Array<{ id: number; name: string; rank: string; protein_count?: number }> = await this.postJson(
      `${this.config.unipeptUrl}/private_api/taxa`,
      { taxids: ids, report_protein_count: true },
      signal,
    )
    return raw.map((r) => ({ id: r.id, name: r.name, rank: r.rank, proteinCount: r.protein_count }))
  }

  async countTaxa(query: string, signal: AbortSignal): Promise<number> {
    const res: { count: number } = await this.postJson(
      `${this.config.unipeptUrl}/private_api/taxa/count`,
      { filter: query },
      signal,
    )
    return res.count
  }

  async fetchTaxaById(ids: number[], signal: AbortSignal): Promise<TaxonSuggestion[]> {
    const result: TaxonSuggestion[] = []
    const chunks = chunked(ids, this.config.batchSize)
    for (const chunk of chunks) {
      const res = await this.fetchWithRetry(
        `${this.config.unipeptUrl}/api/v2/taxonomy.json`,
        { method: 'POST', body: this.buildParams(chunk) },
        signal,
      )
      const data: TaxonEntry[] = await res.json()
      for (const entry of data) {
        result.push({ id: entry.taxon_id, name: entry.taxon_name, rank: entry.taxon_rank })
      }
    }
    return result
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    signal: AbortSignal,
    maxRetries = 3,
  ): Promise<Response> {
    let httpAttempt = 0
    while (true) {
      let res: Response
      try {
        res = await fetch(url, { ...init, signal })
      } catch (err) {
        if (isAbortError(err)) throw err // user cancel — propagate
        // Network error (offline, DNS, connection reset). Park until the user
        // resumes, then retry the same request.
        await this.parkOrThrow(err)
        continue
      }
      if (res.ok) return res
      if (res.status === 429 || res.status >= 500) {
        // Silent bounded auto-retry with exponential backoff.
        if (httpAttempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** httpAttempt))
          httpAttempt++
          continue
        }
        // Budget exhausted — park, then retry with a fresh budget after the user resumes.
        await this.parkOrThrow(new Error(`HTTP ${res.status} from ${url}`))
        httpAttempt = 0
        continue
      }
      // Non-retryable response (e.g. 4xx) — fail.
      throw new Error(`HTTP ${res.status} from ${url}`)
    }
  }

  /**
   * Parks the calling request until the user resumes (after which the caller
   * retries). With no RetryController wired in, rethrows so non-pipeline callers
   * keep their original fail-fast behavior.
   */
  private async parkOrThrow(err: unknown): Promise<void> {
    if (!this.retry) throw err
    await this.retry.waitForResume()
  }

  private async postJson<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
    return res.json() as Promise<T>
  }

  private buildParams(ids: number[], extra?: Record<string, string | boolean>): URLSearchParams {
    const params = new URLSearchParams()
    for (const id of ids) params.append('input[]', String(id))
    if (extra) {
      for (const [k, v] of Object.entries(extra)) params.append(k, String(v))
    }
    return params
  }
}
