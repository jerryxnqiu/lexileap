import { NextResponse } from 'next/server'
import { GoogleAuth } from 'google-auth-library'
import { getSecret } from '@/libs/firebase/secret'
import { logger } from '@/libs/utils/logger'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    // Get second instance URL
    const base = await getSecret('lexileap-data-url')
    
    if (!base) {
      return NextResponse.json({ error: 'Second instance not configured' }, { status: 503 })
    }

    // Proxy to second instance unified runner (runAll)
    const auth = new GoogleAuth()
    const client = await auth.getIdTokenClient(base)
    const headers = await client.getRequestHeaders()

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const fetchWithRetry = async (attempts = 5): Promise<Response> => {
      let delay = 500
      for (let i = 0; i < attempts; i++) {
        try {
          return await fetch(`${base}/api/google-ngram/generate-data`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ runAll: true }),
            cache: 'no-store'
          })
        } catch (e) {
          if (i === attempts - 1) throw e
          await sleep(delay + Math.floor(Math.random() * 250))
          delay *= 2
        }
      }
      // Should not reach here
      throw new Error('unreachable')
    }

    const upstream = await fetchWithRetry()

    if (!upstream.ok) {
      const errorText = await upstream.text()
      logger.error('Data processing instance error:', new Error(`Status ${upstream.status}: ${errorText}`))
      return NextResponse.json({ error: 'Data processing failed', details: errorText }, { status: upstream.status })
    }

    const result = await upstream.json()
    return NextResponse.json(result)
  } catch (error) {
    logger.error('Generate proxy error:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
}