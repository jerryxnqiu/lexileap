import { NextResponse } from 'next/server'
import { getDb, getStorage } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'
import type { storage as AdminStorage } from 'firebase-admin'

export const dynamic = 'force-dynamic'

function isAlpha(word: string): boolean { return /^[A-Za-z]+$/.test(word) }
function isCleanGram(tokens: string[]): boolean { return tokens.length>0 && tokens.every(t=>isAlpha(t)) }

// Control memory by flushing partial aggregates at a fixed size
const AGG_SIZE_LIMIT = 25_000

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
): Promise<{ parts: number; totalLines: number }> {
  try {
    logger.info(`Processing URL: ${url}`)
    const res = await fetchWithRetry(url, { cache: 'no-store' })
    if (!res.ok || !res.body) {
      logger.error(`Fetch failed for ${url}: ${res.status} ${res.statusText}`)
      return { parts: 0, totalLines: 0 }
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
    let partIndex = 0
    // Single aggregate map; flush when it grows beyond the limit
    const agg = new Map<string, number>()

    const flushAgg = async () => {
      if (agg.size === 0) return
      const tempFile = `${outPrefix}/temp_${type}_${shardId}_part${partIndex++}.json`
      await storage.bucket().file(tempFile).save(JSON.stringify(Array.from(agg.entries())))
      logger.info(`Flushed part ${partIndex} for ${type}/${shardId}: ${agg.size} grams -> ${tempFile}`)
      agg.clear()
      if (global.gc) global.gc()
    }
    
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
            
            // Add to aggregate, flush when large
            const prev = agg.get(gram) ?? 0
            agg.set(gram, prev + match)
            if (agg.size > AGG_SIZE_LIMIT) {
              await flushAgg()
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
            }
          }
        }
      }
    }
    
    // Final flush of remaining aggregate
    await flushAgg()

    logger.info(`Completed ${url}, processed ${lineCount} lines, flushed ${partIndex} parts for ${type}/${shardId}`)
    
    // Force garbage collection hint - the raw data is now out of scope
    if (global.gc) {
      global.gc()
    }
    return { parts: partIndex, totalLines: lineCount }
  } catch (e) {
    logger.error('Process URL error:', e instanceof Error ? e : new Error(String(e)))
    return { parts: 0, totalLines: 0 }
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

      const cleanShardTemps = async (type: string, shardId: string) => {
        const [oldTemps] = await storage.bucket().getFiles({ prefix: `${outPrefix}/temp_${type}_${shardId}_` })
        for (const f of oldTemps) { try { await f.delete() } catch {} }
      }

      for (const t of types) {
        const n = parseInt(t.replace('gram',''), 10) as 1|2|3|4|5
        const urls = buildShardUrls(n)
        logger.info(`(worker) Starting ${t} with ${urls.length} urls (resumable)`)      
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
          // Remove any previous partial temps to avoid double counting
          await cleanShardTemps(t, shardId)
          await processShardWithFlush(storage, outPrefix, t, shardId, url, n)
          await markDone(t, shardId, url)
          processed++
        }
      }

      // Merge step (only when all shards done)
      const topCounts: Record<string, number> = { '1gram': 30000, '2gram': 10000, '3gram': 10000, '4gram': 10000, '5gram': 10000 }
      for (const t of ['1gram','2gram','3gram','4gram','5gram']) {
        const n = parseInt(t.replace('gram',''), 10)
        const [files] = await storage.bucket().getFiles({ prefix: `${outPrefix}/temp_${t}_` })
        logger.info(`(worker) Merging ${files.length} files for ${t}`)
        const agg = new Map<string, number>()
        for (const f of files) {
          try {
            const [data] = await f.download()
            const entries = JSON.parse(data.toString()) as Array<[string, number]>
            for (const [gram, freq] of entries) {
              agg.set(gram, (agg.get(gram) || 0) + freq)
            }
          } catch (e) {
            logger.error(`(worker) Failed reading ${f.name}:`, e instanceof Error ? e : new Error(String(e)))
          }
        }
        const top = filterAndRank(agg, n, topCounts[t])
        await storage.bucket().file(`${outPrefix}/${t}_top.json`).save(JSON.stringify(top))
        for (const f of files) { try { await f.delete() } catch {} }
        logger.info(`(worker) Wrote ${t}_top.json (${top.length}) and cleaned temps`)
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
    const { parts, totalLines } = await processShardWithFlush(storage, outPrefix, type, shardId, url, n)
    try { const db = await getDb(); await db.collection('system_jobs').doc('google_ngram_last_run').set({ ranAt: new Date() }) } catch {}
    return NextResponse.json({ success: true, type, shard: shardId, parts, totalLines })
  } catch (error) {
    logger.error('Google Ngram generation error (data instance):', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Failed to prepare Google Ngram dataset' }, { status: 500 })
  }
}


