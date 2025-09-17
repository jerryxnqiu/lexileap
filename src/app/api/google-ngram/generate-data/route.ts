import { NextResponse } from 'next/server'
import { getDb, getStorage } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'
import type { storage as AdminStorage } from 'firebase-admin'

export const dynamic = 'force-dynamic'

function isAlpha(word: string): boolean { return /^[A-Za-z]+$/.test(word) }
function isCleanGram(tokens: string[]): boolean { return tokens.length>0 && tokens.every(t=>isAlpha(t)) }

// Control memory by flushing partial aggregates via per-letter buckets
const BUCKET_SIZE_LIMIT = 25_000

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
    // Use per-letter buckets to keep memory usage even lower
    const buckets = new Map<string, Map<string, number>>()

    const flushBucket = async (bucketKey: string, bucket: Map<string, number>) => {
      if (bucket.size === 0) return
      const tempFile = `${outPrefix}/temp_${type}_${shardId}_${bucketKey}_part${partIndex++}.json`
      await storage.bucket().file(tempFile).save(JSON.stringify(Array.from(bucket.entries())))
      logger.info(`Flushed bucket ${bucketKey} part ${partIndex} for ${type}/${shardId}: ${bucket.size} grams -> ${tempFile}`)
      bucket.clear()
      if (global.gc) global.gc()
    }

    const flushAllBuckets = async () => {
      for (const [bucketKey, bucket] of buckets.entries()) {
        if (bucket.size > 0) {
          await flushBucket(bucketKey, bucket)
        }
      }
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
            
            // Use first letter as bucket key to distribute memory usage
            const bucketKey = gram.charAt(0).toLowerCase()
            if (!buckets.has(bucketKey)) {
              buckets.set(bucketKey, new Map<string, number>())
            }
            const bucket = buckets.get(bucketKey)!
            const prev = bucket.get(gram) ?? 0
            bucket.set(gram, prev + match)

            // Flush individual buckets when they get too large
            if (bucket.size > BUCKET_SIZE_LIMIT) {
              await flushBucket(bucketKey, bucket)
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
              const bucketKey = gram.charAt(0).toLowerCase()
              if (!buckets.has(bucketKey)) {
                buckets.set(bucketKey, new Map<string, number>())
              }
              const bucket = buckets.get(bucketKey)!
              bucket.set(gram, (bucket.get(gram) ?? 0) + match)
            }
          }
        }
      }
    }
    
    // Final flush of all remaining buckets
    await flushAllBuckets()

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

    // Process single URL with periodic flushes (no threshold here)
    logger.info(`Processing ${type} URL: ${url}`)
    const shardId = url.split('/').pop()?.replace('.gz', '') || 'unknown'
    const { parts, totalLines } = await processShardWithFlush(storage, outPrefix, type, shardId, url, n)
    
    try {
      const db = await getDb()
      await db.collection('system_jobs').doc('google_ngram_last_run').set({ ranAt: new Date() })
    } catch {}
    
    logger.info('Shard processed successfully (data instance)')
    return NextResponse.json({ success: true, type, shard: shardId, parts, totalLines })
  } catch (error) {
    logger.error('Google Ngram generation error (data instance):', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Failed to prepare Google Ngram dataset' }, { status: 500 })
  }
}


