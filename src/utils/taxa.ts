export function isLeafRank(rank: string | undefined): boolean {
    return rank === 'species' || rank === 'strain'
}
