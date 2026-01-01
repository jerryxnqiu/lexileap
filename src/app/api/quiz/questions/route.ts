import { NextResponse, NextRequest } from 'next/server'
import { getDb } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1', 10)
    const pageSize = parseInt(searchParams.get('pageSize') || '50', 10)
    
    if (page < 1 || pageSize < 1 || pageSize > 100) {
      return NextResponse.json({ error: 'Invalid pagination parameters' }, { status: 400 })
    }

    const db = await getDb()
    
    // Get total count of dictionary entries with definitions
    const totalSnapshot = await db.collection('dictionary')
      .where('definition', '!=', null)
      .count()
      .get()
    const total = totalSnapshot.data().count

    // Calculate pagination
    const offset = (page - 1) * pageSize
    
    // Fetch paginated dictionary entries
    // Note: In dictionary collection, the document ID is the word itself
    // We'll fetch all and sort client-side, or use a different approach
    // For now, we'll fetch with limit and offset (Firestore supports this)
    let query = db.collection('dictionary')
      .where('definition', '!=', null)
      .limit(pageSize)
    
    // Use offset for pagination
    if (offset > 0) {
      query = query.offset(offset) as any
    }
    
    const snapshot = await query.get()

    const items = snapshot.docs
      .map(doc => {
        const data = doc.data()
        const word = doc.id.toLowerCase().trim() // Document ID is the word
        return {
          word: word,
          definition: data.definition || '',
          synonyms: Array.isArray(data.synonyms) ? data.synonyms : [],
          antonyms: Array.isArray(data.antonyms) ? data.antonyms : [],
          frequency: typeof data.frequency === 'number' ? data.frequency : 0,
          rank: typeof data.rank === 'number' ? data.rank : undefined,
          lastUpdated: data.lastUpdated?.toDate ? data.lastUpdated.toDate().toISOString() : null
        }
      })
      .sort((a, b) => a.word.localeCompare(b.word)) // Sort alphabetically

    return NextResponse.json({
      total,
      page,
      pageSize,
      items
    })
  } catch (error) {
    logger.error('Dictionary fetch error:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Failed to load dictionary' }, { status: 500 })
  }
}
