import { NextResponse } from 'next/server'
import { getStorage, getDb } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'
import { WordData, DictionaryEntry } from '@/types/dictionary'

export const dynamic = 'force-dynamic'


// Returns word accuracy data for this user based on quiz attempts.
async function getUserWordAccuracy(userId: string): Promise<Record<string, { total: number; wrong: number; accuracy: number }>> {
  try {
    const db = await getDb()
    const attemptsSnap = await db.collection('user_quiz_attempts')
      .where('userId', '==', userId)
      .get()

    type Agg = { total: number; wrong: number }
    const agg: Record<string, Agg> = {}

    attemptsSnap.forEach(doc => {
      const data = doc.data()
      const answers = Array.isArray(data?.answers) ? data.answers : []
      for (const answer of answers) {
        const rawWord = (answer?.word || '') as string
        const word = rawWord.toLowerCase().trim()
        if (!word) continue

        const isCorrect = answer?.isCorrect === true

        if (!agg[word]) {
          agg[word] = { total: 0, wrong: 0 }
        }
        agg[word].total += 1
        if (!isCorrect) agg[word].wrong += 1
      }
    })

    // Convert to accuracy records
    const accuracy: Record<string, { total: number; wrong: number; accuracy: number }> = {}
    for (const [word, stats] of Object.entries(agg)) {
      if (stats.total > 0) {
        accuracy[word] = {
          total: stats.total,
          wrong: stats.wrong,
          accuracy: (stats.total - stats.wrong) / stats.total
        }
      }
    }

    return accuracy
  } catch (error) {
    logger.error('Failed to get user word accuracy:', error instanceof Error ? error : new Error(String(error)))
    return {}
  }
}


// Returns only "strong" words (high accuracy) for this user based on quiz attempts.
async function getUserStrongWords(userId: string): Promise<string[]> {
  try {
    const accuracy = await getUserWordAccuracy(userId)
    
    // Treat words with wrong-rate < 20% (accuracy >= 80%) as "strong"
    const STRONG_THRESHOLD = 0.8
    const strongWords = Object.entries(accuracy)
      .filter(([, v]) => v.total > 0 && v.accuracy >= STRONG_THRESHOLD)
      .map(([word]) => word)

    return strongWords
  } catch (error) {
    logger.error('Failed to get user strong words:', error instanceof Error ? error : new Error(String(error)))
    return []
  }
}


// Returns dictionary entries (excluding strong words if userId is provided)
async function getDictionaryWords(userId?: string): Promise<DictionaryEntry[]> {
  try {
    const db = await getDb()
    const snapshot = await db.collection('dictionary')
      .where('definition', '!=', null)
      .limit(1000)
      .get()

    const entries: DictionaryEntry[] = []
    snapshot.forEach(doc => {
      const data = doc.data()
      const word = (doc.id || '').toLowerCase().trim()
      if (word) {
        entries.push({
          word: word,
          definition: data.definition || undefined,
          synonyms: Array.isArray(data.synonyms) ? data.synonyms : [],
          antonyms: Array.isArray(data.antonyms) ? data.antonyms : [],
          frequency: typeof data.frequency === 'number' ? data.frequency : 0,
          lastUpdated: data.lastUpdated?.toDate() || new Date()
        })
      }
    })

    // If userId is provided, exclude strong words (user already knows these well)
    if (userId) {
      const strongWords = await getUserStrongWords(userId)
      const strongWordsSet = new Set(strongWords.map(w => w.toLowerCase().trim()))
      return entries.filter(entry => !strongWordsSet.has(entry.word.toLowerCase().trim()))
    }

    return entries
  } catch (error) {
    logger.error('Failed to get dictionary words:', error instanceof Error ? error : new Error(String(error)))
    return []
  }
}


// Helper function to determine if a string is a word (1 gram) or phrase (>1 gram)
function isWord(text: string): boolean {
  const trimmed = text.trim()
  // Count words by splitting on whitespace - if more than 1 word, it's a phrase
  return trimmed.split(/\s+/).length === 1
}


