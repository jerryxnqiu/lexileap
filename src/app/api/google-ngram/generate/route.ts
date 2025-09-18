import { NextResponse } from 'next/server'
import { GoogleAuth } from 'google-auth-library'
import { getSecret } from '@/libs/firebase/secret'
import { logger } from '@/libs/utils/logger'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    // Trigger Compute Engine processing instead of Cloud Run
    const response = await fetch('/api/google-ngram/trigger-compute', {
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