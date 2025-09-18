import { NextResponse } from 'next/server'
import { GoogleAuth } from 'google-auth-library'
import { getSecret } from '@/libs/firebase/secret'
import { logger } from '@/libs/utils/logger'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    // Build absolute URL for internal call
    const xfHost = request.headers.get('x-forwarded-host')
    const xfProto = request.headers.get('x-forwarded-proto') || 'https'
    const base = xfHost ? `${xfProto}://${xfHost}` : new URL(request.url).origin

    // Trigger Compute Engine processing
    const response = await fetch(`${base}/api/google-ngram/trigger-compute`, {
      method: 'POST',
      cache: 'no-store'
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Compute Engine trigger error:', new Error(`Status ${response.status}: ${errorText}`))
      return NextResponse.json({ error: 'Failed to trigger Compute Engine processing', details: errorText }, { status: response.status })
    }

    const result = await response.json()
    return NextResponse.json(result)
  } catch (error) {
    logger.error('Generate trigger error:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
}