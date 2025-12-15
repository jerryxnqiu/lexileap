import { NextResponse } from 'next/server'
import { getStorage, getDb } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'
import { WordData } from '@/types/dictionary'

export const dynamic = 'force-dynamic'

async function getUserWrongWords(userId: string): Promise<string[]> {
  try {
    const db = await getDb()
    const attemptsSnap = await db.collection('user_quiz_attempts')
      .where('userId', '==', userId)
      .get()

    const wrongWords = new Set<string>()
    attemptsSnap.forEach(doc => {
      const data = doc.data()
      const answers = Array.isArray(data?.answers) ? data.answers : []
      for (const answer of answers) {
        if (answer?.isCorrect === false && answer?.word) {
          // Normalize to lowercase
          wrongWords.add((answer.word || '').toLowerCase().trim())
        }
      }
    })

    return Array.from(wrongWords)
  } catch (error) {
    logger.error('Failed to get user wrong words:', error instanceof Error ? error : new Error(String(error)))
    return []
  }
}

async function getDictionaryWords(): Promise<string[]> {
  try {
    const db = await getDb()
    const snapshot = await db.collection('dictionary')
      .where('definition', '!=', null)
      .limit(10000)
      .get()

    const words: string[] = []
    snapshot.forEach(doc => {
      // Dictionary keys should already be lowercase, but normalize to be sure
      const word = (doc.id || '').toLowerCase().trim()
      if (word) words.push(word)
    })

    return words
  } catch (error) {
    logger.error('Failed to get dictionary words:', error instanceof Error ? error : new Error(String(error)))
    return []
  }
}

