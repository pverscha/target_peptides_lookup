export interface Config {
  unipeptUrl: string
  opensearchUrl: string
  opensearchIndex: string
  batchSize: number
  lcaBatchSize: number
  taxaBatchSize: number
  parallelRequests: number
  minLength: number
  equateIL: boolean
  cleavageMethod: 'tryptic' | 'custom'
  cleavageRegex: string
  minProteins: number
  computePerTaxonUnique: boolean
  computeUniqueSharedPeptides: boolean
}

export interface UnipeptConfig {
  unipeptUrl: string
  batchSize: number
  lcaBatchSize: number
  taxaBatchSize: number
  parallelRequests: number
  equateIL: boolean
}

export interface OpensearchConfig {
  opensearchUrl: string
  opensearchIndex: string
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
}

export interface AnalysisParams {
  minLength: number
  equateIL: boolean
  cleavageMethod: 'tryptic' | 'custom'
  cleavageRegex: string
  minProteins: number
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
  proteinCounts: Record<number, number>
  intersectionPeptides: string[]
  uniquePeptides: string[]
  perTaxonUniquePeptides: Record<number, string[]>
  perTaxonCoreCounts: Record<number, number>
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
