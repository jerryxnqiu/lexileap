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


async function aggregateFromUrls(urls: string[], n: number): Promise<Map<string, number>> {
  const agg = new Map<string, number>()
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok || !res.body) {
        logger.error(`Fetch failed for ${url}: ${res.status} ${res.statusText}`)
        continue
      }
      // Handle gzip (.gz) sources via Web Streams DecompressionStream when needed
      let stream: ReadableStream<Uint8Array> = res.body
      const contentEncoding = res.headers.get('content-encoding') || ''
      const contentType = res.headers.get('content-type') || ''
      const isGzip = url.endsWith('.gz') || /gzip/i.test(contentEncoding) || /application\/(x-)?gzip/i.test(contentType)
      try {
        if (isGzip && typeof DecompressionStream !== 'undefined') {
          stream = stream.pipeThrough(new DecompressionStream('gzip'))
        }
      } catch {}
      const reader = stream.getReader()
      const decoder = new TextDecoder('utf-8')
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          buf += decoder.decode(value, { stream: true })
          let idx: number
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx)
            buf = buf.slice(idx + 1)
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
              agg.set(gram, prev + match)
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
    } catch (e) {
      logger.error('Aggregate URL error:', e instanceof Error ? e : new Error(String(e)))
    }
  }
  return agg
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

    // Generate URLs for all n-grams (1-5)
    const cfgs: Array<{ urls: string[]; n: number; top: number }> = [
      { urls: buildShardUrls(1), n: 1, top: 20000 },  // 1-gram: top 20k
      { urls: buildShardUrls(2), n: 2, top: 100000 }, // 2-gram: top 100k
      { urls: buildShardUrls(3), n: 3, top: 100000 }, // 3-gram: top 100k
      { urls: buildShardUrls(4), n: 4, top: 100000 }, // 4-gram: top 100k
      { urls: buildShardUrls(5), n: 5, top: 100000 }  // 5-gram: top 100k
    ]
    
    for (const c of cfgs) {
      const agg = await aggregateFromUrls(c.urls, c.n)
      const top = filterAndRank(agg, c.n, c.top)
      await storage.bucket().file(`${outPrefix}/${c.n}gram_top.json`).save(JSON.stringify(top))
    }
    
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


