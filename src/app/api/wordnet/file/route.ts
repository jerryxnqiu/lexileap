import { NextResponse } from 'next/server'
import { getStorage } from '@/libs/firebase/admin'
import { GoogleAuth } from 'google-auth-library'
import { getSecret } from '@/libs/firebase/secret'
import { logger } from '@/libs/utils/logger'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Optional proxy to private Cloud Run service if configured
    const base = await getSecret('lexileap-data-url')

    logger.info('Base:', { base })

    if (base) {
      const auth = new GoogleAuth()
      const client = await auth.getIdTokenClient(base)
      const headers = await client.getRequestHeaders()
      const upstream = await fetch(`${base}/api/wordnet/file`, { headers, cache: 'no-store' })
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
          'cache-control': 'no-store'
        }
      })
    }

    const storage = await getStorage()
    const file = storage.bucket().file('data/wordnet.json')
    const [exists] = await file.exists()
    if (!exists) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    logger.info('File exists:', { exists })


    const nodeStream = file.createReadStream()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        nodeStream.on('data', (chunk: Buffer) => {
          // Strip control chars except tabs/newlines/carriage returns
          const filtered = Buffer.from(
            Array.from(chunk).filter((b) => b === 9 || b === 10 || b === 13 || b >= 32)
          )
          controller.enqueue(new Uint8Array(filtered))
        })
        nodeStream.on('end', () => controller.close())
        nodeStream.on('error', (err: Error) => controller.error(err))
      }
    })
    return new Response(stream, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      }
    })
  } catch (error) {
    const message = (error as Error).message || 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}


