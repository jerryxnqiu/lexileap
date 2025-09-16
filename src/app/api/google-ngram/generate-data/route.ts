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

// NOTE: This function is used to process a single URL and accumulate the results.
// only keep words above frequency threshold to manage memory
async function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)) }

async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 5): Promise<Response> {
  let attempt = 0
  let delayMs = 1000
  while (true) {
    try {
      const res = await fetch(url, init)
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt < maxRetries) {
          await sleep(delayMs + Math.floor(Math.random()*250))
          attempt++
          delayMs *= 2
          continue
        }
      }
      return res
    } catch (e) {
      if (attempt < maxRetries) {
        await sleep(delayMs + Math.floor(Math.random()*250))
        attempt++
        delayMs *= 2
        continue
      }
      throw e
    }
  }
}

async function processUrlAndAccumulate(url: string, n: number, agg: Map<string, number>, minFrequency: number = 5000): Promise<void> {
  try {
    logger.info(`Processing URL: ${url}`)
    const res = await fetchWithRetry(url, { cache: 'no-store' })
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
            
            // Accumulate always; count once when first crossing minFrequency
            agg.set(gram, newTotal)
            if (prev < minFrequency && newTotal >= minFrequency) {
              processedCount++
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

export async function POST(request: Request) {
  try {
    // Get single URL from request body
    let type: string
    let url: string
    
    try {
      const body = await request.json()
      type = body.type
      url = body.url
      logger.info(`Received ${type} URL: ${url}`)
    } catch {
      logger.error('Failed to parse request body - type and url must be provided')
      return NextResponse.json({ error: 'type and url must be provided in request body' }, { status: 400 })
    }
    
    if (!type || !url) {
      logger.error('Missing required type or url in request body')
      return NextResponse.json({ error: 'type and url are required' }, { status: 400 })
    }
    
    const storage = await getStorage()
    const outPrefix = 'data/google-ngram'
    const n = parseInt(type.replace('gram', '')) // Extract n from '1gram', '2gram', etc.

    // Process single URL
    logger.info(`Processing ${type} URL: ${url}`)
    
    const agg = new Map<string, number>()
    await processUrlAndAccumulate(url, n, agg)
    logger.info(`Completed ${url}, ${agg.size} unique grams found`)
    
    // Save individual URL results and return metadata for orchestrator
    const shardId = url.split('/').pop()?.replace('.gz', '') || 'unknown'
    const tempFile = `${outPrefix}/temp_${type}_${shardId}.json`
    await storage.bucket().file(tempFile).save(JSON.stringify(Array.from(agg.entries())))
    logger.info(`Saved ${agg.size} grams to ${tempFile}`)
    
    try {
      const db = await getDb()
      await db.collection('system_jobs').doc('google_ngram_last_run').set({ ranAt: new Date() })
    } catch {}
    
    logger.info('Shard processed successfully (data instance)')
    return NextResponse.json({ success: true, type, shard: shardId, count: agg.size, path: tempFile })
  } catch (error) {
    logger.error('Google Ngram generation error (data instance):', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Failed to prepare Google Ngram dataset' }, { status: 500 })
  }
}


