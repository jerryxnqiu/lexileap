import { NextResponse } from 'next/server'
import { GoogleAuth } from 'google-auth-library'
import { getSecret } from '@/libs/firebase/secret'
import { logger } from '@/libs/utils/logger'

export const dynamic = 'force-dynamic'

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
    // Get second instance URL
    const base = await getSecret('lexileap-data-url')
    
    if (!base) {
      return NextResponse.json({ error: 'Second instance not configured' }, { status: 503 })
    }

    // Start the job asynchronously - don't wait for completion
    const auth = new GoogleAuth()
    const client = await auth.getIdTokenClient(base)
    const headers = await client.getRequestHeaders()
    
    // Process URLs sequentially - send each URL individually for all n-grams (1-5)
    const ngramConfigs = [
      { type: '1gram', urls: buildShardUrls(1) },
      { type: '2gram', urls: buildShardUrls(2) },
      { type: '3gram', urls: buildShardUrls(3) },
      { type: '4gram', urls: buildShardUrls(4) },
      { type: '5gram', urls: buildShardUrls(5) }
    ]
    
    // Process all n-gram types sequentially
    for (const config of ngramConfigs) {
      logger.info(`Starting ${config.type} processing with ${config.urls.length} URLs`)
      
      for (const url of config.urls) {
        fetch(`${base}/api/google-ngram/generate-data`, { 
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ 
            type: config.type,
            url: url 
          }),
          cache: 'no-store'
        }).then(async (response) => {
          if (!response.ok) {
            const errorText = await response.text()
            logger.error(`${config.type} URL processing error for ${url}:`, new Error(`Status ${response.status}: ${errorText}`))
          } else {
            logger.info(`${config.type} URL processed successfully: ${url}`)
          }
        }).catch((error) => {
          logger.error(`${config.type} URL processing failed for ${url}:`, error instanceof Error ? error : new Error(String(error)))
        })
      }
    }

    // Return immediately to frontend
    logger.info('Google Ngram generation job started in background')
    return NextResponse.json({ 
      success: true, 
      message: 'Google Ngram generation started in background. Check logs for progress.' 
    })
  } catch (error) {
    logger.error('Generate proxy error:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
}