import { NextResponse, NextRequest } from 'next/server'
import { getDb, getStorage } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'
import { WordData } from '@/types/dictionary'

export const dynamic = 'force-dynamic'

// Cache for ngram rank lookup (load once per request)
let rankCache: Map<string, number> | null = null

async function getRankCache(): Promise<Map<string, number>> {
  if (rankCache) return rankCache
  
  rankCache = new Map<string, number>()
  try {
    const storage = await getStorage()
    const bucket = storage.bucket()
    
    // Load words.json and phrases.json to build rank lookup
    const files = ['data/words.json', 'data/phrases.json']
    
    for (const filePath of files) {
      try {
        const file = bucket.file(filePath)
        const [exists] = await file.exists()
        if (exists) {
          const [contents] = await file.download()
          const data: WordData[] = JSON.parse(contents.toString())
          // Add ranks based on position (already sorted by frequency descending)
          data.forEach((item, index) => {
            const key = item.gram.toLowerCase().trim()
            rankCache!.set(key, index + 1)
          })
          logger.info(`Loaded ranks from ${filePath}: ${data.length} items`)
        }
      } catch (error) {
        logger.warn(`Failed to load ${filePath} for rank lookup`, { 
          error: error instanceof Error ? error.message : String(error) 
        })
      }
    }
  } catch (error) {
    logger.error('Failed to build rank cache:', error instanceof Error ? error : new Error(String(error)))
  }
  
  return rankCache
}

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
    
    // Build rank cache for looking up missing ranks
    const rankLookup = await getRankCache()

    const items = snapshot.docs
      .map(doc => {
        const data = doc.data()
        const word = doc.id.toLowerCase().trim() // Document ID is the word
        // Get rank from database, or look it up from ngram data if missing
        let rank = typeof data.rank === 'number' ? data.rank : undefined
        if (!rank) {
          rank = rankLookup.get(word)
          // If we found a rank, update the database entry (async, don't await)
          if (rank !== undefined) {
            doc.ref.update({ rank }).catch((error: unknown) => {
              logger.warn(`Failed to update rank for "${word}"`, { 
                error: error instanceof Error ? error.message : String(error) 
              })
            })
          }
        }
        return {
          word: word,
          definition: data.definition || '',
          synonyms: Array.isArray(data.synonyms) ? data.synonyms : [],
          antonyms: Array.isArray(data.antonyms) ? data.antonyms : [],
          frequency: typeof data.frequency === 'number' ? data.frequency : 0,
          rank: rank,
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
