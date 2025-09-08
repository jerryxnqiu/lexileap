import { NextResponse } from 'next/server'
import { getStorage } from '@/libs/firebase/admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const storage = await getStorage()
    const file = storage.bucket().file('data/wordnet.json')
    const [exists] = await file.exists()
    if (!exists) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }
    const [contents] = await file.download()
    // Sanitize potential control characters that break JSON.parse on clients
    const text = Buffer.from(contents).toString('utf8')
    const sanitized = text.replace(/[\u0000-\u001F\u007F]/g, (ch) => {
      // preserve common whitespace; strip others
      return ch === '\n' || ch === '\r' || ch === '\t' ? ch : ''
    })
    return new Response(sanitized, {
      headers: { 'content-type': 'application/json; charset=utf-8' }
    })
  } catch (error) {
    const message = (error as Error).message || 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}


