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


// Returns dictionary entries, optionally separated by strong/weak words
async function getDictionaryWords(userId?: string): Promise<{ weakWords: DictionaryEntry[], strongWords: DictionaryEntry[] }> {
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

    // If userId is provided, separate into weak and strong words
    if (userId) {
      const strongWordsList = await getUserStrongWords(userId)
      const strongWordsSet = new Set(strongWordsList.map(w => w.toLowerCase().trim()))
      
      const weakWords = entries.filter(entry => !strongWordsSet.has(entry.word.toLowerCase().trim()))
      const strongWords = entries.filter(entry => strongWordsSet.has(entry.word.toLowerCase().trim()))
      
      return { weakWords, strongWords }
    }

    // No userId, treat all as weak words
    return { weakWords: entries, strongWords: [] }
  } catch (error) {
    logger.error('Failed to get dictionary words:', error instanceof Error ? error : new Error(String(error)))
    return { weakWords: [], strongWords: [] }
  }
}


// Helper function to determine if a string is a word (1 gram) or phrase (>1 gram)
function isWord(text: string): boolean {
  const trimmed = text.trim()
  // Count words by splitting on whitespace - if more than 1 word, it's a phrase
  return trimmed.split(/\s+/).length === 1
}

// Helper function to get the first letter of a word/phrase (for diversity)
function getFirstLetter(text: string): string {
  const trimmed = text.trim().toLowerCase()
  return trimmed.charAt(0) || 'z' // Default to 'z' if empty
}

// Selects items with better distribution across first letters
// Groups items by first letter, then interleaves selections to ensure diversity
function selectWithLetterDiversity<T extends { gram: string }>(
  items: T[],
  targetCount: number,
  usedSet: Set<string>,
  excludedSet?: Set<string>
): T[] {
  if (items.length === 0 || targetCount === 0) return []
  
  // Filter out already used items and excluded items
  const available = items.filter(item => {
    const key = item.gram.toLowerCase().trim()
    return !usedSet.has(key) && !(excludedSet?.has(key))
  })
  
  if (available.length === 0) return []
  
  // Group by first letter
  const byLetter = new Map<string, T[]>()
  for (const item of available) {
    const letter = getFirstLetter(item.gram)
    if (!byLetter.has(letter)) {
      byLetter.set(letter, [])
    }
    byLetter.get(letter)!.push(item)
  }
  
  // Shuffle within each letter group
  for (const [letter, group] of byLetter.entries()) {
    byLetter.set(letter, group.sort(() => Math.random() - 0.5))
  }
  
  // Interleave selections across letters to ensure diversity
  const selected: T[] = []
  const letterIndices = new Map<string, number>()
  const letters = Array.from(byLetter.keys()).sort(() => Math.random() - 0.5) // Shuffle letter order
  
  // Initialize indices
  for (const letter of letters) {
    letterIndices.set(letter, 0)
  }
  
  // Round-robin selection: take one from each letter group in turn
  while (selected.length < targetCount && selected.length < available.length) {
    let foundAny = false
    
    for (const letter of letters) {
      if (selected.length >= targetCount) break
      
      const group = byLetter.get(letter)!
      const index = letterIndices.get(letter)!
      
      if (index < group.length) {
        const item = group[index]
        const key = item.gram.toLowerCase().trim()
        if (!usedSet.has(key)) {
          selected.push(item)
          usedSet.add(key)
          foundAny = true
        }
        letterIndices.set(letter, index + 1)
      }
    }
    
    // If we couldn't find any more items, break
    if (!foundAny) break
  }
  
  // If we still need more items and have exhausted round-robin, fill randomly
  if (selected.length < targetCount) {
    const remaining = available.filter(item => {
      const key = item.gram.toLowerCase().trim()
      return !usedSet.has(key)
    })
    
    const shuffled = remaining.sort(() => Math.random() - 0.5)
    for (const item of shuffled) {
      if (selected.length >= targetCount) break
      const key = item.gram.toLowerCase().trim()
      if (!usedSet.has(key)) {
        selected.push(item)
        usedSet.add(key)
      }
    }
  }
  
  return selected.slice(0, targetCount)
}


