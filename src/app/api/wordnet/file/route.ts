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
    const body = new Uint8Array(contents)
    return new Response(body, {
      headers: { 'content-type': 'application/json; charset=utf-8' }
    })
  } catch (error) {
    const message = (error as Error).message || 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}


