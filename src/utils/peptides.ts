export const TRYPSIN_RE = /(?<=[KR])(?!P)/g

export const LINEAGE_ID_FIELDS = [
  'domain_id', 'realm_id', 'kingdom_id', 'subkingdom_id',
  'superphylum_id', 'phylum_id', 'subphylum_id',
  'superclass_id', 'class_id', 'subclass_id', 'infraclass_id',
  'superorder_id', 'order_id', 'suborder_id', 'infraorder_id',
  'parvorder_id', 'superfamily_id', 'family_id', 'subfamily_id',
  'tribe_id', 'subtribe_id',
  'genus_id', 'subgenus_id',
  'species_group_id', 'species_subgroup_id',
  'species_id', 'subspecies_id',
  'varietas_id', 'forma_id',
] as const

/**
 * Split a sequence into fixed-size chunks.
 */
export function chunked<T>(array: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size))
  }
  return result
}

/**
 * Parse a raw text block of taxon IDs (one per line, # comments allowed).
 * Returns validated IDs and any parse errors for inline UI display.
 */
export function parseTaxonInput(raw: string): { ids: number[]; errors: string[] } {
  const ids: number[] = []
  const seen = new Set<number>()
  const errors: string[] = []

  for (const [i, line] of raw.split('\n').entries()) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const n = Number(s)
    if (!Number.isInteger(n) || n <= 0) {
      errors.push(`Line ${i + 1}: not a valid taxon ID: "${s}"`)
      continue
    }
    if (!seen.has(n)) {
      seen.add(n)
      ids.push(n)
    }
  }
  return { ids, errors }
}

export function intersectSets<T>(a: Set<T>, b: Set<T>): Set<T> {
  const result = new Set<T>()
  for (const v of a) if (b.has(v)) result.add(v)
  return result
}

export function unionSets<T>(sets: Iterable<Set<T>>): Set<T> {
  const result = new Set<T>()
  for (const s of sets) for (const v of s) result.add(v)
  return result
}
