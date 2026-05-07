import type { UnipeptConfig, TaxonSuggestion } from '@/types'
import { chunked, LINEAGE_ID_FIELDS } from '@/utils/peptides'

interface TaxonEntry {
  taxon_id: number
  taxon_name: string
  taxon_rank: string
  descendants?: number[]
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

export class UnipeptService {
  constructor(private readonly config: UnipeptConfig) {}

  async validateTaxa(
    taxaIds: number[],
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ valid: number[]; invalid: number[] }> {
    const valid: number[] = []
    const invalid: number[] = []
    const chunks = chunked(taxaIds, this.config.batchSize)

    for (const [i, chunk] of chunks.entries()) {
      const res = await this.fetchWithRetry(
        `${this.config.unipeptUrl}/api/v2/taxonomy.json`,
        { method: 'POST', body: this.buildParams(chunk) },
        signal,
      )
      const data: TaxonEntry[] = await res.json()
      const returned = new Set(data.map((e) => e.taxon_id))
      for (const id of chunk) {
        if (returned.has(id)) valid.push(id)
        else invalid.push(id)
      }
      onProgress?.(i + 1, chunks.length)
    }

    return { valid, invalid }
  }

  async collectDescendants(
    taxaIds: number[],
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ descendants: number[]; warnings: string[] }> {
    const allDescendants = new Set<number>()
    const warnings: string[] = []
    const chunks = chunked(taxaIds, this.config.batchSize)

    for (const [i, chunk] of chunks.entries()) {
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
          warnings.push(`Taxon ${id} has no species-level descendants`)
        }
      }

      for (const entry of data) {
        if (entry.descendants && entry.descendants.length > 0) {
          for (const d of entry.descendants) allDescendants.add(d)
        }
      }
      onProgress?.(i + 1, chunks.length)
    }

    return { descendants: [...allDescendants], warnings }
  }

  async lookupLcas(
    peptides: string[],
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Map<string, Set<number>>> {
    const result = new Map<string, Set<number>>()
    const chunks = chunked(peptides, this.config.batchSize)

    for (const [i, chunk] of chunks.entries()) {
      const params = new URLSearchParams()
      for (const pep of chunk) params.append('input[]', pep)
      params.append('equate_il', String(this.config.equateIL))
      params.append('extra', 'true')
      params.append('names', 'false')

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
        result.set(entry.peptide, ids)
      }
      onProgress?.(i + 1, chunks.length)
    }

    return result
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
    const raw: Array<{ id: number; name: string; rank: string }> = await this.postJson(
      `${this.config.unipeptUrl}/private_api/taxa`,
      { taxids: ids },
      signal,
    )
    return raw.map((r) => ({ id: r.id, name: r.name, rank: r.rank }))
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
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await fetch(url, { ...init, signal })
      if (res.ok) return res
      if (res.status === 429 || res.status >= 500) {
        if (attempt === maxRetries) throw new Error(`HTTP ${res.status} from ${url}`)
        await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt))
        continue
      }
      throw new Error(`HTTP ${res.status} from ${url}`)
    }
    throw new Error('fetchWithRetry: exhausted retries')
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
