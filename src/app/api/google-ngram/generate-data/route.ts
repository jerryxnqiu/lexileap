import { NextResponse } from 'next/server'
import { getDb, getStorage } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'
import type { storage as AdminStorage } from 'firebase-admin'

export const dynamic = 'force-dynamic'

function isAlpha(word: string): boolean { return /^[A-Za-z]+$/.test(word) }
function isCleanGram(tokens: string[]): boolean { return tokens.length>0 && tokens.every(t=>isAlpha(t)) }


const FREQUENCY_THRESHOLD = 5000 // Filter out grams with frequency below this

// Build shard URLs for Google Ngram
function buildShardUrls(n: 1 | 2 | 3 | 4 | 5): string[] {
  const base = `http://storage.googleapis.com/books/ngrams/books/googlebooks-eng-all-${n}gram-20120701-`
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  const urls: string[] = []
  if (n === 1) {
    for (let i = 0; i < letters.length; i++) urls.push(`${base}${letters[i]}.gz`)
  } else {
    for (let i = 0; i < letters.length; i++) {
      for (let j = 0; j < letters.length; j++) {
        urls.push(`${base}${letters[i]}${letters[j]}.gz`)
      }
    }
  }
  return urls
}

// Final ranking util used at merge step
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

async function processShardWithFlush(
  storage: AdminStorage.Storage,
  outPrefix: string,
  type: string,
  shardId: string,
  url: string,
  n: number
): Promise<Map<string, number>> {
  try {
    logger.info(`Processing URL: ${url}`)
    const res = await fetchWithRetry(url, { cache: 'no-store' })
    if (!res.ok || !res.body) {
      logger.error(`Fetch failed for ${url}: ${res.status} ${res.statusText}`)
      return new Map<string, number>()
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
    // Keep everything in memory - no temp files
    const agg = new Map<string, number>()
    
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
            
            // Add to aggregate - keep in memory
            const prev = agg.get(gram) ?? 0
            const newFreq = prev + match
            agg.set(gram, newFreq)
            
            // Remove if below threshold to save memory
            if (newFreq < FREQUENCY_THRESHOLD) {
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
              const prev = agg.get(gram) ?? 0
              const newFreq = prev + match
              agg.set(gram, newFreq)
              
              // Remove if below threshold to save memory
              if (newFreq < FREQUENCY_THRESHOLD) {
                agg.delete(gram)
              }
            }
          }
        }
      }
    }
    
    logger.info(`Completed ${url}, processed ${lineCount} lines, ${agg.size} unique grams for ${type}/${shardId}`)
    
    // Force garbage collection hint - the raw data is now out of scope
    if (global.gc) {
      global.gc()
    }
    return agg
  } catch (e) {
    logger.error('Process URL error:', e instanceof Error ? e : new Error(String(e)))
    return new Map<string, number>()
  }
}

export async function POST(request: Request) {
  try {
    // Parse body; if missing or runAll=true, start full job in background
    type RequestBody = { runAll?: boolean; type?: string; url?: string }
    let body: RequestBody | null = null
    try { body = await request.json() as RequestBody } catch {}

    const storage = await getStorage()
    const outPrefix = 'data/google-ngram'

    const runAll = !body || body.runAll === true

    if (runAll) {
      // Long-running, resumable processing with checkpointing and a time budget
      const db = await getDb()
      const checkpoints = db.collection('ngram_shards')
      const DEADLINE_MS = 55 * 60 * 1000 // ~55 minutes budget
      const startTime = Date.now()

      let processed = 0
      let skipped = 0
      let lastType: string | null = null
      let lastShard: string | null = null

      const types = ['1gram','2gram','3gram','4gram','5gram'] as const

      const isDone = async (type: string, shardId: string): Promise<boolean> => {
        const doc = await checkpoints.doc(`${type}_${shardId}`).get()
        return doc.exists && doc.get('status') === 'done'
      }

      const markDone = async (type: string, shardId: string, url: string) => {
        await checkpoints.doc(`${type}_${shardId}`).set({ status: 'done', url, updatedAt: new Date() })
      }

      // Process each n-gram type separately to combine all shards before final ranking
      for (const t of types) {
        const n = parseInt(t.replace('gram',''), 10) as 1|2|3|4|5
        const urls = buildShardUrls(n)
        logger.info(`(worker) Starting ${t} with ${urls.length} urls (resumable)`)
        
        // Aggregate for this n-gram type only
        const typeAgg = new Map<string, number>()
        
        for (const url of urls) {
          if (Date.now() - startTime > DEADLINE_MS) {
            logger.info('(worker) Time budget reached, returning progress')
            return NextResponse.json({ started: true, processed, skipped, lastType, lastShard, message: 'Partial progress, call again to resume' })
          }
          const shardId = url.split('/').pop()?.replace('.gz','') || 'unknown'
          lastType = t
          lastShard = shardId
          if (await isDone(t, shardId)) {
            skipped++
            continue
          }
          // Process shard and accumulate results for this type
          const shardResult = await processShardWithFlush(storage, outPrefix, t, shardId, url, n)
          // Merge shard results into type aggregate
          for (const [gram, freq] of shardResult.entries()) {
            typeAgg.set(gram, (typeAgg.get(gram) || 0) + freq)
          }
          await markDone(t, shardId, url)
          processed++
        }
        
        // Apply final threshold and ranking for this type
        const topCounts: Record<string, number> = { '1gram': 30000, '2gram': 10000, '3gram': 10000, '4gram': 10000, '5gram': 10000 }
        const top = filterAndRank(typeAgg, n, topCounts[t])
        await storage.bucket().file(`${outPrefix}/${t}_top.json`).save(JSON.stringify(top))
        logger.info(`(worker) Wrote ${t}_top.json (${top.length}) from ${typeAgg.size} total grams`)
      }


      try { await db.collection('system_jobs').doc('google_ngram_last_run').set({ ranAt: new Date() }) } catch {}
      logger.info('(worker) Google Ngram full job completed (resumable)')
      return NextResponse.json({ success: true, processed, skipped })
    }

    // Fallback: single-URL processing path (kept for direct calls)
    const type = body?.type as string | undefined
    const url = body?.url as string | undefined
    if (!type || !url) {
      return NextResponse.json({ error: 'Provide { type, url } or { runAll: true }' }, { status: 400 })
    }
    const n = parseInt(type.replace('gram',''), 10)
    const shardId = url.split('/').pop()?.replace('.gz', '') || 'unknown'
    const agg = await processShardWithFlush(storage, outPrefix, type, shardId, url, n)
    try { const db = await getDb(); await db.collection('system_jobs').doc('google_ngram_last_run').set({ ranAt: new Date() }) } catch {}
    return NextResponse.json({ success: true, type, shard: shardId, uniqueGrams: agg.size })
  } catch (error) {
    logger.error('Google Ngram generation error (data instance):', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Failed to prepare Google Ngram dataset' }, { status: 500 })
  }
}


