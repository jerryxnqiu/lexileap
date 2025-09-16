import { NextResponse } from 'next/server'
import { getDb, getStorage } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'

export const dynamic = 'force-dynamic'

const STOPWORDS = new Set([
  'the','be','to','of','and','a','in','that','have','i','it','for','not','on','with','he','as','you','do','at','this','but','his','by','from','they','we','say','her','she','or','an','will','my','one','all','would','there','their','what','so','up','out','if','about','who','get','which','go','me','when','make','can','like','time','no','just','him','know','take','people','into','year','your','good','some','could','them','see','other','than','then','now','look','only','come','its','over','think','also','back','after','use','two','how','our','work','first','well','way','even','new','want','because','any','these','give','day','most','us'
])

function isAlpha(word: string): boolean { return /^[A-Za-z]+$/.test(word) }
function isCleanGram(tokens: string[]): boolean { return tokens.length>0 && tokens.every(t=>isAlpha(t)) }
function hasContentWord(tokens: string[]): boolean { return tokens.some(t=>!STOPWORDS.has(t.toLowerCase())) }


async function processUrlAndAccumulate(url: string, n: number, agg: Map<string, number>, minFrequency: number = 5000): Promise<void> {
  try {
    logger.info(`Processing URL: ${url}`)
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok || !res.body) {
      logger.error(`Fetch failed for ${url}: ${res.status} ${res.statusText}`)
      return
    }
    
    // Handle gzip (.gz) sources via Web Streams DecompressionStream when needed
    let stream: ReadableStream<Uint8Array> = res.body
    const contentEncoding = res.headers.get('content-encoding') || ''
    const contentType = res.headers.get('content-type') || ''
    const isGzip = url.endsWith('.gz') || /gzip/i.test(contentEncoding) || /application\/(x-)?gzip/i.test(contentType)
    try {
      if (isGzip && typeof DecompressionStream !== 'undefined') {
        // @ts-expect-error - DecompressionStream type compatibility issue with Node.js streams
        stream = stream.pipeThrough(new DecompressionStream('gzip'))
      }
    } catch {}
    
    const reader = stream.getReader()
    const decoder = new TextDecoder('utf-8')
    let buf = ''
    let lineCount = 0
    let processedCount = 0
    
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        buf += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx)
          buf = buf.slice(idx + 1)
          lineCount++
          
          if (lineCount % 50000 === 0) {
            logger.info(`Processed ${lineCount} lines from ${url}`)
          }
          
          const s = line.trim(); if (!s) continue
          // TSV format: ngram<TAB>year<TAB>match_count<TAB>volume_count
          const parts = s.split('\t')
          if (parts.length >= 3) {
            const gram = parts[0]
            const match = Number(parts[2])
            if (!Number.isFinite(match)) continue
            const tokens = gram.split(' ')
            if (tokens.length !== n) continue
            if (!isCleanGram(tokens)) continue
            const prev = agg.get(gram) ?? 0
            const newTotal = prev + match
            
            // Only keep words above frequency threshold to manage memory
            if (newTotal >= minFrequency) {
              agg.set(gram, newTotal)
              processedCount++
            } else if (prev > 0) {
              // Remove words that fall below threshold
              agg.delete(gram)
            }
          }
        }
      }
    }
    
    if (buf.length) {
      const s = buf.trim()
      if (s) {
        const parts = s.split('\t')
        if (parts.length >= 3) {
          const gram = parts[0]
          const match = Number(parts[2])
          if (Number.isFinite(match)) {
            const tokens = gram.split(' ')
            if (tokens.length === n && isCleanGram(tokens)) {
              agg.set(gram, (agg.get(gram) ?? 0) + match)
              processedCount++
            }
          }
        }
      }
    }
    
    logger.info(`Completed ${url}, processed ${lineCount} lines, ${processedCount} valid grams, ${agg.size} unique grams total (min freq: ${minFrequency})`)
    
    // Force garbage collection hint - the raw data is now out of scope
    if (global.gc) {
      global.gc()
    }
    
  } catch (e) {
    logger.error('Process URL error:', e instanceof Error ? e : new Error(String(e)))
  }
}


