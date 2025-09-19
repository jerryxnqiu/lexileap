import { NextResponse } from 'next/server'
import { logger } from '@/libs/utils/logger'
import { getDb, getStorage } from '@/libs/firebase/admin'
import { WordData, DictionaryEntry } from '@/types/dictionary'

export const dynamic = 'force-dynamic'

// Rate limiting configuration for Wiktionary
const RATE_LIMIT_DELAY = 500 // 0.5 second between API calls (faster for Wiktionary)
const BATCH_SIZE = 1 // Process 1 words at a time for Wiktionary
const MAX_RETRIES = 3

// Cache for API responses to avoid duplicate calls
const apiCache = new Map<string, string | null>()

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

function extractWiktionaryDefinition(htmlContent: string, word: string): string | null {
  try {
    // Look for English section first
    const englishMatch = htmlContent.match(/<h2[^>]*>English<\/h2>([\s\S]*?)(?=<h2|<h3|$)/)
    if (!englishMatch) {
      return null
    }
    
    const englishSection = englishMatch[1]
    
    // Look for verb definitions first (most common)
    const verbMatch = englishSection.match(/<h[34][^>]*>Verb<\/h[34]>([\s\S]*?)(?=<h[345]|$)/)
    if (verbMatch) {
      const verbSection = verbMatch[1]
      // Extract first definition from ordered list, handling nested content
      const firstDefMatch = verbSection.match(/<li[^>]*>([^<]+(?:<[^>]+>[^<]*<\/[^>]+>[^<]*)*?)(?=<li|$)/)
      if (firstDefMatch) {
        return cleanDefinition(firstDefMatch[1])
      }
    }
    
    // Look for noun definitions
    const nounMatch = englishSection.match(/<h[34][^>]*>Noun<\/h[34]>([\s\S]*?)(?=<h[345]|$)/)
    if (nounMatch) {
      const nounSection = nounMatch[1]
      const firstDefMatch = nounSection.match(/<li[^>]*>([^<]+(?:<[^>]+>[^<]*<\/[^>]+>[^<]*)*?)(?=<li|$)/)
      if (firstDefMatch) {
        return cleanDefinition(firstDefMatch[1])
      }
    }
    
    // Look for adverb definitions
    const adverbMatch = englishSection.match(/<h[34][^>]*>Adverb<\/h[34]>([\s\S]*?)(?=<h[345]|$)/)
    if (adverbMatch) {
      const adverbSection = adverbMatch[1]
      const firstDefMatch = adverbSection.match(/<li[^>]*>([^<]+(?:<[^>]+>[^<]*<\/[^>]+>[^<]*)*?)(?=<li|$)/)
      if (firstDefMatch) {
        return cleanDefinition(firstDefMatch[1])
      }
    }
    
    // Look for adjective definitions
    const adjectiveMatch = englishSection.match(/<h[34][^>]*>Adjective<\/h[34]>([\s\S]*?)(?=<h[345]|$)/)
    if (adjectiveMatch) {
      const adjectiveSection = adjectiveMatch[1]
      const firstDefMatch = adjectiveSection.match(/<li[^>]*>([^<]+(?:<[^>]+>[^<]*<\/[^>]+>[^<]*)*?)(?=<li|$)/)
      if (firstDefMatch) {
        return cleanDefinition(firstDefMatch[1])
      }
    }
    
    // Fallback: look for any definition in ordered list
    const anyDefMatch = englishSection.match(/<li[^>]*>([^<]+(?:<[^>]+>[^<]*<\/[^>]+>[^<]*)*)/)
    if (anyDefMatch) {
      return cleanDefinition(anyDefMatch[1])
    }
    
    return null
  } catch (error) {
    logger.error(`Failed to extract definition from HTML for "${word}":`, error instanceof Error ? error : new Error(String(error)))
    return null
  }
}

function cleanDefinition(htmlText: string): string {
  // Remove HTML tags
  let cleaned = htmlText.replace(/<[^>]+>/g, '')
  
  // Decode HTML entities
  cleaned = cleaned
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
  
  // Clean up extra whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim()
  
  // Remove citation brackets like [First attested from around (1350 to 1470)]
  cleaned = cleaned.replace(/\s*\[[^\]]+\]/g, '')
  
  // Limit length to reasonable definition size
  if (cleaned.length > 200) {
    cleaned = cleaned.substring(0, 200) + '...'
  }
  
  return cleaned
}

