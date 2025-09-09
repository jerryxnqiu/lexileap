import { NextResponse } from 'next/server'
import { GoogleAuth } from 'google-auth-library'

export async function POST(request: Request) {
  try {
    const { targetUrl } = await request.json()
    
    if (!targetUrl) {
      return NextResponse.json({ error: 'targetUrl is required' }, { status: 400 })
    }

    const auth = new GoogleAuth()
    const client = await auth.getIdTokenClient(targetUrl)
    const headers = await client.getRequestHeaders()
    
    return NextResponse.json({ token: headers.Authorization?.replace('Bearer ', '') })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to get auth token' }, { status: 500 })
  }
}
