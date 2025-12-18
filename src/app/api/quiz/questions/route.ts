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
    
    // Get total count
    const totalSnapshot = await db.collection('quiz_questions').count().get()
    const total = totalSnapshot.data().count

    // For Firestore, we'll use offset-based pagination (works fine for moderate datasets)
    // Note: offset() can be slow for large offsets, but for vocabulary review it should be acceptable
    const offset = (page - 1) * pageSize
    
    // Fetch paginated questions, ordered by word for consistency
    let query = db.collection('quiz_questions')
      .orderBy('word', 'asc')
      .limit(pageSize)
    
    // Use offset for pagination (Firestore supports this)
    if (offset > 0) {
      query = query.offset(offset) as any
    }
    
    const snapshot = await query.get()

    const items = snapshot.docs.map(doc => {
      const data = doc.data()
      return {
        word: data.word || '',
        definition: data.correctDefinition || '',
        options: data.options || [],
        correctIndex: data.correctIndex ?? 0,
        timesTested: data.timesTested || 0,
        timesCorrect: data.timesCorrect || 0,
        lastUsed: data.lastUsed?.toDate ? data.lastUsed.toDate().toISOString() : null
      }
    })

    return NextResponse.json({
      total,
      page,
      pageSize,
      items
    })
  } catch (error) {
    logger.error('Quiz questions fetch error:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Failed to load quiz questions' }, { status: 500 })
  }
}
