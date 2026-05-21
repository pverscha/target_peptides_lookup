import { db } from '@/db/analysisDb'
import type { AnalysisSnapshot, AnalysisSummary } from '@/types'

export async function saveAnalysis(snapshot: Omit<AnalysisSnapshot, 'id'>): Promise<number> {
  return db.analyses.add(snapshot as AnalysisSnapshot)
}

export async function listAnalyses(): Promise<AnalysisSummary[]> {
  const rows = await db.analyses.orderBy('savedAt').reverse().toArray()
  return rows.map((row) => ({
    id: row.id!,
    name: row.name,
    savedAt: row.savedAt,
    inputTaxonNames: Object.values(row.taxonNames),
    inputTaxonCount: row.inputTaxonIds.length,
    intersectionPeptideCount: row.intersectionPeptides.length,
    uniquePeptideCount: row.uniquePeptides.length,
  }))
}

export async function loadAnalysis(id: number): Promise<AnalysisSnapshot | undefined> {
  return db.analyses.get(id)
}

export async function deleteAnalysis(id: number): Promise<void> {
  return db.analyses.delete(id)
}

export async function renameAnalysis(id: number, name: string): Promise<void> {
  await db.analyses.update(id, { name })
}
