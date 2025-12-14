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
// Python saves files with full shard ID: googlebooks-eng-all-{n}gram-20120701-{shard}
function getShardIds(ngramType: string): string[] {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  const n = ngramType === '1gram' ? '1' : ngramType.charAt(0)
  const prefix = `googlebooks-eng-all-${n}gram-20120701-`
  
  if (ngramType === '1gram') {
    return letters.split('').map(letter => `${prefix}${letter}`)
  } else {
    const shards: string[] = []
    for (const i of letters) {
      for (const j of letters) {
        shards.push(`${prefix}${i}${j}`)
      }
    }
    return shards
  }
}

async function loadShardFile(bucket: any, ngramType: string, fullShardId: string): Promise<Record<string, number> | null> {
  try {
    // Python script saves files as: {ngram_type}_{full_shard_id}_filtered.json
    // fullShardId already includes: googlebooks-eng-all-{n}gram-20120701-{shard}
    // Example: 1gram_googlebooks-eng-all-1gram-20120701-a_filtered.json
    const filePath = `google-ngram/${ngramType}_${fullShardId}_filtered.json`
    const file = bucket.file(filePath)
    const [exists] = await file.exists()
    
    if (!exists) {
      logger.warn(`Shard file does not exist: ${filePath}`)
      return null
    }
    
    const [contents] = await file.download()
    const data = JSON.parse(contents.toString())
    
    // Handle both dict and list formats
    if (Array.isArray(data)) {
      const result = data.reduce((acc: Record<string, number>, item: { gram: string; freq: number }) => {
        acc[item.gram] = item.freq
        return acc
      }, {})
      logger.info(`Loaded shard ${ngramType}_${fullShardId}: ${Object.keys(result).length} grams from array format`)
      return result
    } else if (typeof data === 'object' && data !== null) {
      const keyCount = Object.keys(data).length
      logger.info(`Loaded shard ${ngramType}_${fullShardId}: ${keyCount} grams from object format`)
      return data
    }
    
    logger.warn(`Shard file ${filePath} has unexpected format`)
    return null
  } catch (error) {
    logger.warn(`Failed to load shard ${ngramType}_${fullShardId}:`, { 
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
  const missingShards: string[] = []
  
  // Load and aggregate all shard files
  for (const shardId of shardIds) {
    const shardData = await loadShardFile(bucket, ngramType, shardId)
    if (shardData) {
      loadedCount++
      for (const [gram, freq] of Object.entries(shardData)) {
        aggregate[gram] = (aggregate[gram] || 0) + freq
      }
    } else {
      missingShards.push(shardId)
    }
  }
  
  logger.info(`Loaded ${loadedCount}/${shardIds.length} shards for ${ngramType}`)
  
  if (loadedCount === 0) {
    logger.error(`No shard files found for ${ngramType}! Expected files like: google-ngram/${ngramType}_googlebooks-eng-all-${ngramType === '1gram' ? '1' : ngramType.charAt(0)}gram-20120701-a_filtered.json`)
    logger.error(`Please run "Process Google Ngram Shards" first to generate the shard files`)
    return []
  }
  
  if (missingShards.length > 0 && missingShards.length <= 10) {
    logger.warn(`Missing ${missingShards.length} shard files for ${ngramType}: ${missingShards.slice(0, 10).join(', ')}`)
  } else if (missingShards.length > 10) {
    logger.warn(`Missing ${missingShards.length} shard files for ${ngramType} (showing first 10): ${missingShards.slice(0, 10).join(', ')}...`)
  }
  
  logger.info(`Total unique grams aggregated: ${Object.keys(aggregate).length}`)
  
  if (Object.keys(aggregate).length === 0) {
    logger.warn(`No data aggregated for ${ngramType} - shard files exist but contain no data`)
    return []
  }
  
  // Rank and take top N (threshold already applied in filtered shard files)
  const filtered = Object.entries(aggregate)
    .sort(([, a], [, b]) => b - a)
    .slice(0, TOP_COUNTS[ngramType])
    .map(([gram, freq]) => ({ gram, freq }))
  
  logger.info(`Generated top ${filtered.length} results for ${ngramType} (requested: ${TOP_COUNTS[ngramType]})`)
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

export async function POST() {
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
      if (topResults.length > 0) {
        await uploadToStorage(bucket, `google-ngram/${type}_top.json`, topResults)
        logger.info(`Saved ${type}_top.json with ${topResults.length} items`)
      } else {
        logger.warn(`No results to save for ${type}_top.json - file will be empty or not created`)
        // Still upload empty array to overwrite any existing file
        await uploadToStorage(bucket, `google-ngram/${type}_top.json`, [])
      }
    }
    
    // Generate consolidated files for frontend use in /data folder
    // All {n}gram_top.json files are freshly regenerated from shards
    logger.info('Generating consolidated files from aggregated results...')
    const allTopFiles: Record<string, Array<{ gram: string; freq: number }>> = allTopResults
    
    // Generate data/words.json (1gram) - sorted by frequency (descending)
    // Always generate, even if empty
    const words = allTopFiles['1gram'] ? [...allTopFiles['1gram']].sort((a, b) => b.freq - a.freq) : []
    await uploadToStorage(bucket, 'data/words.json', words)
    logger.info(`Generated data/words.json with ${words.length} words`)
    
    // Generate data/phrases.json (2-5gram combined) - sorted by frequency (descending)
    // Always regenerated
    const phrasesTop: Array<{ gram: string; freq: number }> = []
    for (const type of ['2gram', '3gram', '4gram', '5gram']) {
      if (allTopFiles[type] && allTopFiles[type].length > 0) {
        phrasesTop.push(...allTopFiles[type])
      }
    }
    // Sort all phrases by frequency (descending)
    phrasesTop.sort((a, b) => b.freq - a.freq)
    await uploadToStorage(bucket, 'data/phrases.json', phrasesTop)
    logger.info(`Generated data/phrases.json with ${phrasesTop.length} phrases`)
    
    // Also keep the old consolidated files in google-ngram for backward compatibility
    // Always regenerated to ensure consistency
    await uploadToStorage(bucket, 'google-ngram/words_top.json', words)
    logger.info(`Generated google-ngram/words_top.json with ${words.length} words`)
    await uploadToStorage(bucket, 'google-ngram/phrases_top.json', phrasesTop)
    logger.info(`Generated google-ngram/phrases_top.json with ${phrasesTop.length} phrases`)
    
    logger.info('Completed generation of all consolidated files')
    
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