// Prioritizes words and phrases from "priorityWords" (dictionary entries) and fills the rest from JSON
// Uses word length (1 gram = word, >1 gram = phrase) to distinguish between them
function prioritizeWords(
  allWords: WordData[], 
  allPhrases: WordData[], 
  priorityWords: string[], 
  wordTargetCount: number, 
  phrasesTargetCount: number, 
  priorityPercentage: number
): { 
  words: WordData[], 
  phrases: WordData[], 
  wordsFromJson: string[], 
  phrasesFromJson: string[], 
  prioritizedWordsCount: number,
  prioritizedPhrasesCount: number
} {
  // Create maps for quick lookup - normalize all to lowercase
  const wordMap = new Map<string, WordData>()
  allWords.forEach(w => {
    const key = w.gram.toLowerCase().trim()
    if (!wordMap.has(key)) {
      wordMap.set(key, { ...w, gram: key })
    }
  })

  const phraseMap = new Map<string, WordData>()
  allPhrases.forEach(p => {
    const key = p.gram.toLowerCase().trim()
    if (!phraseMap.has(key)) {
      phraseMap.set(key, { ...p, gram: key })
    }
  })

  // Separate priority words into words and phrases
  const priorityWordsList: string[] = []
  const priorityPhrasesList: string[] = []
  
  for (const priorityWord of priorityWords) {
    const key = priorityWord.toLowerCase().trim()
    if (isWord(key)) {
      priorityWordsList.push(key)
    } else {
      priorityPhrasesList.push(key)
    }
  }

  // Calculate target counts: 70% from priority, 30% from JSON
  const wordPriorityCount = Math.floor(wordTargetCount * priorityPercentage)
  const phrasePriorityCount = Math.floor(phrasesTargetCount * priorityPercentage)

  // Process words
  const prioritizedWords: WordData[] = []
  const usedWords = new Set<string>()
  
  for (const priorityWord of priorityWordsList) {
    if (prioritizedWords.length >= wordPriorityCount) break
    const key = priorityWord.toLowerCase().trim()
    if (wordMap.has(key) && !usedWords.has(key)) {
      prioritizedWords.push(wordMap.get(key)!)
      usedWords.add(key)
    }
  }

  const remainingWords: WordData[] = []
  const wordsFromJson: string[] = []
  const shuffledWords = [...allWords].sort(() => Math.random() - 0.5)
  
  for (const word of shuffledWords) {
    if (prioritizedWords.length + remainingWords.length >= wordTargetCount) break
    const key = word.gram.toLowerCase().trim()
    if (!usedWords.has(key)) {
      remainingWords.push({ ...word, gram: key })
      wordsFromJson.push(key)
      usedWords.add(key)
    }
  }

  // Process phrases
  const prioritizedPhrases: WordData[] = []
  const usedPhrases = new Set<string>()
  
  for (const priorityPhrase of priorityPhrasesList) {
    if (prioritizedPhrases.length >= phrasePriorityCount) break
    const key = priorityPhrase.toLowerCase().trim()
    if (phraseMap.has(key) && !usedPhrases.has(key)) {
      prioritizedPhrases.push(phraseMap.get(key)!)
      usedPhrases.add(key)
    }
  }

  const remainingPhrases: WordData[] = []
  const phrasesFromJson: string[] = []
  const shuffledPhrases = [...allPhrases].sort(() => Math.random() - 0.5)
  
  for (const phrase of shuffledPhrases) {
    if (prioritizedPhrases.length + remainingPhrases.length >= phrasesTargetCount) break
    const key = phrase.gram.toLowerCase().trim()
    if (!usedPhrases.has(key)) {
      remainingPhrases.push({ ...phrase, gram: key })
      phrasesFromJson.push(key)
      usedPhrases.add(key)
    }
  }

  const finalWords = [...prioritizedWords, ...remainingWords]
  const finalPhrases = [...prioritizedPhrases, ...remainingPhrases]
  
  return { 
    words: finalWords.slice(0, wordTargetCount).map(w => ({ ...w, gram: w.gram.toLowerCase().trim() })),
    phrases: finalPhrases.slice(0, phrasesTargetCount).map(p => ({ ...p, gram: p.gram.toLowerCase().trim() })),
    wordsFromJson,
    phrasesFromJson,
    prioritizedWordsCount: prioritizedWords.length,
    prioritizedPhrasesCount: prioritizedPhrases.length
  }
}


// Loads vocabulary items for a user (or random items if no userId is provided)
// Returns: { words, phrases, wordCount, phraseCount, fromJson: { words, phrases } } (all gram lowercased)
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
    let matchingDictionaryEntries: DictionaryEntry[] = []

    if (userId) {
      // Get dictionary entries (excluding strong words - all remaining are candidates for re-testing)
      const dictionaryEntries = await getDictionaryWords(userId) // Excludes strong words internally
      
      // Extract word strings for prioritization (includes both words and phrases)
      const priorityWords = dictionaryEntries.map(entry => entry.word)
      
      logger.info(`Found ${dictionaryEntries.length} dictionary entries (excluding strong words) for user ${userId}`)

      // Prioritize words and phrases together: use dictionary entries (excluding strong), then fill rest from JSON
      const result = prioritizeWords(allWords, allPhrases, priorityWords, WORDS_TARGET, PHRASES_TARGET, PRIORITY_PERCENTAGE)
      words = result.words
      phrases = result.phrases
      wordsFromJson = result.wordsFromJson
      phrasesFromJson = result.phrasesFromJson

      // Select dictionary entries that match the selected words and phrases
      const selectedKeys = new Set<string>()
      words.forEach(w => selectedKeys.add(w.gram.toLowerCase().trim()))
      phrases.forEach(p => selectedKeys.add(p.gram.toLowerCase().trim()))
      
      matchingDictionaryEntries = dictionaryEntries.filter(entry => 
        selectedKeys.has(entry.word.toLowerCase().trim())
      )

      logger.info(`Prioritized words: ${words.length} total (target: ${WORDS_TARGET}) = ${result.prioritizedWordsCount} from dictionary + ${wordsFromJson.length} from JSON`)
      logger.info(`Prioritized phrases: ${phrases.length} total (target: ${PHRASES_TARGET}) = ${result.prioritizedPhrasesCount} from dictionary + ${phrasesFromJson.length} from JSON`)
      logger.info(`Found ${matchingDictionaryEntries.length} matching dictionary entries for selected words/phrases`)

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

    // Prepare response
    const response: any = {
      success: true,
      words,
      phrases,
      wordCount: words.length,
      phraseCount: phrases.length,
      fromJson: {
        words: wordsFromJson,
        phrases: phrasesFromJson
      }
    }

    // Include matching dictionary entries if userId was provided
    if (userId && matchingDictionaryEntries.length > 0) {
      response.dictionaryEntries = matchingDictionaryEntries
    }

    return NextResponse.json(response)
  } catch (error) {
    logger.error('Failed to load vocabulary:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({
      error: 'Failed to load vocabulary data',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
