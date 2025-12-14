import { NextResponse } from 'next/server'
import { getStorage, getDb } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'

export const dynamic = 'force-dynamic'

interface WordItem {
  gram: string
  freq: number
}

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
          wrongWords.add(answer.word.toLowerCase().trim())
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
      const word = doc.id.toLowerCase().trim()
      if (word) words.push(word)
    })

    return words
  } catch (error) {
    logger.error('Failed to get dictionary words:', error instanceof Error ? error : new Error(String(error)))
    return []
  }
}

function prioritizeWords(
  allWords: WordItem[],
  priorityWords: string[],
  targetCount: number,
  priorityPercentage: number
): WordItem[] {
  const priorityCount = Math.floor(targetCount * priorityPercentage)
  const remainingCount = targetCount - priorityCount

  // Create a map for quick lookup
  const wordMap = new Map<string, WordItem>()
  allWords.forEach(w => {
    const key = w.gram.toLowerCase().trim()
    if (!wordMap.has(key)) {
      wordMap.set(key, w)
    }
  })

  // Get priority words that exist in the data
  const prioritized: WordItem[] = []
  const used = new Set<string>()
  
  for (const priorityWord of priorityWords) {
    if (prioritized.length >= priorityCount) break
    const key = priorityWord.toLowerCase().trim()
    if (wordMap.has(key) && !used.has(key)) {
      prioritized.push(wordMap.get(key)!)
      used.add(key)
    }
  }

  // Fill remaining with random words
  const remaining: WordItem[] = []
  const shuffled = [...allWords].sort(() => Math.random() - 0.5)
  
  for (const word of shuffled) {
    if (remaining.length >= remainingCount) break
    const key = word.gram.toLowerCase().trim()
    if (!used.has(key)) {
      remaining.push(word)
      used.add(key)
    }
  }

  return [...prioritized, ...remaining].slice(0, targetCount)
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    const storage = await getStorage()
    const bucket = storage.bucket()

    // Load words.json (1gram)
    let allWords: WordItem[] = []
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
    let allPhrases: WordItem[] = []
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

    let words: WordItem[] = []
    let phrases: WordItem[] = []

    if (userId) {
      // Get user's wrong words and dictionary words
      const wrongWords = await getUserWrongWords(userId)
      const dictionaryWords = await getDictionaryWords()
      
      // Combine wrong words and dictionary words for priority
      const priorityWords = Array.from(new Set([...wrongWords, ...dictionaryWords]))
      
      logger.info(`Found ${wrongWords.length} wrong words, ${dictionaryWords.length} dictionary words for user ${userId}`)

      // Prioritize words (70% from wrong/dictionary, 30% new)
      words = prioritizeWords(allWords, priorityWords, WORDS_TARGET, PRIORITY_PERCENTAGE)
      
      // Prioritize phrases (70% from wrong/dictionary, 30% new)
      phrases = prioritizeWords(allPhrases, priorityWords, PHRASES_TARGET, PRIORITY_PERCENTAGE)
    } else {
      // No userId, just return random selection
      words = [...allWords].sort(() => Math.random() - 0.5).slice(0, WORDS_TARGET)
      phrases = [...allPhrases].sort(() => Math.random() - 0.5).slice(0, PHRASES_TARGET)
    }

    return NextResponse.json({
      success: true,
      words,
      phrases,
      wordCount: words.length,
      phraseCount: phrases.length
    })
  } catch (error) {
    logger.error('Failed to load vocabulary:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({
      error: 'Failed to load vocabulary data',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
