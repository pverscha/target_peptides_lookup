import Dexie, { type Table } from 'dexie'
import type { AnalysisSnapshot, AnalysisSummary } from '@/types'

export function snapshotToSummary(snapshot: Omit<AnalysisSnapshot, 'id'>, id: number): AnalysisSummary {
  return {
    id,
    name: snapshot.name,
    savedAt: snapshot.savedAt,
    inputTaxonNames: Object.values(snapshot.taxonNames),
    inputTaxonCount: snapshot.inputTaxonIds.length,
    intersectionPeptideCount: snapshot.intersectionPeptides.length,
    uniquePeptideCount: snapshot.uniquePeptides.length,
  }
}

class AnalysisDatabase extends Dexie {
  analyses!: Table<AnalysisSnapshot, number>
  analysesMeta!: Table<AnalysisSummary, number>

  constructor() {
    super('TargetPeptidesHistory')
    this.version(1).stores({
      analyses: '++id, savedAt',
    })
    this.version(2)
      .stores({
        analyses: '++id, savedAt',
        analysesMeta: '++id, savedAt',
      })
      .upgrade(async (tx) => {
        const all = await tx.table<AnalysisSnapshot>('analyses').toArray()
        await tx.table('analysesMeta').bulkAdd(
          all.map((row) => snapshotToSummary(row, row.id!)),
        )
      })
  }
}

export const db = new AnalysisDatabase()
