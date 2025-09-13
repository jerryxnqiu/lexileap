import { NextResponse } from 'next/server'
import { GoogleAuth } from 'google-auth-library'
import { getSecret } from '@/libs/firebase/secret'
import { logger } from '@/libs/utils/logger'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    // Get second instance URL
    const base = await getSecret('lexileap-data-url')
    
    if (!base) {
      return NextResponse.json({ error: 'Data processing service not configured' }, { status: 503 })
    }

    // Get request body
    const body = await request.json()

    // Proxy to second instance
    const auth = new GoogleAuth()
    const client = await auth.getIdTokenClient(base)
    const headers = await client.getRequestHeaders()
    
    const upstream = await fetch(`${base}/api/quiz/generate-data`, { 
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(300000) // 5 minutes timeout for generation
    })
    
    if (!upstream.ok) {
      const errorText = await upstream.text()
      logger.error('Data processing instance error:', new Error(`Status ${upstream.status}: ${errorText}`))
      return NextResponse.json({ error: 'Quiz generation failed', details: errorText }, { status: upstream.status })
    }

    const result = await upstream.json()
    return NextResponse.json(result)
  } catch (error) {
    logger.error('Quiz generation proxy error:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
}