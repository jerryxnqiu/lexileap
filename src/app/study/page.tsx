'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/app/components/Header'
import { User } from '@/types/user'
import { WordData, DictionaryEntry } from '@/types/dictionary'

const MAX_STUDY_TIME = 30 * 60 * 1000 // 30 minutes in milliseconds
const WORDS_TO_LOAD = 200
const PHRASES_TO_LOAD = 50
const WORDS_TO_TEST = 50 // System will randomly select 50 for quiz

export default function StudyPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [words, setWords] = useState<DictionaryEntry[]>([])
  const [phrases, setPhrases] = useState<DictionaryEntry[]>([])
  const [displayItems, setDisplayItems] = useState<DictionaryEntry[]>([]) // Shuffled combined words + phrases for display
  const [loading, setLoading] = useState(true)
  const [loadingProgress, setLoadingProgress] = useState<number>(0)
  const [loadingStep, setLoadingStep] = useState<string>('Initializing...')
  const [timeRemaining, setTimeRemaining] = useState(MAX_STUDY_TIME)
  const [isTimerRunning, setIsTimerRunning] = useState(false)
  const [preparingQuiz, setPreparingQuiz] = useState(false)

  useEffect(() => {
    const savedUser = localStorage.getItem('lexileapUser')
    if (savedUser) {
      try {
        const userData = JSON.parse(savedUser)
        setUser(userData)
      } catch {
        router.push('/')
      }
    } else {
      router.push('/')
    }
  }, [router])

  useEffect(() => {
    if (user) {
      loadVocabulary()
    }
  }, [user])

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null
    if (isTimerRunning && timeRemaining > 0) {
      interval = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev <= 1000) {
            setIsTimerRunning(false)
            return 0
          }
          return prev - 1000
        })
      }, 1000)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isTimerRunning, timeRemaining])


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
          lastUpdated: new Date(),
          synonymsProcessed: false
        } as DictionaryEntry
      })
      
      setLoadingProgress(100)
      setLoadingStep('Ready')
      
      // Step 3: Store words and phrases separately, then create shuffled combined list for display
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
          words: newWords.map(w => ({ gram: w.gram, freq: w.freq })),
          phrases: newPhrases.map(p => ({ gram: p.gram, freq: p.freq }))
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
    console.log('[Study] prepareQuizQuestions called', { user: !!user, wordsCount: wordsForQuiz.length, usingProvided: !!wordsToUse })
    
    if (!user || wordsForQuiz.length === 0) {
      console.log('[Study] prepareQuizQuestions: early return - no user or words')
      return
    }
    
    setPreparingQuiz(true)
    
    try {
      // Randomly select 50 words from available words (already separated from phrases)
      const shuffled = [...wordsForQuiz].sort(() => Math.random() - 0.5)
      const selectedWords = shuffled.slice(0, WORDS_TO_TEST)
      
      console.log('[Study] prepareQuizQuestions: selected words', { count: selectedWords.length })
      
      if (selectedWords.length === 0) {
        console.log('[Study] prepareQuizQuestions: no words selected')
        setPreparingQuiz(false)
        return
      }

      // Send full DictionaryEntry objects directly to backend
      console.log('[Study] prepareQuizQuestions: calling /api/quiz/generate')
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

      console.log('[Study] prepareQuizQuestions: response received', { ok: response.ok, status: response.status, hasBody: !!response.body })
      
      if (!response.ok || !response.body) {
        console.error('[Study] prepareQuizQuestions: response not OK or missing body', { status: response.status })
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
      // System randomly selects 50 WORDS (no phrases) - ensure lowercase
      const allItems = [...words]
      if (allItems.length === 0) {
        alert('No words available for testing yet. Please wait for loading to finish.')
        return
      }

      const shuffled = [...allItems].sort(() => Math.random() - 0.5)
      const selected = shuffled.slice(0, WORDS_TO_TEST).map(item => ({
        gram: (item.word || '').toLowerCase().trim(),
        freq: item.frequency || 0
      }))

      // Navigate to quiz with selected words
      router.push(`/quiz?selection=${encodeURIComponent(JSON.stringify(selected.map(s => s.gram)))}`)
    } catch (error) {
      alert('Failed to start quiz. Please try again.')
    }
  }

  if (loading) {
    return (
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
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-sky-50 to-indigo-100">
      <Header user={user} onLogout={() => { localStorage.removeItem('lexileapUser'); router.push('/'); }} />
      
      <main className="container mx-auto px-4 py-8 pt-4">
        <div className="max-w-6xl mx-auto">
          <div className="mb-6 flex items-center justify-between sticky top-16 z-20 bg-white/90 backdrop-blur-md px-4 py-3 rounded-lg shadow-sm border border-indigo-100">
            <button 
              onClick={() => router.push('/')}
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
              disabled={preparingQuiz}
              className={`w-full px-6 py-3 rounded-lg font-semibold ${
                preparingQuiz
                  ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer'
              }`}
            >
              {preparingQuiz
                ? 'Preparing quiz questions...'
                : `Ready to Move to Testing (System will randomly select ${WORDS_TO_TEST} words)`}
            </button>
          </div>

          <div className="bg-white rounded-lg shadow-lg p-4 md:p-6">
            <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-4">
              Vocabulary Table ({words.length} words + {phrases.length} phrases = {words.length + phrases.length} total items)
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
                  {displayItems.map((item, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-semibold text-gray-900">{item.word}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-700">
                          {item.definition || <span className="text-gray-400 italic">No definition loaded</span>}
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
              {displayItems.map((item, idx) => (
                <div key={idx} className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
                  <div className="mb-3">
                    <h3 className="text-base font-semibold text-gray-900 mb-2">{item.word}</h3>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="font-medium text-gray-600">Definition: </span>
                      <span className="text-gray-700">
                        {item.definition || <span className="text-gray-400 italic">No definition loaded</span>}
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
      </main>
    </div>
  )
}
