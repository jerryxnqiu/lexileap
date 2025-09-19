import { NextResponse } from 'next/server'
import { logger } from '@/libs/utils/logger'
import { getDb, getStorage } from '@/libs/firebase/admin'
import { getSecret } from '@/libs/firebase/secret'
import { DictionaryEntry, WordData, DailyUsage } from '@/types/dictionary'

export const dynamic = 'force-dynamic'

// Rate limiting configuration for Stands4
const RATE_LIMIT_DELAY = 1000 // 1 second between API calls
const BATCH_SIZE = 1 // Process 1 word at a time (strict rate limit compliance)
const MAX_RETRIES = 3
const DAILY_LIMIT_STANDS4 = 100 // Stands4 daily limit

// Cache for API responses to avoid duplicate calls
const apiCache = new Map<string, any>()


async function getDailyUsage(db: FirebaseFirestore.Firestore): Promise<DailyUsage> {
  const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD format
  const usageDoc = db.collection('api_usage').doc(today)
  const snapshot = await usageDoc.get()
  
  if (snapshot.exists) {
    return snapshot.data() as DailyUsage
  }
  
  return {
    date: today,
    stands4Calls: 0
  }
}

async function updateDailyUsage(db: FirebaseFirestore.Firestore): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
  const usageDoc = db.collection('api_usage').doc(today)
  
  await usageDoc.set({
    date: today,
    stands4Calls: FirebaseFirestore.FieldValue.increment(1)
  }, { merge: true })
}

async function fetchWithRetry(url: string, maxRetries: number = MAX_RETRIES): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'LexiLeap/1.0 (Educational Vocabulary App)'
        }
      })
      
      if (response.ok) {
        return response
      }
      
      if (response.status === 429) {
        // Rate limited, wait longer
        const delay = Math.pow(2, attempt) * 1000
        logger.warn(`Rate limited, waiting ${delay}ms before retry ${attempt + 1}/${maxRetries}`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
      
      if (response.status >= 500) {
        // Server error, retry
        const delay = Math.pow(2, attempt) * 1000
        logger.warn(`Server error ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
      
      // Client error, don't retry
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    } catch (error) {
      if (attempt === maxRetries - 1) {
        throw error
      }
      const delay = Math.pow(2, attempt) * 1000
      logger.warn(`Request failed, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries}): ${error}`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  
  throw new Error(`Failed after ${maxRetries} attempts`)
}

async function getStands4Synonyms(word: string, db: FirebaseFirestore.Firestore): Promise<{ synonyms: string[], antonyms: string[] }> {
  const cacheKey = `stands4:${word}`
  if (apiCache.has(cacheKey)) {
    return apiCache.get(cacheKey)
  }

  // Check daily usage limit
  const usage = await getDailyUsage(db)
  if (usage.stands4Calls >= DAILY_LIMIT_STANDS4) {
    logger.warn(`Stands4 daily limit reached (${DAILY_LIMIT_STANDS4}). Skipping "${word}"`)
    const result = { synonyms: [], antonyms: [] }
    apiCache.set(cacheKey, result)
    return result
  }

  try {
    // Get API credentials from Secret Manager
    const uid = await getSecret('stands4-uid')
    const tokenid = await getSecret('stands4-tokenid')
    
    if (!uid || !tokenid) {
      logger.warn('Stands4 API credentials not configured')
      const result = { synonyms: [], antonyms: [] }
      apiCache.set(cacheKey, result)
      return result
    }

    const url = `https://www.stands4.com/services/v2/syno.php?uid=${uid}&tokenid=${tokenid}&word=${encodeURIComponent(word)}&format=json`
    const response = await fetchWithRetry(url)
    const data = await response.json()
    
    // Update usage counter
    await updateDailyUsage(db)
    
    const synonyms: string[] = []
    const antonyms: string[] = []
    
    if (data.results && Array.isArray(data.results)) {
      for (const item of data.results) {
        if (item.synonyms && typeof item.synonyms === 'string') {
          // synonyms is comma-delimited string
          const synonymList = item.synonyms.split(',').map((s: string) => s.trim()).filter(Boolean)
          synonyms.push(...synonymList)
        }
        if (item.antonyms && typeof item.antonyms === 'string') {
          // antonyms is comma-delimited string
          const antonymList = item.antonyms.split(',').map((a: string) => a.trim()).filter(Boolean)
          antonyms.push(...antonymList)
        }
      }
    }
    
    const result = { 
      synonyms: [...new Set(synonyms)].slice(0, 10), // Limit to 10 unique synonyms
      antonyms: [...new Set(antonyms)].slice(0, 10)  // Limit to 10 unique antonyms
    }
    
    apiCache.set(cacheKey, result)
    return result
  } catch (error) {
    logger.error(`Failed to fetch Stands4 data for "${word}":`, error instanceof Error ? error : new Error(String(error)))
    const result = { synonyms: [], antonyms: [] }
    apiCache.set(cacheKey, result)
    return result
  }
}

