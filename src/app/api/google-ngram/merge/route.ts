import { NextResponse } from 'next/server'
import { getStorage } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'

export const dynamic = 'force-dynamic'

type NgramType = '1gram' | '2gram' | '3gram' | '4gram' | '5gram'

function isAlpha(word: string): boolean { return /^[A-Za-z]+$/.test(word) }
function isCleanGram(tokens: string[]): boolean { return tokens.length>0 && tokens.every(t=>isAlpha(t)) }

function filterAndRank(map: Map<string, number>, n: number, topN: number): Array<{ gram: string; freq: number }> {
  const items: Array<{ gram: string; freq: number }> = []
  for (const [gram, freq] of map.entries()) {
    const tokens = gram.split(' ')
    if (tokens.length !== n) continue
    if (!isCleanGram(tokens)) continue
    items.push({ gram, freq })
  }
  items.sort((a,b)=>b.freq-a.freq)
  return items.slice(0, topN)
}

function expectedShardCount(t: NgramType): number {
  return t === '1gram' ? 26 : 26*26
}

function nFromType(t: NgramType): number { return parseInt(t.replace('gram',''), 10) }

export async function POST() {
  try {
    const storage = await getStorage()
    const bucket = storage.bucket()
    const outPrefix = 'data/google-ngram'
    const types: NgramType[] = ['1gram','2gram','3gram','4gram','5gram']

    const topCounts: Record<NgramType, number> = {
      '1gram': 30000,
      '2gram': 10000,
      '3gram': 10000,
      '4gram': 10000,
      '5gram': 10000
    }

    const results: Array<{ type: NgramType; merged: boolean; shards: number; written?: number }> = []

    for (const t of types) {
      const [files] = await bucket.getFiles({ prefix: `${outPrefix}/temp_${t}_` })
      const shardCount = files.length
      const expected = expectedShardCount(t)
      if (shardCount < expected) {
        logger.info(`Merge skipped for ${t}: ${shardCount}/${expected} shards ready`)
        results.push({ type: t, merged: false, shards: shardCount })
        continue
      }

      logger.info(`Merging ${shardCount} shards for ${t} ...`)
      const agg = new Map<string, number>()

      for (const file of files) {
        try {
          const [data] = await file.download()
          const entries = JSON.parse(data.toString()) as Array<[string, number]>
          for (const [gram, freq] of entries) {
            agg.set(gram, (agg.get(gram) || 0) + freq)
          }
        } catch (e) {
          logger.error(`Failed reading ${file.name}:`, e instanceof Error ? e : new Error(String(e)))
        }
      }

      const topN = topCounts[t]
      const n = nFromType(t)
      const top = filterAndRank(agg, n, topN)
      await bucket.file(`${outPrefix}/${t}_top.json`).save(JSON.stringify(top))
      logger.info(`Wrote ${t}_top.json with ${top.length} items`)

      // Cleanup shards
      for (const file of files) {
        try { await file.delete() } catch {}
      }

      results.push({ type: t, merged: true, shards: shardCount, written: top.length })
    }

    return NextResponse.json({ success: true, results })
  } catch (error) {
    logger.error('Ngram merge error:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Failed to merge Ngram shards' }, { status: 500 })
  }
}


