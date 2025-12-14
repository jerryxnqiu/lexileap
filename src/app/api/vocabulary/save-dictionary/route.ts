import { NextResponse } from 'next/server'
import { getDb } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'
import { DictionaryEntry } from '@/types/dictionary'

export const dynamic = 'force-dynamic'

interface VocabularyItem {
  gram: string
  freq: number
  definition?: string
  synonyms?: string[]
  antonyms?: string[]
}

export async function POST(request: Request) {
  try {
    const { items } = await request.json()
    
    if (!Array.isArray(items)) {
      return NextResponse.json({ error: 'items must be an array' }, { status: 400 })
    }

    const db = await getDb()
    const collection = db.collection('dictionary')
    
    let saved = 0
    let updated = 0
    let skipped = 0

    logger.info(`Starting to save ${items.length} vocabulary items to dictionary`)

    // Process all items - ensure lowercase
    for (const item of items) {
      const text = item.gram?.toLowerCase().trim()
      if (!text) {
        skipped++
        continue
      }

      try {
        const docRef = collection.doc(text)
        const doc = await docRef.get()

        // Prepare entry data - ensure all fields are lowercased
        const entry: DictionaryEntry = {
          word: text.toLowerCase().trim(),
          definition: item.definition || undefined,
          synonyms: (item.synonyms || []).map((s: string) => s.toLowerCase().trim()),
          antonyms: (item.antonyms || []).map((a: string) => a.toLowerCase().trim()),
          frequency: item.freq || 0,
          synonymsProcessed: true,
          lastUpdated: new Date()
        }

        // Remove undefined values before saving to Firestore
        const firestoreEntry = Object.fromEntries(
          Object.entries(entry).filter(([, value]) => value !== undefined)
        )

        if (doc.exists) {
          // Update existing entry
          await docRef.set(firestoreEntry, { merge: true })
          updated++
          logger.info(`Updated dictionary entry for "${text}"`)
        } else {
          // Create new entry
          await docRef.set(firestoreEntry)
          saved++
          logger.info(`Saved new dictionary entry for "${text}"`)
        }
      } catch (error) {
        logger.error(`Failed to save item "${text}":`, error instanceof Error ? error : new Error(String(error)))
        skipped++
      }
    }

    logger.info(`Dictionary save completed: ${saved} new, ${updated} updated, ${skipped} skipped`)

    return NextResponse.json({
      success: true,
      message: `Saved ${saved} new entries, updated ${updated} existing entries`,
      saved,
      updated,
      skipped,
      total: items.length
    })
  } catch (error) {
    logger.error('Failed to save vocabulary to dictionary:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({
      error: 'Failed to save vocabulary to dictionary',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
