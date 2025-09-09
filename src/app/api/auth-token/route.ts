import { NextResponse } from 'next/server'
import { GoogleAuth } from 'google-auth-library'
import { logger } from '@/libs/utils/logger'

export async function POST(request: Request) {
  try {
    const { targetUrl } = await request.json()
    
    if (!targetUrl) {
      return NextResponse.json({ error: 'targetUrl is required' }, { status: 400 })
    }

    logger.info('Getting auth token for:', targetUrl)
    const auth = new GoogleAuth()
    const client = await auth.getIdTokenClient(targetUrl)
    const headers = await client.getRequestHeaders()
    
    const token = headers.Authorization?.replace('Bearer ', '')
    logger.info('Auth token generated:', { success: !!token })
    
    return NextResponse.json({ token })
  } catch (error) {
    logger.error('Auth token error:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Failed to get auth token', details: String(error) }, { status: 500 })
  }
}
