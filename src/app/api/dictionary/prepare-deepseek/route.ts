import { NextResponse } from 'next/server'
import { logger } from '@/libs/utils/logger'
import { getDb, getStorage } from '@/libs/firebase/admin'
import { getSecret } from '@/libs/firebase/secret'
import { WordData, DictionaryEntry } from '@/types/dictionary'

export const dynamic = 'force-dynamic'

// Rate limiting configuration
const RATE_LIMIT_DELAY = 1000 // 1 second between API calls
const BATCH_SIZE = 1 // Process 1 word at a time
const MAX_RETRIES = 3

// Cache for API responses to avoid duplicate calls
const apiCache = new Map<string, { definition: string | null, synonyms: string[], antonyms: string[] }>()

async function fetchWithRetry(url: string, body: Record<string, unknown>, maxRetries: number = MAX_RETRIES): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await getSecret('lexileap-deepseek-api-key')}`
        },
        body: JSON.stringify(body)
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
      logger.warn(`Request failed, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries}): ${error instanceof Error ? error.message : String(error)}`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw new Error(`Failed after ${maxRetries} attempts`)
}


// Set to false to disable DeepSeek API calls and use mock data for testing
const DEEPSEEK_ENABLED = false


async function getDeepSeekDefinition(word: string): Promise<{ definition: string | null, synonyms: string[], antonyms: string[] }> {
  const cacheKey = `deepseek:${word}`
  if (apiCache.has(cacheKey)) {
    return apiCache.get(cacheKey)!
  }

  // Return mock data when DeepSeek is disabled
  if (!DEEPSEEK_ENABLED) {
    logger.info(`[MOCK] Returning mock definition for "${word}" (DeepSeek disabled)`)
    const mockResult = {
      definition: `A sample definition for the word "${word}". This is mock data for testing.`,
      synonyms: ['synonym1', 'synonym2', 'synonym3'],
      antonyms: ['antonym1', 'antonym2']
    }
    apiCache.set(cacheKey, mockResult)
    return mockResult
  }

  try {
    const prompt = `Please provide an Australian English dictionary entry for the word "${word}". Return your response as a JSON object with the following structure:
{
  "definition": "A clear, simple definition of the word (or null if the word is not a valid English word)",
  "synonyms": ["list", "of", "up", "to", "10", "synonyms"],
  "antonyms": ["list", "of", "up", "to", "10", "antonyms"]
}

CRITICAL GUIDELINES FOR CHILDREN UNDER 12:
- Use VERY SIMPLE language that a 7-12 year old can understand
- Use short sentences (max 15 words per definition)
- Avoid difficult words in the definition - if you must use a word, explain it simply
- Use everyday examples when helpful (e.g., "A cat is a small furry pet that meows")
- Break down complex concepts into simple parts
- If the word is too difficult for children, still provide a simplified version using the simplest possible explanation
- Focus on what the word means in everyday life, not technical or academic meanings
- Use words a child would know (e.g., "big" not "enormous", "happy" not "jubilant")

CONTEXT: This word comes from Google's ngram dataset (real-world book usage with high frequency). 
- Prioritize the MOST COMMON, everyday meaning that children would encounter in books or daily life
- If the word has multiple meanings, choose the one most relevant for children's vocabulary learning
- For words from specific contexts (literary, historical, scientific), focus on the general, accessible meaning
- Even if the word seems advanced, provide the simplest possible explanation that captures its core meaning
- If the word is genuinely inappropriate or unsuitable for children, set definition to null
- If the word can be used as different parts of speech (noun, verb, adjective, adverb), provide the most common usage in simple language

Additional Guidelines:
- If the word is not a valid English word, set definition to null
- Provide a clear, educational definition suitable for vocabulary learning
- Include relevant synonyms and antonyms (also use simple words that children would understand)
- Keep definitions concise but informative
- Focus on meanings that help children expand their vocabulary naturally
- Return only valid JSON, no additional text`

    const response = await fetchWithRetry('https://api.deepseek.com/v1/chat/completions', {
      model: 'deepseek-chat',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 600
    })

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      throw new Error('No content in DeepSeek response')
    }

    // Parse the JSON response (handle markdown code blocks)
    let result: Record<string, unknown>
    try {
      // Extract JSON from markdown code blocks if present
      let jsonContent = content.trim()
      if (jsonContent.startsWith('```json')) {
        jsonContent = jsonContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
      } else if (jsonContent.startsWith('```')) {
        jsonContent = jsonContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
      }
      
      result = JSON.parse(jsonContent)
    } catch {
      logger.error(`Failed to parse DeepSeek response for "${word}": ${content}`)
      throw new Error('Invalid JSON response from DeepSeek')
    }

    // Validate the response structure
    if (typeof result !== 'object' || result === null) {
      throw new Error('Invalid response structure from DeepSeek')
    }

    const definition = typeof result.definition === 'string' ? result.definition : null
    const synonyms = Array.isArray(result.synonyms) ? result.synonyms.slice(0, 10) : []
    const antonyms = Array.isArray(result.antonyms) ? result.antonyms.slice(0, 10) : []

    const finalResult = { definition, synonyms, antonyms }
    apiCache.set(cacheKey, finalResult)
    return finalResult

  } catch (error) {
    logger.error(`Failed to fetch DeepSeek definition for "${word}":`, error instanceof Error ? error : new Error(String(error)))
    const result = { definition: null, synonyms: [], antonyms: [] }
    apiCache.set(cacheKey, result)
    return result
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
    logger.info('Starting DeepSeek dictionary preparation...')

    // Get Firebase Admin and Firestore
    const db = await getDb()

    // Get words from storage
    const allWords = await getWordsFromStorage()
    const words = allWords.slice(0, 10) // Trial with first 10 words only
    logger.info(`Found ${allWords.length} total words, processing first ${words.length} words for trial`)

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

          // Fetch definition, synonyms, and antonyms from DeepSeek
          const { definition, synonyms, antonyms } = await getDeepSeekDefinition(word)

          // Create or update dictionary entry
          const entry: DictionaryEntry = {
            word,
            definition: definition || undefined,
            synonyms,
            antonyms,
            frequency: wordData.freq,
            lastUpdated: new Date()
          }
          
          // Remove undefined values before saving to Firestore
          const firestoreEntry = Object.fromEntries(
            Object.entries(entry).filter(([, value]) => value !== undefined)
          )

          // Save to Firestore
          await docRef.set(firestoreEntry)
          logger.info(`Saved dictionary entry for "${word}": definition=${!!definition}, synonyms=${synonyms.length}, antonyms=${antonyms.length}`)

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

    logger.info('DeepSeek dictionary preparation completed successfully')

    return NextResponse.json({
      success: true,
      message: `DeepSeek dictionary preparation completed. Processed ${processed} words.`,
      processed,
      total
    })

  } catch (error) {
    logger.error('DeepSeek dictionary preparation failed:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({
      error: 'DeepSeek dictionary preparation failed',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
