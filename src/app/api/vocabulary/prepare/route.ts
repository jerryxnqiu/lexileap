import { NextResponse } from 'next/server'
import { getDb, getStorage } from '@/libs/firebase/admin'
import { getSecret } from '@/libs/firebase/secret'
import { logger } from '@/libs/utils/logger'
import { DictionaryEntry } from '@/types/dictionary'

export const dynamic = 'force-dynamic'

const RATE_LIMIT_DELAY = 1000 // 1 second between API calls
const MAX_RETRIES = 3


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
        const delay = Math.pow(2, attempt) * 1000
        logger.warn(`Rate limited, waiting ${delay}ms before retry ${attempt + 1}/${maxRetries}`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }

      if (response.status >= 500) {
        const delay = Math.pow(2, attempt) * 1000
        logger.warn(`Server error ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }

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
const DEEPSEEK_ENABLED = true


async function getDeepSeekDefinition(text: string, isPhrase: boolean = false): Promise<{ definition: string | null, synonyms: string[], antonyms: string[] }> {
  // Return mock data when DeepSeek is disabled
  if (!DEEPSEEK_ENABLED) {
    logger.info(`[MOCK] Returning mock definition for "${text}" (DeepSeek disabled)`)
    return {
      definition: `A sample definition for the ${isPhrase ? 'phrase' : 'word'} "${text}". This is mock data for testing.`,
      synonyms: ['synonym1', 'synonym2', 'synonym3'],
      antonyms: ['antonym1', 'antonym2']
    }
  }

  try {
    const prompt = `Please provide an Australian English dictionary entry for the ${isPhrase ? 'phrase' : 'word'} "${text}". Return your response as a JSON object with the following structure:
{
  "definition": "A clear, simple definition (or null if not a valid English ${isPhrase ? 'phrase' : 'word'})",
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

CONTEXT: This ${isPhrase ? 'phrase' : 'word'} comes from Google's ngram dataset (real-world book usage with high frequency). 
- Prioritize the MOST COMMON, everyday meaning that children would encounter in books or daily life
- If the word has multiple meanings, choose the one most relevant for children's vocabulary learning
- For words from specific contexts (literary, historical, scientific), focus on the general, accessible meaning
- Even if the word seems advanced, provide the simplest possible explanation that captures its core meaning
- If the word is genuinely inappropriate or unsuitable for children, set definition to null

Additional Guidelines:
- If the ${isPhrase ? 'phrase' : 'word'} is not valid English, set definition to null
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
    let jsonContent = content.trim()
    if (jsonContent.startsWith('```json')) {
      jsonContent = jsonContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
    } else if (jsonContent.startsWith('```')) {
      jsonContent = jsonContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
    }
    
    const result = JSON.parse(jsonContent)

    const definition = typeof result.definition === 'string' ? result.definition : null
    const synonyms = Array.isArray(result.synonyms) ? result.synonyms.slice(0, 10) : []
    const antonyms = Array.isArray(result.antonyms) ? result.antonyms.slice(0, 10) : []

    return { definition, synonyms, antonyms }

  } catch (error) {
    logger.error(`Failed to fetch DeepSeek definition for "${text}":`, error instanceof Error ? error : new Error(String(error)))
    return { definition: null, synonyms: [], antonyms: [] }
  }
}

// Prepare definitions for words and phrases using DeepSeek
export async function POST(request: Request) {
  try {
    const { words, phrases } = await request.json()
    
    if (!Array.isArray(words) || !Array.isArray(phrases)) {
      return NextResponse.json({ error: 'words and phrases must be arrays' }, { status: 400 })
    }

    const db = await getDb()
    const collection = db.collection('dictionary')
    
    let processed = 0
    let skipped = 0
    const total = words.length + phrases.length
    const definitions: Record<string, { definition: string | null, synonyms: string[], antonyms: string[] }> = {}

    logger.info(`Starting to process ${words.length} words and ${phrases.length} phrases`)

    // Process words - ensure lowercase
    for (const wordItem of words) {
      const text = wordItem.gram?.toLowerCase().trim()
      if (!text) continue

      try {
        // Check if already exists (using lowercase key)
        const docRef = collection.doc(text)
        const doc = await docRef.get()

        if (doc.exists && doc.data()?.definition) {
          skipped++
          logger.info(`Skipping "${text}" - already has definition`)
          continue
        }

        logger.info(`Processing word: "${text}"`)
        const { definition, synonyms, antonyms } = await getDeepSeekDefinition(text, false)

        // Store definition for immediate return (before saving to DB)
        definitions[text] = {
          definition: definition || null,
          synonyms: synonyms.map(s => s.toLowerCase().trim()),
          antonyms: antonyms.map(a => a.toLowerCase().trim())
        }

        const entry: DictionaryEntry = {
          word: text.toLowerCase().trim(), // Ensure lowercase storage
          definition: definition || undefined,
          synonyms: synonyms.map(s => s.toLowerCase().trim()), // Lowercase synonyms
          antonyms: antonyms.map(a => a.toLowerCase().trim()), // Lowercase antonyms
          frequency: wordItem.freq,
          lastUpdated: new Date()
        }

        const firestoreEntry = Object.fromEntries(
          Object.entries(entry).filter(([, value]) => value !== undefined)
        )

        // Save to database in background (don't await - let it happen async)
        docRef.set(firestoreEntry).catch(error => {
          logger.error(`Failed to save dictionary entry for "${text}":`, error instanceof Error ? error : new Error(String(error)))
        })
        logger.info(`Queued dictionary entry save for "${text}"`)
        processed++

        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY))
      } catch (error) {
        logger.error(`Failed to process word "${text}":`, error instanceof Error ? error : new Error(String(error)))
      }
    }

    // Process phrases - ensure lowercase
    for (const phraseItem of phrases) {
      const text = phraseItem.gram?.toLowerCase().trim()
      if (!text) continue

      try {
        // Check if already exists (using lowercase key)
        const docRef = collection.doc(text)
        const doc = await docRef.get()

        if (doc.exists && doc.data()?.definition) {
          skipped++
          logger.info(`Skipping "${text}" - already has definition`)
          continue
        }

        logger.info(`Processing phrase: "${text}"`)
        const { definition, synonyms, antonyms } = await getDeepSeekDefinition(text, true)

        // Store definition for immediate return (before saving to DB)
        definitions[text] = {
          definition: definition || null,
          synonyms: synonyms.map(s => s.toLowerCase().trim()),
          antonyms: antonyms.map(a => a.toLowerCase().trim())
        }

        const entry: DictionaryEntry = {
          word: text.toLowerCase().trim(), // Ensure lowercase storage
          definition: definition || undefined,
          synonyms: synonyms.map(s => s.toLowerCase().trim()), // Lowercase synonyms
          antonyms: antonyms.map(a => a.toLowerCase().trim()), // Lowercase antonyms
          frequency: phraseItem.freq,
          lastUpdated: new Date()
        }

        const firestoreEntry = Object.fromEntries(
          Object.entries(entry).filter(([, value]) => value !== undefined)
        )

        // Save to database in background (don't await - let it happen async)
        docRef.set(firestoreEntry).catch(error => {
          logger.error(`Failed to save dictionary entry for phrase "${text}":`, error instanceof Error ? error : new Error(String(error)))
        })
        logger.info(`Queued dictionary entry save for phrase "${text}"`)
        processed++

        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY))
      } catch (error) {
        logger.error(`Failed to process phrase "${text}":`, error instanceof Error ? error : new Error(String(error)))
      }
    }

    logger.info(`Vocabulary preparation completed: ${processed} processed, ${skipped} skipped`)

    return NextResponse.json({
      success: true,
      message: `Processed ${processed} items, skipped ${skipped} existing`,
      processed,
      skipped,
      total,
      definitions // Return definitions for immediate display
    })
  } catch (error) {
    logger.error('Vocabulary preparation failed:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({
      error: 'Vocabulary preparation failed',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
