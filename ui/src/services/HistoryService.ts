import { db, snapshotToSummary } from '@/db/analysisDb'
import type { AnalysisSnapshot, AnalysisSummary } from '@/types'

export async function saveAnalysis(snapshot: Omit<AnalysisSnapshot, 'id'>): Promise<number> {
  return db.transaction('rw', db.analyses, db.analysesMeta, async () => {
    const id = await db.analyses.add(snapshot as AnalysisSnapshot)
    await db.analysesMeta.add(snapshotToSummary(snapshot, id))
    return id
  })
}

export async function listAnalyses(): Promise<AnalysisSummary[]> {
  return db.analysesMeta.orderBy('savedAt').reverse().toArray()
}

export async function loadAnalysis(id: number): Promise<AnalysisSnapshot | undefined> {
  return db.analyses.get(id)
}

export async function deleteAnalysis(id: number): Promise<void> {
  return db.transaction('rw', db.analyses, db.analysesMeta, async () => {
    await db.analyses.delete(id)
    await db.analysesMeta.delete(id)
  })
}

export async function renameAnalysis(id: number, name: string): Promise<void> {
  return db.transaction('rw', db.analyses, db.analysesMeta, async () => {
    await db.analyses.update(id, { name })
    await db.analysesMeta.update(id, { name })
  })
}
