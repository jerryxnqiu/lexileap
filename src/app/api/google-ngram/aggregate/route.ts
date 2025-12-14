import { NextResponse } from 'next/server'
import { GoogleAuth } from 'google-auth-library'
import { getSecret } from '@/libs/firebase/secret'
import { logger } from '@/libs/utils/logger'

export const dynamic = 'force-dynamic'

// Proxy to lexileap-data service for aggregation (has 2Gi memory vs 512Mi in main service)
export async function POST() {
  try {
    const base = await getSecret('lexileap-data-url')
    
    if (!base) {
      return NextResponse.json({ error: 'Data processing service not configured' }, { status: 503 })
    }

    // Proxy to data-processing instance
    const auth = new GoogleAuth()
    const client = await auth.getIdTokenClient(base)
    const headers = await client.getRequestHeaders()
    
    const upstream = await fetch(`${base}/api/google-ngram/aggregate-data`, { 
      method: 'POST',
      headers, 
      cache: 'no-store',
      signal: AbortSignal.timeout(3600000) // 60 minutes timeout for aggregation
    })
    
    if (!upstream.ok) {
      const errorText = await upstream.text()
      logger.error('Data processing instance error:', new Error(`Status ${upstream.status}: ${errorText}`))
      return NextResponse.json({ error: 'Aggregation failed', details: errorText }, { status: upstream.status })
    }

    const result = await upstream.json()
    return NextResponse.json(result)
  } catch (error) {
    logger.error('Aggregation proxy error:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
}
