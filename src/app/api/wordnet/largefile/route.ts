import { NextResponse } from 'next/server'
import { getStorage } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'

export const dynamic = 'force-dynamic'


export async function GET(request: Request) {
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
    
    const url = new URL(request.url)
    const full = url.searchParams.get('full') === '1'
    const pageParam = url.searchParams.get('page')
    const pageSizeParam = url.searchParams.get('pageSize')

    if (full) {
      logger.info('Returning full dataset')
      return NextResponse.json(jsonData, {
        headers: { 'cache-control': 'no-store' }
      })
    }

    // Pagination (default 50 per page)
    const allKeys = Object.keys(jsonData)
    const total = allKeys.length
    const page = Math.max(1, parseInt(pageParam || '1', 10))
    const pageSize = Math.min(200, Math.max(1, parseInt(pageSizeParam || '50', 10)))
    const start = (page - 1) * pageSize
    const words = allKeys.slice(start, start + pageSize)
    const items = words.map(word => {
      const entry = jsonData[word]
      let definition: string | undefined
      let pos: string | undefined
      let examples: string[] | undefined
      try {
        if (entry && entry.senses && Array.isArray(entry.senses) && entry.senses.length > 0) {
          const s = entry.senses[0]
          definition = s.definition
          pos = entry.pos
          if (s.examples && Array.isArray(s.examples)) examples = s.examples.slice(0, 2)
        }
      } catch {}
      return { word, definition, pos, examples }
    })
    logger.info('Returning paginated words:', { page, pageSize, count: words.length, total })
    return NextResponse.json({ total, page, pageSize, items }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    const message = (error as Error).message || 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
