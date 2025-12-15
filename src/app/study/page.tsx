'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/app/components/Header'
import { User } from '@/types/user'
import { VocabularyItem } from '@/types/dictionary'

const MAX_STUDY_TIME = 30 * 60 * 1000 // 30 minutes in milliseconds
const WORDS_TO_LOAD = 200
const PHRASES_TO_LOAD = 50
const WORDS_TO_TEST = 50 // System will randomly select 50 for quiz

export default function StudyPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [words, setWords] = useState<VocabularyItem[]>([])
  const [phrases, setPhrases] = useState<VocabularyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingProgress, setLoadingProgress] = useState<number>(0)
  const [loadingStep, setLoadingStep] = useState<string>('Initializing...')
  const [timeRemaining, setTimeRemaining] = useState(MAX_STUDY_TIME)
  const [isTimerRunning, setIsTimerRunning] = useState(false)

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

  const loadVocabulary = async () => {
    if (!user) return
    
    try {
      setLoadingProgress(5)
      setLoadingStep('Loading vocabulary selection...')
      const response = await fetch(`/api/vocabulary/load?userId=${encodeURIComponent(user.email)}`)
      if (!response.ok) throw new Error('Failed to load vocabulary')
      
      const data = await response.json()
      
      // Words and phrases are already prioritized by the API - ensure lowercase
      const initialWords = data.words.map((w: any) => ({ ...w, gram: (w.gram || '').toLowerCase().trim() }))
      const initialPhrases = data.phrases.map((p: any) => ({ ...p, gram: (p.gram || '').toLowerCase().trim() }))
      
      // Track which items came from JSON (the 30% fill-up that need DeepSeek preparation)
      const wordsFromJson = (data.fromJson?.words || []).map((w: string) => w.toLowerCase().trim())
      const phrasesFromJson = (data.fromJson?.phrases || []).map((p: string) => p.toLowerCase().trim())
      
      setWords(initialWords)
      setPhrases(initialPhrases)
      
      setLoadingProgress(25)
      setLoadingStep('Loading definitions from dictionary...')

      // Automatically load definitions from database and prepare new ones for JSON items that don't have definitions
      await loadDefinitions(initialWords, initialPhrases, wordsFromJson, phrasesFromJson)
      
      setLoading(false)
      setLoadingProgress(100)
      setLoadingStep('Ready')

      // Start timer immediately when content is loaded
      setIsTimerRunning(true)
    } catch (error) {
      setLoading(false)
    }
  }

  const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const loadDefinitions = async (wordsToLoad: VocabularyItem[] = words, phrasesToLoad: VocabularyItem[] = phrases, wordsFromJson: string[] = [], phrasesFromJson: string[] = []) => {
    try {
      // Separate Step 1 items (from database) and Step 2 items (from JSON)
      setLoadingStep('Applying dictionary definitions...')
      const step1Words = wordsToLoad.filter(w => {
        const key = (w.gram || '').toLowerCase().trim()
        return !wordsFromJson.includes(key)
      })
      const step1Phrases = phrasesToLoad.filter(p => {
        const key = (p.gram || '').toLowerCase().trim()
        return !phrasesFromJson.includes(key)
      })
      
      const step2Words = wordsToLoad.filter(w => {
        const key = (w.gram || '').toLowerCase().trim()
        return wordsFromJson.includes(key)
      })
      const step2Phrases = phrasesToLoad.filter(p => {
        const key = (p.gram || '').toLowerCase().trim()
        return phrasesFromJson.includes(key)
      })
      
      // Step 1: Load definitions from database only for Step 1 items (from database)
      // These items should have definitions in the database, but some might be missing
      let step1WordsWithDefs = step1Words
      let step1PhrasesWithDefs = step1Phrases
      
      if (step1Words.length > 0 || step1Phrases.length > 0) {
        setLoadingProgress(40)
        const step1Texts = [...step1Words, ...step1Phrases].map(item => (item.gram || '').toLowerCase().trim())
        const response = await fetch('/api/vocabulary/definitions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ words: step1Texts })
        })

        if (response.ok) {
          const data = await response.json()
          
          // Update Step 1 words with definitions from database
          step1WordsWithDefs = step1Words.map(w => {
            const key = (w.gram || '').toLowerCase().trim()
            const defData = data.definitions[key]
            const definition = defData?.definition && defData.definition !== null ? defData.definition : undefined
            return {
              ...w,
              gram: key,
              definition: definition,
              synonyms: defData?.synonyms || [],
              antonyms: defData?.antonyms || []
            }
          })
          
          // Update Step 1 phrases with definitions from database
          step1PhrasesWithDefs = step1Phrases.map(p => {
            const key = (p.gram || '').toLowerCase().trim()
            const defData = data.definitions[key]
            const definition = defData?.definition && defData.definition !== null ? defData.definition : undefined
            return {
              ...p,
              gram: key,
              definition: definition,
              synonyms: defData?.synonyms || [],
              antonyms: defData?.antonyms || []
            }
          })
        }
      }
      
      // Step 2: Prepare definitions for ALL items without definitions using DeepSeek
      // This includes Step 2 items (from JSON) AND Step 1 items that don't have definitions
      const wordsWithoutDefs = [
        ...step1WordsWithDefs.filter(w => !w.definition),
        ...step2Words
      ]
      const phrasesWithoutDefs = [
        ...step1PhrasesWithDefs.filter(p => !p.definition),
        ...step2Phrases
      ]
      
      let step2WordsWithDefs = step2Words
      let step2PhrasesWithDefs = step2Phrases
      
      if (wordsWithoutDefs.length > 0 || phrasesWithoutDefs.length > 0) {
        setLoadingStep('Preparing new definitions (based on LLM)...')
        setLoadingProgress(65)
        const prepareResult = await prepareNewWordsFromJson(wordsWithoutDefs, phrasesWithoutDefs)
        
        if (prepareResult?.definitions) {
          setLoadingProgress(85)
          // Update Step 1 words that didn't have definitions
          step1WordsWithDefs = step1WordsWithDefs.map(w => {
            const key = (w.gram || '').toLowerCase().trim()
            const newDefData = prepareResult.definitions[key]
            if (newDefData) {
              const definition = (newDefData.definition && newDefData.definition !== null) 
                ? newDefData.definition 
                : undefined
              return {
                ...w,
                gram: key,
                definition: definition,
                synonyms: newDefData.synonyms || [],
                antonyms: newDefData.antonyms || []
              }
            }
            return w
          })
          
          // Update Step 1 phrases that didn't have definitions
          step1PhrasesWithDefs = step1PhrasesWithDefs.map(p => {
            const key = (p.gram || '').toLowerCase().trim()
            const newDefData = prepareResult.definitions[key]
            if (newDefData) {
              const definition = (newDefData.definition && newDefData.definition !== null) 
                ? newDefData.definition 
                : undefined
              return {
                ...p,
                gram: key,
                definition: definition,
                synonyms: newDefData.synonyms || [],
                antonyms: newDefData.antonyms || []
              }
            }
            return p
          })
          
          // Update Step 2 words with definitions from DeepSeek
          step2WordsWithDefs = step2Words.map(w => {
            const key = (w.gram || '').toLowerCase().trim()
            const newDefData = prepareResult.definitions[key]
            if (newDefData) {
              const definition = (newDefData.definition && newDefData.definition !== null) 
                ? newDefData.definition 
                : undefined
              return {
                ...w,
                gram: key,
                definition: definition,
                synonyms: newDefData.synonyms || [],
                antonyms: newDefData.antonyms || []
              }
            }
            return w
          })
          
          // Update Step 2 phrases with definitions from DeepSeek
          step2PhrasesWithDefs = step2Phrases.map(p => {
            const key = (p.gram || '').toLowerCase().trim()
            const newDefData = prepareResult.definitions[key]
            if (newDefData) {
              const definition = (newDefData.definition && newDefData.definition !== null) 
                ? newDefData.definition 
                : undefined
              return {
                ...p,
                gram: key,
                definition: definition,
                synonyms: newDefData.synonyms || [],
                antonyms: newDefData.antonyms || []
              }
            }
            return p
          })
        }
      }
      
      // Step 3: Combine Step 1 and Step 2 items, maintaining original order
      // Reconstruct the original order by checking if each item is from Step 1 or Step 2
      const finalWords = wordsToLoad.map(w => {
        const key = (w.gram || '').toLowerCase().trim()
        const isFromJson = wordsFromJson.includes(key)
        if (isFromJson) {
          return step2WordsWithDefs.find(sw => (sw.gram || '').toLowerCase().trim() === key) || w
        } else {
          return step1WordsWithDefs.find(sw => (sw.gram || '').toLowerCase().trim() === key) || w
        }
      })
      
      const finalPhrases = phrasesToLoad.map(p => {
        const key = (p.gram || '').toLowerCase().trim()
        const isFromJson = phrasesFromJson.includes(key)
        if (isFromJson) {
          return step2PhrasesWithDefs.find(sp => (sp.gram || '').toLowerCase().trim() === key) || p
        } else {
          return step1PhrasesWithDefs.find(sp => (sp.gram || '').toLowerCase().trim() === key) || p
        }
      })
      
      // Step 4: Display all 250 items with their definitions
      setWords(finalWords)
      setPhrases(finalPhrases)
      
    } catch (error) {
      // Error handled silently - definitions will be missing
    }
  }

  const prepareNewWordsFromJson = async (newWords: VocabularyItem[], newPhrases: VocabularyItem[]): Promise<{ definitions: Record<string, { definition: string | null, synonyms: string[], antonyms: string[] }> } | null> => {
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

  const handleReady = async () => {
    if (!user) return

    try {
      // System randomly selects 50 WORDS (no phrases) - ensure lowercase
      const allItems = [...words]
      if (allItems.length === 0) {
        alert('No words available for testing yet. Please wait for loading to finish.')
        return
      }

      const shuffled = [...allItems].sort(() => Math.random() - 0.5)
      const selected = shuffled.slice(0, WORDS_TO_TEST).map(item => ({
        gram: (item.gram || '').toLowerCase().trim(),
        freq: item.freq
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
              className="w-full px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold cursor-pointer"
            >
              Ready to Move to Testing (System will randomly select {WORDS_TO_TEST} words)
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
                  {[...words, ...phrases].map((item, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-semibold text-gray-900">{item.gram}</div>
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
              {[...words, ...phrases].map((item, idx) => (
                <div key={idx} className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
                  <div className="mb-3">
                    <h3 className="text-base font-semibold text-gray-900 mb-2">{item.gram}</h3>
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