async function getWiktionaryDefinition(word: string): Promise<string | null> {
  const cacheKey = `wiktionary:${word}`
  if (apiCache.has(cacheKey)) {
    return apiCache.get(cacheKey)!
  }

  try {
    const url = `https://en.wiktionary.org/w/api.php?action=query&format=json&prop=extracts&titles=${encodeURIComponent(word)}&exintro=1&explaintext=1`
    const response = await fetchWithRetry(url)
    const data = await response.json()
    
    const pages = data.query?.pages
    if (!pages) {
      apiCache.set(cacheKey, null)
      return null
    }
    
    const pageId = Object.keys(pages)[0]
    const extract = pages[pageId]?.extract
    
    if (!extract || extract.includes('may refer to:')) {
      apiCache.set(cacheKey, null)
      return null
    }
    
    // Extract definition from HTML content
    const definition = extractWiktionaryDefinition(extract, word)
    
    apiCache.set(cacheKey, definition)
    return definition
  } catch (error) {
    logger.error(`Failed to fetch Wiktionary definition for "${word}":`, error instanceof Error ? error : new Error(String(error)))
    apiCache.set(cacheKey, null)
    return null
  }
}


async function getWordsFromStorage(): Promise<WordData[]> {
  try {
    const storage = await getStorage()
    const bucket = storage.bucket()
    
    // Try to get words from all ngram data (1-5gram)
    const files = [
      'google-ngram/1gram_top.json'
    ]
    
    const allWords: WordData[] = []
    
    for (const filePath of files) {
      try {
        const file = bucket.file(filePath)
        const [exists] = await file.exists()
        
        if (exists) {
          const [contents] = await file.download()
          const words: WordData[] = JSON.parse(contents.toString())
          allWords.push(...words)
          logger.info(`Loaded ${words.length} words from ${filePath}`)
        }
      } catch (error) {
        logger.warn(`Failed to load ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    
    if (allWords.length === 0) {
      throw new Error('No word data found in storage')
    }
    
    logger.info(`Total words loaded: ${allWords.length}`)
    return allWords
  } catch (error) {
    logger.error('Failed to get words from storage:', error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

export async function POST() {
  try {
    logger.info('Starting Wiktionary dictionary preparation...')
    
    // Get Firebase Admin and Firestore
    const db = await getDb()
    
    // Get words from storage
    const words = await getWordsFromStorage()
    logger.info(`Found ${words.length} words to process`)
    
    // Process words one by one, checking database for each
    const collection = db.collection('dictionary')
    let processed = 0
    let skipped = 0
    const total = words.length
    
    logger.info(`Starting to process ${total} words from JSON files`)
    
    // Process words in batches
    for (let i = 0; i < words.length; i += BATCH_SIZE) {
      const batch = words.slice(i, i + BATCH_SIZE)
      logger.info(`Processing batch: words ${i + 1}-${Math.min(i + BATCH_SIZE, total)} of ${total}`)
      
      for (const wordData of batch) {
        const word = wordData.gram.toLowerCase().trim()
        
        try {
          // Check if word already exists with definition
          const docRef = collection.doc(word)
          const doc = await docRef.get()
          
          if (doc.exists && doc.data()?.definition) {
            skipped++
            logger.info(`Skipping "${word}" - already has definition`)
            continue
          }
          
          logger.info(`Processing word: "${word}"`)
          
          // Fetch definition
          const definition = await getWiktionaryDefinition(word)
          
          // Create or update dictionary entry
          const entry: DictionaryEntry = {
            word,
            definition: definition || undefined,
            synonyms: doc.exists ? (doc.data()?.synonyms || []) : [], // Preserve existing synonyms
            antonyms: doc.exists ? (doc.data()?.antonyms || []) : [], // Preserve existing antonyms
            frequency: wordData.freq,
            lastUpdated: new Date()
          }
          
          // Save to Firestore
          await docRef.set(entry)
          logger.info(`Saved dictionary entry for "${word}": definition=${!!definition}`)
          
          processed++
          
          // Rate limiting delay
          await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY))
          
        } catch (error) {
          logger.error(`Failed to process word "${word}":`, error instanceof Error ? error : new Error(String(error)))
          // Continue with next word instead of failing the entire batch
        }
      }
      
      logger.info(`Progress: ${processed + skipped}/${total} words processed (${processed} new, ${skipped} skipped)`)
    }
    
    logger.info('Wiktionary dictionary preparation completed successfully')
    
    return NextResponse.json({ 
      success: true, 
      message: `Wiktionary dictionary preparation completed. Processed ${processed} words.`,
      processed,
      total
    })
    
  } catch (error) {
    logger.error('Wiktionary dictionary preparation failed:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ 
      error: 'Wiktionary dictionary preparation failed', 
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
