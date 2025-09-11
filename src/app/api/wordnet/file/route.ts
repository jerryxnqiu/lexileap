import { NextResponse } from 'next/server'
import { GoogleAuth } from 'google-auth-library'
import { getSecret } from '@/libs/firebase/secret'
import { logger } from '@/libs/utils/logger'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    // Get second instance URL
    const base = await getSecret('lexileap-data-url')
    
    if (!base) {
      return NextResponse.json({ error: 'Second instance not configured' }, { status: 503 })
    }

    // Proxy to second instance
    const auth = new GoogleAuth()
    const client = await auth.getIdTokenClient(base)
    const headers = await client.getRequestHeaders()
    
    const url = new URL(request.url)
    const full = url.searchParams.get('full') === '1'
    const page = url.searchParams.get('page')
    const pageSize = url.searchParams.get('pageSize')
    const qs = full ? 'full=1' : `page=${encodeURIComponent(page || '1')}&pageSize=${encodeURIComponent(pageSize || '50')}`
    const upstream = await fetch(`${base}/api/wordnet/largefile?${qs}`, { 
      headers, 
      cache: 'no-store',
      signal: AbortSignal.timeout(30000)
    })
    
    if (!upstream.ok) {
      return NextResponse.json({ error: 'Second instance unavailable' }, { status: 503 })
    }

    // Stream response from second instance
    return new Response(upstream.body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      }
    })
  } catch (error) {
    logger.error('Proxy error:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
}


