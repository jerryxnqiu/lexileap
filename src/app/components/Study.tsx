'use client'

import { useState, useEffect } from 'react'
import { User } from '@/types/user'
import { WordData, DictionaryEntry } from '@/types/dictionary'
import { ToastContainer, useToast } from '@/app/components/Toast'

const MAX_STUDY_TIME = 30 * 60 * 1000 // 30 minutes in milliseconds
const WORDS_TO_LOAD = 200
const PHRASES_TO_LOAD = 50
const WORDS_TO_TEST = 50 // System will randomly select 50 for quiz

interface StudyProps {
  user: User
  onQuizReady: (token: string) => void
  onBack: () => void
}

export function Study({ user, onQuizReady, onBack }: StudyProps) {
  const [words, setWords] = useState<DictionaryEntry[]>([])
  const [phrases, setPhrases] = useState<DictionaryEntry[]>([])
  const [displayItems, setDisplayItems] = useState<DictionaryEntry[]>([]) // Shuffled combined words + phrases for display
  const [loading, setLoading] = useState(true)
  const [loadingProgress, setLoadingProgress] = useState<number>(0)
  const [loadingStep, setLoadingStep] = useState<string>('Initializing...')
  const [timeRemaining, setTimeRemaining] = useState(MAX_STUDY_TIME)
  const [isTimerRunning, setIsTimerRunning] = useState(false)
  const [timerStartTime, setTimerStartTime] = useState<number | null>(null) // Store when timer started
  const [preparingQuiz, setPreparingQuiz] = useState(false)
  const [quizSessionId, setQuizSessionId] = useState<string | null>(null)
  const [quizSessionToken, setQuizSessionToken] = useState<string | null>(null)
  const { toasts, removeToast, showInfo, showError } = useToast()

  useEffect(() => {
    if (user) {
      loadVocabulary()
    }
  }, [user])

  // Update displayItems whenever words or phrases change (as definitions are loaded)
  useEffect(() => {
    const combined = [...words, ...phrases]
    const shuffled = [...combined].sort(() => Math.random() - 0.5)
    setDisplayItems(shuffled)
  }, [words, phrases])

  // Timer that works even when page is backgrounded - uses timestamp-based calculation
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null
    
    if (isTimerRunning && timerStartTime !== null) {
      const updateTimer = () => {
        const now = Date.now()
        const elapsed = now - timerStartTime
        const remaining = Math.max(0, MAX_STUDY_TIME - elapsed)
        
        if (remaining <= 0) {
          setTimeRemaining(0)
          setIsTimerRunning(false)
        } else {
          setTimeRemaining(remaining)
        }
      }
      
      // Update immediately
      updateTimer()
      
      // Then update every second
      interval = setInterval(updateTimer, 1000)
    }
    
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isTimerRunning, timerStartTime])
  
  // Handle page visibility changes (when tab comes back to foreground)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && isTimerRunning && timerStartTime !== null) {
        // Recalculate time when page becomes visible again
        const now = Date.now()
        const elapsed = now - timerStartTime
        const remaining = Math.max(0, MAX_STUDY_TIME - elapsed)
        setTimeRemaining(remaining)
        
        if (remaining <= 0) {
          setIsTimerRunning(false)
        }
      }
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [isTimerRunning, timerStartTime])

  // Loads vocabulary items for a user (or random items if no userId is provided)
  const loadVocabulary = async () => {
    if (!user) return
    
    try {
      setLoadingProgress(5)
      setLoadingStep('Loading vocabulary selection...')
      const response = await fetch(`/api/vocabulary/load?userId=${encodeURIComponent(user.email)}`)
      if (!response.ok) throw new Error('Failed to load vocabulary')
      
      const data = await response.json()
      
      // Words and phrases are already prioritized by the API - ensure lowercase
      // These include those from JSON and dictionary entries
      const initialWords = data.words.map((w: any) => ({ ...w, gram: (w.gram || '').toLowerCase().trim() }))
      const initialPhrases = data.phrases.map((p: any) => ({ ...p, gram: (p.gram || '').toLowerCase().trim() }))
      
      // Track which items came from JSON (the 30% fill-up that need DeepSeek preparation)
      const wordsFromJson = (data.fromJson?.words || []).map((w: string) => w.toLowerCase().trim())
      const phrasesFromJson = (data.fromJson?.phrases || []).map((p: string) => p.toLowerCase().trim())

      // Get dictionary entries from API (includes definition, synonyms, antonyms for dictionary items)
      const dictionaryEntries: DictionaryEntry[] = data.dictionaryEntries || []
      
      setLoadingProgress(25)
      setLoadingStep('Merging dictionary entries...')

      // Merge dictionary entries with words/phrases and prepare definitions for JSON items that don't have dictionary entries
      const { finalWords, finalPhrases } = await loadDefinitions(initialWords, initialPhrases, wordsFromJson, phrasesFromJson, dictionaryEntries)
      
      setLoading(false)
      setLoadingProgress(100)
      setLoadingStep('Ready')

      // Start timer immediately when content is loaded
      setTimerStartTime(Date.now())
      setIsTimerRunning(true)

      // Prepare quiz questions in the background (pass words directly since state update is async)
      prepareQuizQuestions(finalWords)
    } catch (error) {
      setLoading(false)
    }
  }

  const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  // Prepares definitions for JSON items using DeepSeek and combines with dictionary entries
  const loadDefinitions = async (
    wordsToLoad: WordData[] = [],
    phrasesToLoad: WordData[] = [],
    wordsFromJson: string[] = [],
    phrasesFromJson: string[] = [],
    dictionaryEntries: DictionaryEntry[] = []
  ): Promise<{ finalWords: DictionaryEntry[]; finalPhrases: DictionaryEntry[] }> => {
    try {
      // Create a map of dictionary entries for quick lookup
      const dictionaryMap = new Map<string, DictionaryEntry>()
      dictionaryEntries.forEach(entry => {
        const key = entry.word.toLowerCase().trim()
        dictionaryMap.set(key, entry)
      })
      
      // Step 1: Prepare definitions for JSON items using DeepSeek
      const jsonWords = wordsToLoad.filter(w => {
        const key = (w.gram || '').toLowerCase().trim()
        return wordsFromJson.includes(key)
      })
      const jsonPhrases = phrasesToLoad.filter(p => {
        const key = (p.gram || '').toLowerCase().trim()
        return phrasesFromJson.includes(key)
      })
      
      if (jsonWords.length > 0 || jsonPhrases.length > 0) {
        setLoadingStep('Preparing new definitions (based on LLM)...')
        setLoadingProgress(40)
        
        const prepareResult = await prepareNewWordsFromJson(jsonWords, jsonPhrases)
        
        if (prepareResult?.definitions) {
          setLoadingProgress(70)
          
          // Convert prepare result to DictionaryEntry format
          const preparedEntriesMap = new Map<string, DictionaryEntry>()
          Object.entries(prepareResult.definitions).forEach(([key, defData]) => {
            const wordData = [...jsonWords, ...jsonPhrases].find(item => 
              (item.gram || '').toLowerCase().trim() === key
            )
            if (wordData) {
              preparedEntriesMap.set(key, {
                word: key,
                definition: defData.definition && defData.definition !== null ? defData.definition : undefined,
                synonyms: defData.synonyms || [],
                antonyms: defData.antonyms || [],
                frequency: wordData.freq || 0,
                rank: wordData.rank, // Position in descending frequency order
                lastUpdated: new Date()
              })
            }
          })
          
          // Merge prepared entries into dictionary map
          preparedEntriesMap.forEach((entry, key) => {
            dictionaryMap.set(key, entry)
          })
        }
      }
      
      // Step 2: Combine dictionary entries and prepared entries, maintaining original order
      const finalWords = wordsToLoad.map((w: WordData) => {
        const key = (w.gram || '').toLowerCase().trim()
        return dictionaryMap.get(key) || {
          word: key,
          definition: undefined,
          synonyms: [],
          antonyms: [],
          frequency: w.freq || 0,
          rank: w.rank, // Position in descending frequency order
          lastUpdated: new Date(),
          synonymsProcessed: false
        } as DictionaryEntry
      })
      
      const finalPhrases = phrasesToLoad.map((p: WordData) => {
        const key = (p.gram || '').toLowerCase().trim()
        return dictionaryMap.get(key) || {
          word: key,
          definition: undefined,
          synonyms: [],
          antonyms: [],
          frequency: p.freq || 0,
          rank: p.rank, // Position in descending frequency order
          lastUpdated: new Date(),
          synonymsProcessed: false
        } as DictionaryEntry
      })
      
      // Step 3: Check for missing definitions and fetch replacements (more aggressive to ensure 250 items)
      let wordsWithoutDefs = finalWords.filter(w => !w.definition)
      let phrasesWithoutDefs = finalPhrases.filter(p => !p.definition)
      let missingCount = wordsWithoutDefs.length + phrasesWithoutDefs.length
      
      // Try to fetch replacements - be more aggressive with rounds and batch sizes
      let replacementRound = 0
      const maxReplacementRounds = 5 // Increased from 2 to 5
      
      while (missingCount > 0 && replacementRound < maxReplacementRounds) {
        replacementRound++
        wordsWithoutDefs = finalWords.filter(w => !w.definition)
        phrasesWithoutDefs = finalPhrases.filter(p => !p.definition)
        const currentMissingCount = wordsWithoutDefs.length + phrasesWithoutDefs.length
        
        if (currentMissingCount === 0) break // All definitions loaded, exit loop
        
        setLoadingStep(`Fetching ${currentMissingCount} replacement items (round ${replacementRound}/${maxReplacementRounds})...`)
        setLoadingProgress(85 + (replacementRound * 3))
        
        // Fetch replacement items from API (request significantly more to account for failures)
        try {
          // Build list of excluded items to send to API
          const usedKeys = [
            ...finalWords.map(w => w.word.toLowerCase().trim()),
            ...finalPhrases.map(p => p.word.toLowerCase().trim())
          ]
          
          const excludedParam = usedKeys.join(',')
          // Fetch 2x the missing count to account for potential failures in replacement items too
          const batchSize = Math.min(currentMissingCount * 2, 50) // Fetch up to 50 at a time, 2x missing count
          const replacementResponse = await fetch(
            `/api/vocabulary/load?userId=${encodeURIComponent(user.email)}&replacements=${batchSize}&exclude=${encodeURIComponent(excludedParam)}`
          )
          
          if (replacementResponse.ok) {
            const replacementData = await replacementResponse.json()
            
            // Get replacement words and phrases (API should have already excluded duplicates, but double-check)
            const usedKeysSet = new Set(usedKeys)
            
            // Get more replacements than needed to account for failures
            const replacementWords = replacementData.words
              .map((w: any) => ({ ...w, gram: (w.gram || '').toLowerCase().trim() }))
              .filter((w: any) => !usedKeysSet.has(w.gram.toLowerCase().trim()))
              .slice(0, Math.min(wordsWithoutDefs.length * 2, 50)) // Get 2x needed
            
            const replacementPhrases = replacementData.phrases
              .map((p: any) => ({ ...p, gram: (p.gram || '').toLowerCase().trim() }))
              .filter((p: any) => !usedKeysSet.has(p.gram.toLowerCase().trim()))
              .slice(0, Math.min(phrasesWithoutDefs.length * 2, 50)) // Get 2x needed
            
            // Prepare definitions for replacements
            if (replacementWords.length > 0 || replacementPhrases.length > 0) {
              const replacementDefs = await prepareNewWordsFromJson(replacementWords, replacementPhrases)
              
              if (replacementDefs?.definitions) {
                // Convert replacement definitions to DictionaryEntry format
                Object.entries(replacementDefs.definitions).forEach(([key, defData]) => {
                  const wordData = [...replacementWords, ...replacementPhrases].find(item => 
                    (item.gram || '').toLowerCase().trim() === key
                  )
                  if (wordData && defData.definition) {
                    dictionaryMap.set(key, {
                      word: key,
                      definition: defData.definition && defData.definition !== null ? defData.definition : undefined,
                      synonyms: defData.synonyms || [],
                      antonyms: defData.antonyms || [],
                      frequency: wordData.freq || 0,
                      rank: wordData.rank, // Position in descending frequency order
                      lastUpdated: new Date()
                    })
                  }
                })
              }
              
              // Replace items without definitions with replacements that have definitions
              // Separate replacements into words and phrases
              const availableWordReplacements: DictionaryEntry[] = []
              const availablePhraseReplacements: DictionaryEntry[] = []
              
              for (const replacement of replacementWords) {
                const key = replacement.gram.toLowerCase().trim()
                const replacementEntry = dictionaryMap.get(key)
                if (replacementEntry?.definition) {
                  availableWordReplacements.push(replacementEntry)
                }
              }
              
              for (const replacement of replacementPhrases) {
                const key = replacement.gram.toLowerCase().trim()
                const replacementEntry = dictionaryMap.get(key)
                if (replacementEntry?.definition) {
                  availablePhraseReplacements.push(replacementEntry)
                }
              }
              
              // Now replace items without definitions
              let wordReplacementIdx = 0
              let phraseReplacementIdx = 0
              
              const updatedWords = finalWords.map(w => {
                if (!w.definition && wordReplacementIdx < availableWordReplacements.length) {
                  const replacement = availableWordReplacements[wordReplacementIdx]
                  wordReplacementIdx++
                  return replacement
                }
                return w
              })
              
              // Replace phrases
              const updatedPhrases = finalPhrases.map(p => {
                if (!p.definition && phraseReplacementIdx < availablePhraseReplacements.length) {
                  const replacement = availablePhraseReplacements[phraseReplacementIdx]
                  phraseReplacementIdx++
                  return replacement
                }
                return p
              })
              
              // Update final arrays
              finalWords.splice(0, finalWords.length, ...updatedWords)
              finalPhrases.splice(0, finalPhrases.length, ...updatedPhrases)
              
              // Recalculate missing count for next iteration
              missingCount = finalWords.filter(w => !w.definition).length + finalPhrases.filter(p => !p.definition).length
            } else {
              // No replacements available, break to avoid infinite loop
              break
            }
          }
        } catch (error) {
          // Continue with what we have - silently handle error
          console.error('Failed to fetch replacement items:', error)
          // Don't break immediately - try one more round
          if (replacementRound >= 3) break
        }
      }
      
      setLoadingProgress(100)
      setLoadingStep('Ready')
      
      // Step 4: Store words and phrases separately, then create shuffled combined list for display
      setWords(finalWords)
      setPhrases(finalPhrases)
      
      // Shuffle words and phrases together for display
      const combined = [...finalWords, ...finalPhrases]
      const shuffled = [...combined].sort(() => Math.random() - 0.5)
      setDisplayItems(shuffled)
      
      // Return words and phrases so they can be used immediately (state update is async)
      return { finalWords, finalPhrases }
    } catch (error) {
      // Error handled silently - definitions will be missing
      return { finalWords: [], finalPhrases: [] }
    }
  }

  // Prepares definitions for new words and phrases using DeepSeek
  const prepareNewWordsFromJson = async (newWords: WordData[], newPhrases: WordData[]): Promise<{ definitions: Record<string, { definition: string | null, synonyms: string[], antonyms: string[] }> } | null> => {
    try {
      if (newWords.length === 0 && newPhrases.length === 0) return null
      
      const response = await fetch('/api/vocabulary/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          words: newWords.map(w => ({ gram: w.gram, freq: w.freq, rank: w.rank })),
          phrases: newPhrases.map(p => ({ gram: p.gram, freq: p.freq, rank: p.rank }))
        })
      })

      if (!response.ok) throw new Error('Failed to prepare definitions')
      
      const result = await response.json()
      
      // Return definitions for immediate display (saving to DB happens in background in the endpoint)
      return { definitions: result.definitions || {} }
    } catch (error) {
      // Error handled silently - definitions will be missing
      return null
    }
  }

  // Prepares quiz questions in the background
  // Randomly selects 50 words from the available words and sends them to the backend
  const prepareQuizQuestions = async (wordsToUse?: DictionaryEntry[]) => {
    const wordsForQuiz = wordsToUse || words
    
    if (!user || wordsForQuiz.length === 0) {
      return
    }
    
    setPreparingQuiz(true)
    
    try {
      // Randomly select 50 words from available words (already separated from phrases)
      const shuffled = [...wordsForQuiz].sort(() => Math.random() - 0.5)
      const selectedWords = shuffled.slice(0, WORDS_TO_TEST)
      
      if (selectedWords.length === 0) {
        setPreparingQuiz(false)
        return
      }

      // Send full DictionaryEntry objects directly to backend
      const response = await fetch('/api/quiz/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.email,
          words: selectedWords
        })
      })
      
      if (!response.ok || !response.body) {
        setPreparingQuiz(false)
        return
      }

      // Read SSE stream manually from POST response
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const processStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              setPreparingQuiz(false)
              break
            }

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]
              if (line.startsWith('event: complete')) {
                // Try to parse token from the data line
                if (i + 1 < lines.length && lines[i + 1].startsWith('data: ')) {
                  try {
                    const dataStr = lines[i + 1].substring(6) // Remove 'data: ' prefix
                    const data = JSON.parse(dataStr)
                    // Store both sessionId (for internal use) and token (for URL)
                    if (data.sessionId) {
                      setQuizSessionId(data.sessionId)
                    }
                    if (data.token) {
                      setQuizSessionToken(data.token)
                    }
                  } catch {
                    // Ignore parsing errors
                  }
                }
                setPreparingQuiz(false)
                return
              } else if (line.startsWith('event: error')) {
                setPreparingQuiz(false)
                return
              }
            }
          }
        } catch (error) {
          setPreparingQuiz(false)
        }
      }

      processStream()
    } catch (error) {
      setPreparingQuiz(false)
      // Silently handle error - quiz can still proceed with existing questions
    }
  }

  const handleReady = async () => {
    if (!user) return
    if (preparingQuiz) return // Prevent action while preparing quiz questions

    try {
      // Use the encrypted token from the prepared quiz session (already encrypted by backend)
      if (quizSessionToken) {
        onQuizReady(quizSessionToken)
      } else {
        showInfo(
          'Quiz Preparation in Progress',
          'Quiz questions are still being prepared. Please wait a moment before trying again.'
        )
      }
    } catch (error) {
      showError(
        'Failed to Start Quiz',
        'Please try again. If the problem persists, refresh the page.'
      )
    }
  }

  if (loading) {
    return (
      <>
        <ToastContainer toasts={toasts} onRemove={removeToast} />
        <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-sky-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="relative w-56 h-56 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-indigo-200 via-sky-200 to-emerald-200 animate-pulse"></div>
            <div className="absolute inset-4 rounded-full bg-white shadow-inner flex items-center justify-center">
              <div className="text-3xl font-bold text-indigo-700">{Math.min(loadingProgress, 100)}%</div>
            </div>
          </div>
          <p className="text-lg text-gray-700 font-semibold">{loadingStep}</p>
          <p className="text-sm text-gray-500 mt-2">Preparing your personalized vocabulary list</p>
          <div className="mt-4 w-64 mx-auto h-2 rounded-full bg-indigo-100 overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${Math.min(loadingProgress, 100)}%` }}
            ></div>
          </div>
        </div>
      </div>
      </>
    )
  }

  return (
    <>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between sticky top-16 z-20 bg-white/90 backdrop-blur-md px-4 py-3 rounded-lg shadow-sm border border-indigo-100">
        <button 
          onClick={onBack}
          className="text-sm text-gray-600 hover:text-gray-800 cursor-pointer"
        >
          ← Back to Menu
        </button>
        
        <div className="flex items-center gap-4">
          <div className="bg-indigo-100 px-4 py-2 rounded-lg border-2 border-indigo-300 flex items-center gap-3">
            <span className="text-sm font-medium text-indigo-700 uppercase tracking-wide">Time:</span>
            <span className="text-2xl font-bold text-indigo-900">
              {formatTime(timeRemaining)}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Study Vocabulary</h1>
        <p className="text-gray-700 mb-4">
          Study {WORDS_TO_LOAD} words and {PHRASES_TO_LOAD} phrases. System will randomly select {WORDS_TO_TEST} for testing when time is up or you click the button below.
        </p>

        <button
          onClick={handleReady}
          disabled={preparingQuiz || !quizSessionToken}
          className={`w-full px-6 py-3 rounded-lg font-semibold ${
            preparingQuiz || !quizSessionToken
              ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
              : 'bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer'
          }`}
        >
          {preparingQuiz
            ? 'Preparing quiz questions...'
            : !quizSessionToken
            ? 'Preparing quiz questions...'
            : `Ready to Move to Testing (System will randomly select ${WORDS_TO_TEST} words)`}
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-lg p-4 md:p-6">
        <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-4">
          Vocabulary Table ({words.length} words + {phrases.length} phrases = {words.length + phrases.length} total items)
          {displayItems.filter(item => item.definition).length < displayItems.length && (
            <span className="text-sm font-normal text-gray-500 ml-2">
              ({displayItems.filter(item => item.definition).length} with definitions loaded)
            </span>
          )}
        </h2>
        
        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Word/Phrase
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Definition
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Synonyms
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Antonyms
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {displayItems.filter(item => item.definition).map((item, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-semibold text-gray-900">{item.word}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-700">
                      {item.definition}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-700">
                      {item.synonyms && item.synonyms.length > 0 
                        ? item.synonyms.join(', ') 
                        : <span className="text-gray-400 italic">No synonyms</span>}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-700">
                      {item.antonyms && item.antonyms.length > 0 
                        ? item.antonyms.join(', ') 
                        : <span className="text-gray-400 italic">No antonyms</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden space-y-4">
          {displayItems.filter(item => item.definition).map((item, idx) => (
            <div key={idx} className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
              <div className="mb-3">
                <h3 className="text-base font-semibold text-gray-900 mb-2">{item.word}</h3>
              </div>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="font-medium text-gray-600">Definition: </span>
                  <span className="text-gray-700">
                    {item.definition}
                  </span>
                </div>
                <div>
                  <span className="font-medium text-gray-600">Synonyms: </span>
                  <span className="text-gray-700">
                    {item.synonyms && item.synonyms.length > 0 
                      ? item.synonyms.join(', ') 
                      : <span className="text-gray-400 italic">No synonyms</span>}
                  </span>
                </div>
                <div>
                  <span className="font-medium text-gray-600">Antonyms: </span>
                  <span className="text-gray-700">
                    {item.antonyms && item.antonyms.length > 0 
                      ? item.antonyms.join(', ') 
                      : <span className="text-gray-400 italic">No antonyms</span>}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
    </>
  )
}
