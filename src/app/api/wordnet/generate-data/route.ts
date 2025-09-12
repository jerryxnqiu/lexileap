import { NextResponse } from 'next/server'
import { generateWordNet } from '@/libs/wordnet/generator'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const result = await generateWordNet()
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const message = (error as Error).message || 'Unknown error'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