function prioritizeWords(allWords: WordData[], priorityWords: string[], targetCount: number, priorityPercentage: number): { 
  words: WordData[], fromJson: string[], prioritizedCount: number } {
  // Create a map for quick lookup - normalize all words to lowercase
  const wordMap = new Map<string, WordData>()
  allWords.forEach(w => {
    const key = w.gram.toLowerCase().trim()
    // Store with lowercase gram
    if (!wordMap.has(key)) {
      wordMap.set(key, { ...w, gram: key })
    }
  })

  // Get ALL priority words that exist in the data - use all available, not just up to 70%
  // Normalize to lowercase
  const prioritized: WordData[] = []
  const used = new Set<string>()
  
  for (const priorityWord of priorityWords) {
    const key = priorityWord.toLowerCase().trim()
    if (wordMap.has(key) && !used.has(key)) {
      prioritized.push(wordMap.get(key)!)
      used.add(key)
    }
  }

  // Calculate how many more words we need to reach targetCount
  const neededFromJson = targetCount - prioritized.length

  // Fill remaining with random words from JSON (these may need DeepSeek)
  const remaining: WordData[] = []
  const fromJson: string[] = []
  const shuffled = [...allWords].sort(() => Math.random() - 0.5)
  
  for (const word of shuffled) {
    if (remaining.length >= neededFromJson) break
    const key = word.gram.toLowerCase().trim()
    if (!used.has(key)) {
      remaining.push({ ...word, gram: key }) // Store with lowercase
      fromJson.push(key) // Track words from JSON
      used.add(key)
    }
  }

  const result = [...prioritized, ...remaining]
  
  // If we still don't have enough words, fill with more random words from allWords
  if (result.length < targetCount) {
    const additionalNeeded = targetCount - result.length
    const additional = [...allWords]
      .sort(() => Math.random() - 0.5)
      .filter(w => {
        const key = w.gram.toLowerCase().trim()
        return !used.has(key)
      })
      .slice(0, additionalNeeded)
      .map(w => {
        const key = w.gram.toLowerCase().trim()
        return { ...w, gram: key } // Normalize to lowercase
      })
    
    additional.forEach(w => {
      const key = w.gram.toLowerCase().trim()
      used.add(key)
      fromJson.push(key) // Additional words are from JSON
    })
    
    result.push(...additional)
  }
  
  // Ensure all words in result are lowercase
  const normalizedResult = result.map(w => ({ ...w, gram: w.gram.toLowerCase().trim() }))
  return { 
    words: normalizedResult.slice(0, targetCount), 
    fromJson,
    prioritizedCount: prioritized.length // Return count of priority words actually used
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    const storage = await getStorage()
    const bucket = storage.bucket()

    // Load words.json (1gram)
    let allWords: WordData[] = []
    try {
      const wordsFile = bucket.file('data/words.json')
      const [exists] = await wordsFile.exists()
      if (exists) {
        const [contents] = await wordsFile.download()
        allWords = JSON.parse(contents.toString())
        logger.info(`Loaded ${allWords.length} words from data/words.json`)
      }
    } catch (error) {
      logger.error('Failed to load words.json:', error instanceof Error ? error : new Error(String(error)))
    }

    // Load phrases.json (2-5gram)
    let allPhrases: WordData[] = []
    try {
      const phrasesFile = bucket.file('data/phrases.json')
      const [exists] = await phrasesFile.exists()
      if (exists) {
        const [contents] = await phrasesFile.download()
        allPhrases = JSON.parse(contents.toString())
        logger.info(`Loaded ${allPhrases.length} phrases from data/phrases.json`)
      }
    } catch (error) {
      logger.error('Failed to load phrases.json:', error instanceof Error ? error : new Error(String(error)))
    }

    const WORDS_TARGET = 200
    const PHRASES_TARGET = 50
    const PRIORITY_PERCENTAGE = 0.7 // 70%

    let words: WordData[] = []
    let phrases: WordData[] = []

    let wordsFromJson: string[] = []
    let phrasesFromJson: string[] = []

    if (userId) {
      // Get user's wrong words and dictionary words
      const wrongWords = await getUserWrongWords(userId)
      const dictionaryWords = await getDictionaryWords()
      
      // Combine wrong words and dictionary words for priority
      const priorityWords = Array.from(new Set([...wrongWords, ...dictionaryWords]))
      
      logger.info(`Found ${wrongWords.length} wrong words, ${dictionaryWords.length} dictionary words for user ${userId}`)

      // Prioritize words: use ALL available wrong/dictionary words, then fill rest from JSON
      const wordsResult = prioritizeWords(allWords, priorityWords, WORDS_TARGET, PRIORITY_PERCENTAGE)
      words = wordsResult.words
      wordsFromJson = wordsResult.fromJson
      logger.info(`Prioritized words: ${words.length} total (target: ${WORDS_TARGET}), ${wordsResult.prioritizedCount} from wrong/dictionary, ${wordsFromJson.length} from JSON`)
      
      // Prioritize phrases: use ALL available wrong/dictionary words, then fill rest from JSON
      const phrasesResult = prioritizeWords(allPhrases, priorityWords, PHRASES_TARGET, PRIORITY_PERCENTAGE)
      phrases = phrasesResult.words
      phrasesFromJson = phrasesResult.fromJson
      logger.info(`Prioritized phrases: ${phrases.length} total (target: ${PHRASES_TARGET}), ${phrasesResult.prioritizedCount} from wrong/dictionary, ${phrasesFromJson.length} from JSON`)
    } else {
      // No userId, all words are from JSON - normalize to lowercase
      words = [...allWords]
        .map(w => ({ ...w, gram: w.gram.toLowerCase().trim() }))
        .sort(() => Math.random() - 0.5)
        .slice(0, WORDS_TARGET)
      phrases = [...allPhrases]
        .map(p => ({ ...p, gram: p.gram.toLowerCase().trim() }))
        .sort(() => Math.random() - 0.5)
        .slice(0, PHRASES_TARGET)
      wordsFromJson = words.map(w => w.gram)
      phrasesFromJson = phrases.map(p => p.gram)
    }
    
    // Ensure all words/phrases are lowercase before returning
    words = words.map(w => ({ ...w, gram: w.gram.toLowerCase().trim() }))
    phrases = phrases.map(p => ({ ...p, gram: p.gram.toLowerCase().trim() }))

    return NextResponse.json({
      success: true,
      words,
      phrases,
      wordCount: words.length,
      phraseCount: phrases.length,
      fromJson: {
        words: wordsFromJson,
        phrases: phrasesFromJson
      }
    })
  } catch (error) {
    logger.error('Failed to load vocabulary:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({
      error: 'Failed to load vocabulary data',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