// Prioritizes words and phrases from "priorityWords" (dictionary entries) and fills the rest from JSON
// Uses word length (1 gram = word, >1 gram = phrase) to distinguish between them
function prioritizeWords(
  allWords: WordData[], 
  allPhrases: WordData[], 
  priorityWords: string[], 
  wordTargetCount: number, 
  phrasesTargetCount: number, 
  priorityPercentage: number,
  excludedItems?: Set<string>
): { 
  words: WordData[], 
  phrases: WordData[], 
  wordsFromJson: string[], 
  phrasesFromJson: string[], 
  prioritizedWordsCount: number,
  prioritizedPhrasesCount: number
} {
  // Create maps for quick lookup - normalize all to lowercase
  // Preserve rank information when creating maps
  const wordMap = new Map<string, WordData>()
  allWords.forEach((w, index) => {
    const key = w.gram.toLowerCase().trim()
    if (!wordMap.has(key)) {
      // Use rank from data, or calculate from index if not present
      wordMap.set(key, { ...w, gram: key, rank: w.rank || index + 1 })
    }
  })

  const phraseMap = new Map<string, WordData>()
  allPhrases.forEach((p, index) => {
    const key = p.gram.toLowerCase().trim()
    if (!phraseMap.has(key)) {
      // Use rank from data, or calculate from index if not present
      phraseMap.set(key, { ...p, gram: key, rank: p.rank || index + 1 })
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

  // Process words - select priority words with letter diversity
  const usedWords = new Set<string>()
  const priorityWordCandidates: WordData[] = []
  
  // Collect all available priority words (don't mark as used yet, but exclude if in excludedItems)
  for (const priorityWord of priorityWordsList) {
    const key = priorityWord.toLowerCase().trim()
    if (wordMap.has(key) && !excludedItems?.has(key)) {
      priorityWordCandidates.push(wordMap.get(key)!)
    }
  }
  
  // Select from priority candidates with letter diversity (this will mark them as used)
  const prioritizedWords = selectWithLetterDiversity(
    priorityWordCandidates,
    wordPriorityCount,
    usedWords,
    excludedItems
  )

  // Select remaining words from JSON with letter diversity
  const remainingWordCount = wordTargetCount - prioritizedWords.length
  const remainingWords = selectWithLetterDiversity(
    allWords.map(w => ({ ...w, gram: w.gram.toLowerCase().trim() })),
    remainingWordCount,
    usedWords,
    excludedItems
  )
  const wordsFromJson = remainingWords.map(w => w.gram.toLowerCase().trim())

  // Process phrases - select priority phrases with letter diversity
  const usedPhrases = new Set<string>()
  const priorityPhraseCandidates: WordData[] = []
  
  // Collect all available priority phrases (don't mark as used yet, but exclude if in excludedItems)
  for (const priorityPhrase of priorityPhrasesList) {
    const key = priorityPhrase.toLowerCase().trim()
    if (phraseMap.has(key) && !excludedItems?.has(key)) {
      priorityPhraseCandidates.push(phraseMap.get(key)!)
    }
  }
  
  // Select from priority candidates with letter diversity (this will mark them as used)
  const prioritizedPhrases = selectWithLetterDiversity(
    priorityPhraseCandidates,
    phrasePriorityCount,
    usedPhrases,
    excludedItems
  )

  // Select remaining phrases from JSON with letter diversity
  const remainingPhraseCount = phrasesTargetCount - prioritizedPhrases.length
  const remainingPhrases = selectWithLetterDiversity(
    allPhrases.map(p => ({ ...p, gram: p.gram.toLowerCase().trim() })),
    remainingPhraseCount,
    usedPhrases,
    excludedItems
  )
  const phrasesFromJson = remainingPhrases.map(p => p.gram.toLowerCase().trim())

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
    const replacementsParam = searchParams.get('replacements')
    const replacementCount = replacementsParam ? parseInt(replacementsParam, 10) : 0
    const excludeParam = searchParams.get('exclude')
    const excludedItems = excludeParam ? new Set(excludeParam.split(',').map(item => item.toLowerCase().trim())) : new Set<string>()

    const storage = await getStorage()
    const bucket = storage.bucket()

    // Load words.json (1gram) - already sorted by frequency in descending order
    let allWords: WordData[] = []
    try {
      const wordsFile = bucket.file('data/words.json')
      const [exists] = await wordsFile.exists()
      if (exists) {
        const [contents] = await wordsFile.download()
        const wordsData = JSON.parse(contents.toString())
        // Add rank based on position in array (1 = most frequent)
        allWords = wordsData.map((w: WordData, index: number) => ({
          ...w,
          rank: index + 1 // Rank 1 is most frequent
        }))
        logger.info(`Loaded ${allWords.length} words from data/words.json`)
      }
    } catch (error) {
      logger.error('Failed to load words.json:', error instanceof Error ? error : new Error(String(error)))
    }

    // Load phrases.json (2-5gram) - already sorted by frequency in descending order
    let allPhrases: WordData[] = []
    try {
      const phrasesFile = bucket.file('data/phrases.json')
      const [exists] = await phrasesFile.exists()
      if (exists) {
        const [contents] = await phrasesFile.download()
        const phrasesData = JSON.parse(contents.toString())
        // Add rank based on position in array (1 = most frequent)
        allPhrases = phrasesData.map((p: WordData, index: number) => ({
          ...p,
          rank: index + 1 // Rank 1 is most frequent
        }))
        logger.info(`Loaded ${allPhrases.length} phrases from data/phrases.json`)
      }
    } catch (error) {
      logger.error('Failed to load phrases.json:', error instanceof Error ? error : new Error(String(error)))
    }

    // If replacements requested, fetch that many extra items (split between words and phrases)
    const WORDS_TARGET = replacementCount > 0 
      ? Math.ceil(replacementCount * 0.8) // 80% words for replacements
      : 200
    const PHRASES_TARGET = replacementCount > 0
      ? Math.ceil(replacementCount * 0.2) // 20% phrases for replacements
      : 50
    const PRIORITY_PERCENTAGE = replacementCount > 0 ? 0.0 : 0.7 // For replacements, skip priority (get fresh items)
    const STRONG_WORDS_PERCENTAGE = 0.15 // 15% of priority words should be strong words (for review)

    let words: WordData[] = []
    let phrases: WordData[] = []

    let wordsFromJson: string[] = []
    let phrasesFromJson: string[] = []
    let matchingDictionaryEntries: DictionaryEntry[] = []

    if (userId) {
      // Get dictionary entries separated into weak and strong words
      const { weakWords, strongWords } = await getDictionaryWords(userId)
      
      // Calculate how many strong words to include (15% of priority portion)
      const totalPriorityCount = Math.floor((WORDS_TARGET + PHRASES_TARGET) * PRIORITY_PERCENTAGE)
      const strongWordsCount = Math.floor(totalPriorityCount * STRONG_WORDS_PERCENTAGE)
      const weakWordsCount = totalPriorityCount - strongWordsCount
      
      // Randomly select strong words for review (with probability)
      const selectedStrongWords = strongWords
        .sort(() => Math.random() - 0.5) // Shuffle
        .slice(0, Math.min(strongWordsCount, strongWords.length))
        .map(entry => entry.word)
      
      // Select weak words (words user got wrong)
      const selectedWeakWords = weakWords
        .sort(() => Math.random() - 0.5) // Shuffle
        .slice(0, Math.min(weakWordsCount, weakWords.length))
        .map(entry => entry.word)
      
      // Combine weak and strong words for prioritization
      const priorityWords = [...selectedWeakWords, ...selectedStrongWords]
      
      logger.info(`Found ${weakWords.length} weak words and ${strongWords.length} strong words for user ${userId}`)
      logger.info(`Selected ${selectedWeakWords.length} weak words and ${selectedStrongWords.length} strong words for review`)

      // Prioritize words and phrases together: use dictionary entries (weak + some strong), then fill rest from JSON
      const result = prioritizeWords(allWords, allPhrases, priorityWords, WORDS_TARGET, PHRASES_TARGET, PRIORITY_PERCENTAGE, excludedItems)
      words = result.words
      phrases = result.phrases
      wordsFromJson = result.wordsFromJson
      phrasesFromJson = result.phrasesFromJson

      // Select dictionary entries that match the selected words and phrases (from both weak and strong)
      const selectedKeys = new Set<string>()
      words.forEach(w => selectedKeys.add(w.gram.toLowerCase().trim()))
      phrases.forEach(p => selectedKeys.add(p.gram.toLowerCase().trim()))
      
      const allDictionaryEntries = [...weakWords, ...strongWords]
      matchingDictionaryEntries = allDictionaryEntries.filter(entry => 
        selectedKeys.has(entry.word.toLowerCase().trim())
      )

      logger.info(`Prioritized words: ${words.length} total (target: ${WORDS_TARGET}) = ${result.prioritizedWordsCount} from dictionary + ${wordsFromJson.length} from JSON`)
      logger.info(`Prioritized phrases: ${phrases.length} total (target: ${PHRASES_TARGET}) = ${result.prioritizedPhrasesCount} from dictionary + ${phrasesFromJson.length} from JSON`)
      logger.info(`Found ${matchingDictionaryEntries.length} matching dictionary entries for selected words/phrases`)

    } else {
      // No userId, all words are from JSON - select with letter diversity
      const usedWordsNoUser = new Set<string>()
      const usedPhrasesNoUser = new Set<string>()
      
      words = selectWithLetterDiversity(
        allWords.map(w => ({ ...w, gram: w.gram.toLowerCase().trim() })),
        WORDS_TARGET,
        usedWordsNoUser,
        excludedItems
      )
      phrases = selectWithLetterDiversity(
        allPhrases.map(p => ({ ...p, gram: p.gram.toLowerCase().trim() })),
        PHRASES_TARGET,
        usedPhrasesNoUser,
        excludedItems
      )
      
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
