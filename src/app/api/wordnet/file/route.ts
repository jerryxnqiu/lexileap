import { NextResponse } from 'next/server'
import { getStorage } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'

export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type'
    }
  })
}

export async function GET() {
  try {
    // Direct GCS access (no more proxy needed)
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
        'cache-control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type'
      }
    })
  } catch (error) {
    const message = (error as Error).message || 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}


