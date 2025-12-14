import { NextResponse } from 'next/server'
import { getStorage } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'

export const dynamic = 'force-dynamic'

const TOP_COUNTS: Record<string, number> = {
  '1gram': 30000,
  '2gram': 10000,
  '3gram': 10000,
  '4gram': 10000,
  '5gram': 10000
}

// Shard patterns: 1gram uses a-z, 2-5gram use aa-zz
function getShardIds(ngramType: string): string[] {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  if (ngramType === '1gram') {
    return letters.split('')
  } else {
    const shards: string[] = []
    for (const i of letters) {
      for (const j of letters) {
        shards.push(`${i}${j}`)
      }
    }
    return shards
  }
}

async function loadShardFile(bucket: any, ngramType: string, shardId: string): Promise<Record<string, number> | null> {
  try {
    const filePath = `google-ngram/${ngramType}_${shardId}_filtered.json`
    const file = bucket.file(filePath)
    const [exists] = await file.exists()
    
    if (!exists) {
      return null
    }
    
    const [contents] = await file.download()
    const data = JSON.parse(contents.toString())
    
    // Handle both dict and list formats
    if (Array.isArray(data)) {
      return data.reduce((acc: Record<string, number>, item: { gram: string; freq: number }) => {
        acc[item.gram] = item.freq
        return acc
      }, {})
    } else if (typeof data === 'object') {
      return data
    }
    
    return null
  } catch (error) {
    logger.warn(`Failed to load shard ${ngramType}_${shardId}:`, { 
      error: error instanceof Error ? error.message : String(error) 
    })
    return null
  }
}

async function aggregateNgramType(bucket: any, ngramType: string): Promise<Array<{ gram: string; freq: number }>> {
  logger.info(`Aggregating ${ngramType}...`)
  const shardIds = getShardIds(ngramType)
  const aggregate: Record<string, number> = {}
  let loadedCount = 0
  
  // Load and aggregate all shard files
  for (const shardId of shardIds) {
    const shardData = await loadShardFile(bucket, ngramType, shardId)
    if (shardData) {
      loadedCount++
      for (const [gram, freq] of Object.entries(shardData)) {
        aggregate[gram] = (aggregate[gram] || 0) + freq
      }
    }
  }
  
  logger.info(`Loaded ${loadedCount}/${shardIds.length} shards for ${ngramType}`)
  
  // Rank and take top N (threshold already applied in filtered shard files)
  const filtered = Object.entries(aggregate)
    .sort(([, a], [, b]) => b - a)
    .slice(0, TOP_COUNTS[ngramType])
    .map(([gram, freq]) => ({ gram, freq }))
  
  logger.info(`Generated top ${filtered.length} results for ${ngramType}`)
  return filtered
}

async function uploadToStorage(bucket: any, filePath: string, data: any): Promise<void> {
  try {
    const file = bucket.file(filePath)
    // file.save() automatically overwrites existing files
    await file.save(JSON.stringify(data), {
      contentType: 'application/json',
      metadata: { cacheControl: 'public, max-age=3600' }
    })
    logger.info(`Uploaded ${filePath} (overwrites existing if present)`)
  } catch (error) {
    logger.error(`Error uploading ${filePath}:`, error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

async function loadTopFile(bucket: any, ngramType: string): Promise<Array<{ gram: string; freq: number }> | null> {
  try {
    const filePath = `google-ngram/${ngramType}_top.json`
    const file = bucket.file(filePath)
    const [exists] = await file.exists()
    
    if (!exists) {
      return null
    }
    
    const [contents] = await file.download()
    const data = JSON.parse(contents.toString())
    
    if (Array.isArray(data)) {
      return data
    }
    
    return null
  } catch (error) {
    logger.warn(`Failed to load top file for ${ngramType}:`, {
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

export async function POST(request: Request) {
  try {
    const storage = await getStorage()
    const bucket = storage.bucket()
    
    // Always regenerate ALL {n}gram_top.json files from shard files
    // This ensures consistency and uses the most up-to-date shard data
    const allTypes = ['1gram', '2gram', '3gram', '4gram', '5gram']
    const results: Record<string, number> = {}
    const allTopResults: Record<string, Array<{ gram: string; freq: number }>> = {}
    
    // Aggregate all types from shards
    logger.info('Regenerating all n-gram types from shard files')
    for (const type of allTypes) {
      const topResults = await aggregateNgramType(bucket, type)
      results[type] = topResults.length
      allTopResults[type] = topResults
      
      // Upload top file for this type (overwrites existing)
      await uploadToStorage(bucket, `google-ngram/${type}_top.json`, topResults)
    }
    
    // Generate consolidated files for frontend use in /data folder
    // All {n}gram_top.json files are freshly regenerated from shards
    const allTopFiles: Record<string, Array<{ gram: string; freq: number }>> = allTopResults
    
    // Generate data/words.json (1gram) - sorted by frequency (descending)
    if (allTopFiles['1gram']) {
      const words = [...allTopFiles['1gram']].sort((a, b) => b.freq - a.freq)
      await uploadToStorage(bucket, 'data/words.json', words)
      logger.info(`Generated data/words.json with ${words.length} words`)
    }
    
    // Generate data/phrases.json (2-5gram combined) - sorted by frequency (descending)
    // Always regenerated, even when processing a single type
    const phrasesTop: Array<{ gram: string; freq: number }> = []
    for (const type of ['2gram', '3gram', '4gram', '5gram']) {
      if (allTopFiles[type]) {
        phrasesTop.push(...allTopFiles[type])
      }
    }
    // Sort all phrases by frequency (descending)
    phrasesTop.sort((a, b) => b.freq - a.freq)
    await uploadToStorage(bucket, 'data/phrases.json', phrasesTop)
    logger.info(`Generated data/phrases.json with ${phrasesTop.length} phrases (always regenerated)`)
    
    // Also keep the old consolidated files in google-ngram for backward compatibility
    // Always regenerated to ensure consistency
    if (allTopFiles['1gram']) {
      await uploadToStorage(bucket, 'google-ngram/words_top.json', allTopFiles['1gram'])
    }
    await uploadToStorage(bucket, 'google-ngram/phrases_top.json', phrasesTop)
    logger.info('Regenerated all consolidated files (data/words.json, data/phrases.json, and backward compat files)')
    
    return NextResponse.json({ 
      success: true, 
      results,
      message: 'Regenerated all n-gram aggregate files from shards (all 5 types)' 
    })
  } catch (error) {
    logger.error('Aggregation error:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ 
      error: 'Failed to aggregate n-gram data',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
