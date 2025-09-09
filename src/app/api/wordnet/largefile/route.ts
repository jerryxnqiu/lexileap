import { NextResponse } from 'next/server'
import { getStorage } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'

export const dynamic = 'force-dynamic'


export async function GET() {
  try {
    // Direct GCS access for large file processing
    const storage = await getStorage()
    const file = storage.bucket().file('data/wordnet.json')
    const [exists] = await file.exists()
    if (!exists) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    logger.info('Large file exists:', { exists })

    // Read the entire file and process it
    const [data] = await file.download()
    const jsonString = data.toString('utf8')
    const jsonData = JSON.parse(jsonString)
    
    // Get top 10 words (first 10 entries)
    const words = Object.keys(jsonData)
    const top10Words = words.slice(0, 10)
    
    // Create response with just the top 10 words
    const top10Data: Record<string, unknown> = {}
    top10Words.forEach(word => {
      top10Data[word] = jsonData[word]
    })
    
    logger.info('Returning top 10 words:', { count: top10Words.length, words: top10Words })
    
    return NextResponse.json(top10Data, {
      headers: {
        'cache-control': 'no-store'
      }
    })
  } catch (error) {
    const message = (error as Error).message || 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
