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

    // Process 1-gram: all letters (a-z)
    const oneGramUrls = buildShardUrls(1) // All 26 URLs (a-z)
    logger.info(`Processing 1-gram with ${oneGramUrls.length} URLs`)
    
    const oneGramAgg = new Map<string, number>()
    for (let i = 0; i < oneGramUrls.length; i++) {
      const url = oneGramUrls[i]
      await processUrlAndAccumulate(url, 1, oneGramAgg)
      logger.info(`After ${url}: ${oneGramAgg.size} unique grams accumulated`)
      
      // Flush to storage every 5 URLs to prevent memory buildup
      if ((i + 1) % 5 === 0 || i === oneGramUrls.length - 1) {
        const tempFile = `${outPrefix}/temp_1gram_${i}.json`
        await storage.bucket().file(tempFile).save(JSON.stringify(Array.from(oneGramAgg.entries())))
        logger.info(`Flushed ${oneGramAgg.size} grams to ${tempFile}`)
        oneGramAgg.clear() // Clear memory
      }
    }
    
    // Merge 1-gram temporary files
    logger.info(`Merging 1-gram temporary files...`)
    const finalOneGramAgg = new Map<string, number>()
    for (let i = 4; i < oneGramUrls.length; i += 5) {
      try {
        const tempFile = `${outPrefix}/temp_1gram_${i}.json`
        const [tempData] = await storage.bucket().file(tempFile).download()
        const entries = JSON.parse(tempData.toString()) as Array<[string, number]>
        
        for (const [gram, freq] of entries) {
          finalOneGramAgg.set(gram, (finalOneGramAgg.get(gram) || 0) + freq)
        }
        
        // Delete temporary file
        await storage.bucket().file(tempFile).delete()
        logger.info(`Merged 1-gram temp file ${i}, total unique grams: ${finalOneGramAgg.size}`)
      } catch (e) {
        logger.error(`Error merging 1-gram temp file ${i}:`, e instanceof Error ? e : new Error(String(e)))
      }
    }
    
    logger.info(`1-gram aggregation complete, ${finalOneGramAgg.size} unique grams found`)
    const oneGramTop = filterAndRank(finalOneGramAgg, 1, 30000)
    logger.info(`1-gram filtering complete, ${oneGramTop.length} top grams selected`)
    await storage.bucket().file(`${outPrefix}/1gram_top.json`).save(JSON.stringify(oneGramTop))
    logger.info(`1-gram data saved to Firebase Storage`)
    
    // Process 2-gram: first 10 shards (aa-aj)
    const twoGramUrls = buildShardUrls(2).slice(0, 10) // First 10 URLs (aa-aj)
    logger.info(`Processing 2-gram with ${twoGramUrls.length} URLs`)
    
    const twoGramAgg = new Map<string, number>()
    for (let i = 0; i < twoGramUrls.length; i++) {
      const url = twoGramUrls[i]
      await processUrlAndAccumulate(url, 2, twoGramAgg)
      logger.info(`After ${url}: ${twoGramAgg.size} unique grams accumulated`)
      
      // Flush to storage every 3 URLs to prevent memory buildup
      if ((i + 1) % 3 === 0 || i === twoGramUrls.length - 1) {
        const tempFile = `${outPrefix}/temp_2gram_${i}.json`
        await storage.bucket().file(tempFile).save(JSON.stringify(Array.from(twoGramAgg.entries())))
        logger.info(`Flushed ${twoGramAgg.size} grams to ${tempFile}`)
        twoGramAgg.clear() // Clear memory
      }
    }
    
    // Merge 2-gram temporary files
    logger.info(`Merging 2-gram temporary files...`)
    const finalTwoGramAgg = new Map<string, number>()
    for (let i = 2; i < twoGramUrls.length; i += 3) {
      try {
        const tempFile = `${outPrefix}/temp_2gram_${i}.json`
        const [tempData] = await storage.bucket().file(tempFile).download()
        const entries = JSON.parse(tempData.toString()) as Array<[string, number]>
        
        for (const [gram, freq] of entries) {
          finalTwoGramAgg.set(gram, (finalTwoGramAgg.get(gram) || 0) + freq)
        }
        
        // Delete temporary file
        await storage.bucket().file(tempFile).delete()
        logger.info(`Merged 2-gram temp file ${i}, total unique grams: ${finalTwoGramAgg.size}`)
      } catch (e) {
        logger.error(`Error merging 2-gram temp file ${i}:`, e instanceof Error ? e : new Error(String(e)))
      }
    }
    
    logger.info(`2-gram aggregation complete, ${finalTwoGramAgg.size} unique grams found`)
    const twoGramTop = filterAndRank(finalTwoGramAgg, 2, 50000)
    logger.info(`2-gram filtering complete, ${twoGramTop.length} top grams selected`)
    await storage.bucket().file(`${outPrefix}/2gram_top.json`).save(JSON.stringify(twoGramTop))
    logger.info(`2-gram data saved to Firebase Storage`)
    
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


