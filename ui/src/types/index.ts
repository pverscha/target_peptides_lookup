export interface Config {
  unipeptUrl: string
  opensearchUrl: string
  opensearchIndex: string
  batchSize: number
  parallelRequests: number
  minLength: number
  equateIL: boolean
  cleavageMethod: 'tryptic' | 'custom'
  cleavageRegex: string
  minProteins: number
}

export interface UnipeptConfig {
  unipeptUrl: string
  batchSize: number
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
