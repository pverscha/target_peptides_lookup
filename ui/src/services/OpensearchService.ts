import type { OpensearchConfig } from '@/types'
import { chunked } from '@/utils/peptides'

interface OsHit {
  _id: string
  _source: { sequence: string }
}

interface OsScrollResponse {
  _scroll_id: string
  hits: {
    total: { value: number; relation: string }
    hits: OsHit[]
  }
}

interface OsAggResponse {
  aggregations: {
    by_taxon: {
      buckets: Array<{ key: number; doc_count: number }>
    }
  }
}

const SCROLL_TTL = '5m'
const SCROLL_PAGE_SIZE = 2000
const CHUNK_SIZE = 1024

export class OpensearchService {
  constructor(private readonly config: OpensearchConfig) {}

  async countProteinsByTaxon(
    taxonIds: number[],
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Record<number, number>> {
    const counts: Record<number, number> = {}
    const chunks = chunked(taxonIds, CHUNK_SIZE)

    for (const [i, chunk] of chunks.entries()) {
      const data = await this.osPost<OsAggResponse>(
        `${this.config.opensearchUrl}/${this.config.opensearchIndex}/_search`,
        {
          size: 0,
          query: { terms: { taxon_id: chunk } },
          aggs: {
            by_taxon: {
              terms: { field: 'taxon_id', size: chunk.length },
            },
          },
        },
        signal,
      )
      for (const bucket of data.aggregations.by_taxon.buckets) {
        counts[bucket.key] = bucket.doc_count
      }
      onProgress?.(i + 1, chunks.length)
    }

    return counts
  }

  async *streamProteins(
    taxonId: number,
    signal: AbortSignal,
  ): AsyncGenerator<string, void, undefined> {
    let scrollId: string | null = null

    try {
      const first = await this.osPost<OsScrollResponse>(
        `${this.config.opensearchUrl}/${this.config.opensearchIndex}/_search?scroll=${SCROLL_TTL}`,
        {
          size: SCROLL_PAGE_SIZE,
          query: { term: { taxon_id: taxonId } },
          _source: ['sequence'],
        },
        signal,
      )

      scrollId = first._scroll_id
      let hits = first.hits.hits

      while (hits.length > 0) {
        for (const hit of hits) {
          const seq = hit._source.sequence
          if (seq) yield seq
        }

        if (signal.aborted) break

        const next: OsScrollResponse = await this.osPost<OsScrollResponse>(
          `${this.config.opensearchUrl}/_search/scroll`,
          { scroll: SCROLL_TTL, scroll_id: scrollId },
          signal,
        )
        scrollId = next._scroll_id
        hits = next.hits.hits
      }
    } finally {
      // Clean up the scroll context — use a fresh signal so cleanup succeeds
      // even when the pipeline was cancelled and its signal is already aborted.
      if (scrollId) {
        const cleanup = new AbortController()
        const timer = setTimeout(() => cleanup.abort(), 5000)
        fetch(`${this.config.opensearchUrl}/_search/scroll`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scroll_id: scrollId }),
          signal: cleanup.signal,
        }).finally(() => clearTimeout(timer))
      }
    }
  }

  private async osPost<T>(
    url: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<T> {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      const urlShort = url.replace(/\?.*/, '')
      throw new Error(
        `Cannot reach OpenSearch at ${urlShort} — check the URL, ensure the instance is running, and verify CORS headers (http.cors.enabled: true in opensearch.yml).`,
      )
    }
    if (!res.ok) throw new Error(`OpenSearch HTTP ${res.status}: ${url}`)
    return res.json() as Promise<T>
  }
}
