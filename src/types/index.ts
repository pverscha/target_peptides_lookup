export interface Config {
  unipeptUrl: string
  batchSize: number
  lcaBatchSize: number
  parallelRequests: number
  minLength: number
  equateIL: boolean
  cleavageMethod: 'tryptic' | 'custom'
  cleavageRegex: string
  computePerTaxonUnique: boolean
  computeUniqueSharedPeptides: boolean
}

export interface UnipeptConfig {
  unipeptUrl: string
  batchSize: number
  lcaBatchSize: number
  parallelRequests: number
  equateIL: boolean
}

export type StepStatus = 'idle' | 'running' | 'done' | 'error' | 'skipped'

export interface PipelineStep {
  id: string
  label: string
  status: StepStatus
  /** 0–1 fraction; null means indeterminate */
  progress: number | null
  detail: string
}

export interface LogEntry {
  level: 'info' | 'warning' | 'error'
  message: string
  timestamp: Date
}

export type PipelineStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

export interface TaxonSuggestion {
  id: number
  name: string
  rank: string
  proteinCount?: number
}

export interface AnalysisParams {
  minLength: number
  equateIL: boolean
  cleavageMethod: 'tryptic' | 'custom'
  cleavageRegex: string
  computePerTaxonUnique: boolean
  computeUniqueSharedPeptides: boolean
}

export interface AnalysisSnapshot {
  id?: number
  name?: string
  savedAt: string
  inputTaxonIds: number[]
  inputTaxa?: TaxonSuggestion[]
  analysisConfig?: AnalysisParams
  taxonNames: Record<number, string>
  descendantIds: number[]
  descendantsByTaxon: Record<number, number[]>
  proteinCounts?: Record<number, number>
  intersectionPeptides: string[]
  uniquePeptides: string[]
  perTaxonUniquePeptides: Record<number, string[]>
  perTaxonCoreCounts?: Record<number, number>
  /** Coverage data for higher-level (non-species/strain) taxa. Maps taxon ID →
   *  peptide → list of descendant species IDs that contained this peptide in their
   *  unique_to_parent response. Absent for taxa shown as strict-unique (leaves). */
  perTaxonCoverage?: Record<number, Record<string, number[]>>
  lcaByPeptide: Record<string, { id: number; name: string; rank: string }>
  logs: Array<{ level: 'info' | 'warning' | 'error'; message: string; timestamp: string }>
}

export interface AnalysisSummary {
  id: number
  name?: string
  savedAt: string
  inputTaxonNames: string[]
  inputTaxonCount: number
  intersectionPeptideCount: number
  uniquePeptideCount: number
}
