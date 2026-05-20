import Dexie, { type Table } from 'dexie'
import type { AnalysisSnapshot } from '@/types'

class AnalysisDatabase extends Dexie {
  analyses!: Table<AnalysisSnapshot, number>

  constructor() {
    super('TargetPeptidesHistory')
    this.version(1).stores({
      analyses: '++id, savedAt',
    })
  }
}

export const db = new AnalysisDatabase()
