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

    // Start the job asynchronously - don't wait for completion
    const auth = new GoogleAuth()
    const client = await auth.getIdTokenClient(base)
    const headers = await client.getRequestHeaders()
    
    // Fire and forget - start the job in background
    fetch(`${base}/api/google-ngram/generate-data`, { 
      method: 'POST',
      headers, 
      cache: 'no-store',
      signal: AbortSignal.timeout(3_600_000) // 60 minutes timeout for generation (multiple URLs)
    }).then(async (response) => {
      if (!response.ok) {
        const errorText = await response.text()
        logger.error('Background data processing error:', new Error(`Status ${response.status}: ${errorText}`))
      } else {
        logger.info('Background Google Ngram generation completed successfully')
      }
    }).catch((error) => {
      logger.error('Background data processing failed:', error instanceof Error ? error : new Error(String(error)))
    })

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