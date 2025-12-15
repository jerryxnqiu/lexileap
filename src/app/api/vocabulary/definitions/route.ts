import { NextResponse } from 'next/server'
import { getDb } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'

export const dynamic = 'force-dynamic'

/*
step 2:
POST:       /api/vocabulary/definitions
Purpose:    Bulk fetch definitions/synonyms/antonyms from the dictionary collection.
Input body: { words: string[] }.
Output:     { success, definitions: { [word]: { definition, synonyms, antonyms } }, count }.

What it does:
- For each word (normalized to lowercase):
  - Reads "dictionary/{word}" document.
  - Returns { definition, synonyms, antonyms } (or null/empty if missing).
*/



export async function POST(request: Request) {
  try {
    const { words } = await request.json()
    
    if (!Array.isArray(words)) {
      return NextResponse.json({ error: 'words must be an array' }, { status: 400 })
    }

    const db = await getDb()
    const collection = db.collection('dictionary')
    
    const definitions: Record<string, any> = {}

    // Fetch definitions for all words in parallel - normalize to lowercase
    const promises = words.map(async (word: string) => {
      try {
        const normalizedWord = word.toLowerCase().trim()
        const docRef = collection.doc(normalizedWord)
        const doc = await docRef.get()
        
        // Use normalized (lowercase) word as key for consistency
        if (doc.exists) {
          const data = doc.data()
          definitions[normalizedWord] = {
            definition: data?.definition || null,
            synonyms: (data?.synonyms || []).map((s: string) => s.toLowerCase().trim()),
            antonyms: (data?.antonyms || []).map((a: string) => a.toLowerCase().trim())
          }
        } else {
          definitions[normalizedWord] = {
            definition: null,
            synonyms: [],
            antonyms: []
          }
        }
      } catch (error) {
        const normalizedWord = word.toLowerCase().trim()
        logger.warn(`Failed to load definition for "${normalizedWord}":`, { error: error instanceof Error ? error.message : String(error) })
        definitions[normalizedWord] = {
          definition: null,
          synonyms: [],
          antonyms: []
        }
      }
    })

    await Promise.all(promises)

    return NextResponse.json({
      success: true,
      definitions,
      count: Object.keys(definitions).length
    })
  } catch (error) {
    logger.error('Failed to load definitions:', error instanceof Error ? error.message : String(error))
    return NextResponse.json({
      error: 'Failed to load definitions',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
