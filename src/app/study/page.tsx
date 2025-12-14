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
      const response = await fetch(`/api/vocabulary/load?userId=${encodeURIComponent(user.email)}`)
      if (!response.ok) throw new Error('Failed to load vocabulary')
      
      const data = await response.json()
      
      // Words and phrases are already prioritized by the API - ensure lowercase
      const initialWords = data.words.map((w: any) => ({ ...w, gram: (w.gram || '').toLowerCase().trim() }))
      const initialPhrases = data.phrases.map((p: any) => ({ ...p, gram: (p.gram || '').toLowerCase().trim() }))
      
      setWords(initialWords)
      setPhrases(initialPhrases)
      
      // Automatically load definitions from database - pass the words/phrases directly
      await loadDefinitions(initialWords, initialPhrases)
      
      setLoading(false)
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

  const loadDefinitions = async (wordsToLoad: VocabularyItem[] = words, phrasesToLoad: VocabularyItem[] = phrases) => {
    try {
      // Normalize all words to lowercase before fetching definitions
      const allTexts = [...wordsToLoad, ...phrasesToLoad].map(item => (item.gram || '').toLowerCase().trim())
      const response = await fetch('/api/vocabulary/definitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: allTexts })
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')
        throw new Error(`Failed to load definitions: ${response.status} ${errorText}`)
      }
      
      const data = await response.json()
      
      // Update words with definitions from database - normalize keys to lowercase
      const updatedWords = wordsToLoad.map(w => {
        const key = (w.gram || '').toLowerCase().trim()
        return {
          ...w,
          gram: key, // Ensure gram is lowercase
          ...data.definitions[key]
        }
      })
      setWords(updatedWords)
      
      // Update phrases with definitions from database - normalize keys to lowercase
      const updatedPhrases = phrasesToLoad.map(p => {
        const key = (p.gram || '').toLowerCase().trim()
        return {
          ...p,
          gram: key, // Ensure gram is lowercase
          ...data.definitions[key]
        }
      })
      setPhrases(updatedPhrases)
      
      // Words from database (wrong words, dictionary) should already have definitions
      // Only prepare definitions for words from words.json/phrases.json that don't exist in database
      // We need to track which words came from JSON files
      const loadResponse = await fetch(`/api/vocabulary/load?userId=${encodeURIComponent(user?.email || '')}`)
      if (loadResponse.ok) {
        const loadData = await loadResponse.json()
        const wordsFromJson = loadData.fromJson?.words || []
        const phrasesFromJson = loadData.fromJson?.phrases || []
        
        // Only prepare words from JSON that don't have definitions - normalize to lowercase for comparison
        const newWords = updatedWords.filter(w => {
          const key = (w.gram || '').toLowerCase().trim()
          return wordsFromJson.includes(key) && !data.definitions[key]?.definition
        })
        const newPhrases = updatedPhrases.filter(p => {
          const key = (p.gram || '').toLowerCase().trim()
          return phrasesFromJson.includes(key) && !data.definitions[key]?.definition
        })
        
        if (newWords.length > 0 || newPhrases.length > 0) {
          await prepareNewWordsFromJson(newWords, newPhrases)
          
          // Reload definitions for the newly prepared words
          const newlyPreparedTexts = [...newWords, ...newPhrases].map(item => (item.gram || '').toLowerCase().trim())
          const definitionsResponse = await fetch('/api/vocabulary/definitions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ words: newlyPreparedTexts })
          })
          
          if (!definitionsResponse.ok) {
            // If definitions endpoint fails, still try to save what we have
            await saveAllToDictionary(updatedWords, updatedPhrases)
            return
          }
          
          if (definitionsResponse.ok) {
            const definitionsData = await definitionsResponse.json()
            
            // Update the words/phrases with newly prepared definitions
            const finalWords = updatedWords.map(w => {
              const key = (w.gram || '').toLowerCase().trim()
              return definitionsData.definitions[key] ? { ...w, ...definitionsData.definitions[key] } : w
            })
            const finalPhrases = updatedPhrases.map(p => {
              const key = (p.gram || '').toLowerCase().trim()
              return definitionsData.definitions[key] ? { ...p, ...definitionsData.definitions[key] } : p
            })
            
            setWords(finalWords)
            setPhrases(finalPhrases)
            
            // Save all to dictionary with the final updated data
            await saveAllToDictionary(finalWords, finalPhrases)
            return
          }
        }
      }
      
      // After all definitions are loaded/prepared, save all 250 items to dictionary
      await saveAllToDictionary(updatedWords, updatedPhrases)
    } catch (error) {
      // Error handled silently - definitions will be missing
    }
  }

  const prepareNewWordsFromJson = async (newWords: VocabularyItem[], newPhrases: VocabularyItem[]) => {
    try {
      if (newWords.length === 0 && newPhrases.length === 0) return
      
      const response = await fetch('/api/vocabulary/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          words: newWords.map(w => ({ gram: w.gram, freq: w.freq })),
          phrases: newPhrases.map(p => ({ gram: p.gram, freq: p.freq }))
        })
      })

      if (!response.ok) throw new Error('Failed to prepare definitions')
      
      await response.json()
      
      // Reload definitions after preparation - this will also save to dictionary
      // No need to call saveAllToDictionary here as loadDefinitions will handle it
    } catch (error) {
      // Error handled silently - definitions will be missing
    }
  }

  const saveAllToDictionary = async (wordsToSave: VocabularyItem[] = words, phrasesToSave: VocabularyItem[] = phrases) => {
    try {
      // Get all items with their definitions, synonyms, and antonyms
      const allItems = [...wordsToSave, ...phrasesToSave].map(item => ({
        gram: (item.gram || '').toLowerCase().trim(),
        freq: item.freq || 0,
        definition: item.definition || undefined,
        synonyms: item.synonyms || [],
        antonyms: item.antonyms || []
      }))

      if (allItems.length === 0) {
        return
      }

      const response = await fetch('/api/vocabulary/save-dictionary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: allItems })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(`Failed to save to dictionary: ${errorData.error || response.statusText}`)
      }
      
      await response.json()
    } catch (error) {
      // Error handled silently - items may not be saved but study can continue
      // Server-side logging will capture the error
    }
  }

  const handleReady = async () => {
    if (!user) return

    try {
      // System randomly selects 50 words/phrases - ensure lowercase
      const allItems = [...words, ...phrases]
      const shuffled = [...allItems].sort(() => Math.random() - 0.5)
      const selected = shuffled.slice(0, WORDS_TO_TEST).map(item => ({
        gram: (item.gram || '').toLowerCase().trim(),
        freq: item.freq
      }))

      // Save selected words (already normalized to lowercase)
      const response = await fetch('/api/vocabulary/save-selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.email,
          selectedWords: selected
        })
      })

      if (!response.ok) throw new Error('Failed to save selection')
      
      // Navigate to quiz with selected words
      router.push(`/quiz?selection=${encodeURIComponent(JSON.stringify(selected.map(s => s.gram)))}`)
    } catch (error) {
      alert('Failed to save selection. Please try again.')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-sky-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-lg text-gray-700 font-medium">Please wait while we are loading from database...</p>
          <p className="text-sm text-gray-500 mt-2">Preparing your personalized vocabulary list</p>
        </div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-sky-50 to-indigo-100">
      <Header user={user} onLogout={() => { localStorage.removeItem('lexileapUser'); router.push('/'); }} />
      
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-6 flex items-center justify-between">
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
