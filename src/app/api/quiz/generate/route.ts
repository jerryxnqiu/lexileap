import { NextResponse } from 'next/server'
import { GoogleAuth } from 'google-auth-library'
import { getSecret } from '@/libs/firebase/secret'
import { logger } from '@/libs/utils/logger'

export const dynamic = 'force-dynamic'

// POST handler: proxies to data-processing instance (external Cloud Run)
// Uses POST to avoid URL length limits when sending 200 words
export async function POST(request: Request) {
  try {
    const base = await getSecret('lexileap-data-url')
    if (!base) {
      return NextResponse.json({ error: 'Data processing service not configured' }, { status: 503 })
    }

    const body = await request.json()
    const { userId, words } = body

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    const auth = new GoogleAuth()
    const client = await auth.getIdTokenClient(base)
    const headers = await client.getRequestHeaders()

    logger.info('SSE: Proxying to data-processing instance', { base, userId, words })
    const upstream = await fetch(`${base}/api/quiz/generate-stream`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId, words }),
      cache: 'no-store'
    })

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '')
      logger.error('SSE upstream error:', new Error(`Status ${upstream.status}: ${text}`))
      return NextResponse.json({ error: 'Upstream SSE failed' }, { status: 502 })
    }

    // Pipe upstream SSE to client
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const reader = upstream.body!.getReader()
        const pump = (): Promise<void> => reader.read().then(({ done, value }) => {
          if (done) {
            controller.close()
            return
          }
          if (value) controller.enqueue(value)
          return pump()
        }).catch((err: unknown) => {
          logger.error('SSE proxy read error:', err instanceof Error ? err : new Error(String(err)))
          controller.close()
        })
        return pump()
      }
    })

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive'
      }
    })
  } catch (error) {
    logger.error('SSE POST proxy error:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
}