function filterAndRank(map: Map<string, number>, n: number, topN: number): Array<{ gram: string; freq: number }> {
  const items: Array<{ gram: string; freq: number }> = []
  for (const [gram, freq] of map.entries()) {
    const tokens = gram.split(' ')
    if (tokens.length !== n) continue
    if (!isCleanGram(tokens)) continue
    if (n===1) {
      // ok
    } else if (n===2) {
      if (!hasContentWord(tokens) || (STOPWORDS.has(tokens[0].toLowerCase()) && STOPWORDS.has(tokens[1].toLowerCase()))) continue
    } else {
      if (!hasContentWord(tokens)) continue
    }
    items.push({ gram, freq })
  }
  items.sort((a,b)=>b.freq-a.freq)
  return items.slice(0, topN)
}

function buildShardUrls(n: 1 | 2 | 3 | 4 | 5): string[] {
  const base = `http://storage.googleapis.com/books/ngrams/books/googlebooks-eng-all-${n}gram-20120701-`
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  const urls: string[] = []
  
  if (n === 1) {
    // 1-gram: single letter shards (a-z)
    for (let i = 0; i < letters.length; i++) {
      urls.push(`${base}${letters[i]}.gz`)
    }
  } else {
    // 2-5 gram: two-letter shards (aa-zz)
    for (let i = 0; i < letters.length; i++) {
      for (let j = 0; j < letters.length; j++) {
        const shard = letters[i] + letters[j]
        urls.push(`${base}${shard}.gz`)
      }
    }
  }
  return urls
}

export async function POST() {
  try {
    // Auto-generate n-gram URLs based on standard Google Books Ngram pattern
    // No need to store URLs in Secret Manager since they follow a predictable pattern
    const storage = await getStorage()
    const outPrefix = 'data/google-ngram'

    // Process URLs one by one with periodic flushing to avoid memory buildup
    const testUrls = buildShardUrls(1).slice(0, 3) // Process first 3 URLs (a, b, c)
    logger.info(`Processing 1-gram with ${testUrls.length} URLs`)
    
    const agg = new Map<string, number>()
    for (let i = 0; i < testUrls.length; i++) {
      const url = testUrls[i]
      await processUrlAndAccumulate(url, 1, agg)
      logger.info(`After ${url}: ${agg.size} unique grams accumulated`)
      
      // Flush to storage every URL to prevent memory buildup
      if (agg.size > 0) {
        const tempFile = `${outPrefix}/temp_1gram_${i}.json`
        await storage.bucket().file(tempFile).save(JSON.stringify(Array.from(agg.entries())))
        logger.info(`Flushed ${agg.size} grams to ${tempFile}`)
        agg.clear() // Clear memory
      }
    }
    
    // Merge all temporary files
    logger.info(`Merging temporary files...`)
    const finalAgg = new Map<string, number>()
    for (let i = 0; i < testUrls.length; i++) {
      try {
        const tempFile = `${outPrefix}/temp_1gram_${i}.json`
        const [tempData] = await storage.bucket().file(tempFile).download()
        const entries = JSON.parse(tempData.toString()) as Array<[string, number]>
        
        for (const [gram, freq] of entries) {
          finalAgg.set(gram, (finalAgg.get(gram) || 0) + freq)
        }
        
        // Delete temporary file
        await storage.bucket().file(tempFile).delete()
        logger.info(`Merged temp file ${i}, total unique grams: ${finalAgg.size}`)
      } catch (e) {
        logger.error(`Error merging temp file ${i}:`, e instanceof Error ? e : new Error(String(e)))
      }
    }
    
    logger.info(`1-gram aggregation complete, ${finalAgg.size} unique grams found`)
    const top = filterAndRank(finalAgg, 1, 20000)
    logger.info(`1-gram filtering complete, ${top.length} top grams selected`)
    await storage.bucket().file(`${outPrefix}/1gram_top.json`).save(JSON.stringify(top))
    logger.info(`1-gram data saved to Firebase Storage`)
    
    try {
      const db = await getDb()
      await db.collection('system_jobs').doc('google_ngram_last_run').set({ ranAt: new Date() })
    } catch {}
    
    logger.info('Google Ngram dataset prepared successfully (data instance)')
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Google Ngram generation error (data instance):', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Failed to prepare Google Ngram dataset' }, { status: 500 })
  }
}