async function get1GramWordsFromStorage(): Promise<WordData[]> {
  try {
    const storage = await getStorage()
    const bucket = storage.bucket()

    // Try to get 1-gram words from storage
    const files = [
      'google-ngram/1gram_top.json'   // Fallback to 1-gram specific file
    ]

    for (const filePath of files) {
      try {
        const file = bucket.file(filePath)
        const [exists] = await file.exists()

        if (exists) {
          const [contents] = await file.download()
          const words: WordData[] = JSON.parse(contents.toString())
          
          // Filter for 1-gram words (no spaces) and high frequency
          const oneGramWords = words.filter(word => 
            !word.gram.includes(' ') && word.freq > 1000
          )
          
          logger.info(`Loaded ${oneGramWords.length} 1-gram words from ${filePath}`)
          return oneGramWords
        }
      } catch (error) {
        logger.warn(`Failed to load ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    throw new Error('No 1-gram word data found in storage')
  } catch (error) {
    logger.error('Failed to get 1-gram words from storage:', error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

export async function POST() {
  try {
    logger.info('Starting Stands4 dictionary preparation...')
    
    // Get Firebase Admin and Firestore
    const db = await getDb()
    
    // Check daily usage limits
    const usage = await getDailyUsage(db)
    if (usage.stands4Calls >= DAILY_LIMIT_STANDS4) {
      logger.warn('Stands4 daily limit reached. Stopping processing.')
      return NextResponse.json({ 
        success: false, 
        message: 'Stands4 daily limit reached. Processing will resume tomorrow.',
        dailyLimitsReached: true,
        usage
      })
    }
    
    // Get 1-gram words from storage
    const words = await get1GramWordsFromStorage()
    logger.info(`Found ${words.length} 1-gram words to process`)
    
    if (words.length === 0) {
      logger.info('No words need Stands4 processing')
      return NextResponse.json({ 
        success: true, 
        message: 'No words need Stands4 processing - all 1-gram words already have synonyms/antonyms',
        processed: 0,
        total: 0
      })
    }
    
    let processed = 0
    const total = words.length
    
    // Process words in batches
    while (processed < total) {
      // Check limits before each batch
      const currentUsage = await getDailyUsage(db)
      if (currentUsage.stands4Calls >= DAILY_LIMIT_STANDS4) {
        logger.warn('Stands4 daily limits reached during processing. Stopping.')
        break
      }

      const batch = words.slice(processed, processed + BATCH_SIZE)
      logger.info(`Processing batch: words ${processed + 1}-${Math.min(processed + BATCH_SIZE, total)} of ${total}`)

      for (const wordData of batch) {
        const word = wordData.gram.toLowerCase().trim()

        try {
          // Check if word already has synonyms processed
          const collection = db.collection('dictionary')
          const docRef = collection.doc(word)
          const doc = await docRef.get()
          
          if (doc.exists && doc.data()?.synonymsProcessed) {
            logger.info(`Skipping "${word}" - already processed for synonyms`)
            continue
          }

          logger.info(`Processing word: "${word}"`)

          // Fetch synonyms/antonyms
          const { synonyms, antonyms } = await getStands4Synonyms(word, db)

          // Create or update dictionary entry
          const entry: DictionaryEntry = {
            word,
            definition: doc.exists ? doc.data()?.definition : undefined, // Preserve existing definition
            synonyms,
            antonyms,
            frequency: wordData.freq,
            synonymsProcessed: true,
            lastUpdated: new Date()
          }

          // Save to Firestore
          await docRef.set(entry)
          logger.info(`Updated dictionary entry for "${word}": synonyms=${synonyms.length}, antonyms=${antonyms.length}`)

          // Rate limiting delay
          await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY))

        } catch (error) {
          logger.error(`Failed to process word "${word}":`, error instanceof Error ? error : new Error(String(error)))
          // Continue with next word instead of failing the entire batch
        }
      }

      processed += batch.length
      logger.info(`Progress: ${processed}/${total} words processed (${Math.round(processed / total * 100)}%)`)
    }
    
    logger.info('Stands4 dictionary preparation completed successfully')
    
    return NextResponse.json({ 
      success: true, 
      message: `Stands4 dictionary preparation completed. Processed ${processed} words.`,
      processed,
      total
    })
    
  } catch (error) {
    logger.error('Stands4 dictionary preparation failed:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ 
      error: 'Stands4 dictionary preparation failed', 
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
