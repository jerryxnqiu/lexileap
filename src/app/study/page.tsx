'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/app/components/Header'
import { User } from '@/types/user'
import { WordData } from '@/types/dictionary'

const MAX_STUDY_TIME = 30 * 60 * 1000 // 30 minutes in milliseconds
const WORDS_TO_LOAD = 200
const PHRASES_TO_LOAD = 50
const WORDS_TO_SELECT = 50 // System will randomly select 50 for quiz

interface VocabularyItem extends WordData {
  definition?: string
  synonyms?: string[]
  antonyms?: string[]
}

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
      
      // Words and phrases are already prioritized by the API
      setWords(data.words.map((w: any) => ({ ...w })))
      setPhrases(data.phrases.map((p: any) => ({ ...p })))
      
      // Automatically load definitions from database
      await loadDefinitions()
      
      setLoading(false)
      // Start timer immediately when content is loaded
      setIsTimerRunning(true)
    } catch (error) {
      console.error('Failed to load vocabulary:', error)
      setLoading(false)
    }
  }

  const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const loadDefinitions = async () => {
    try {
      const allTexts = [...words, ...phrases].map(item => item.gram)
      const response = await fetch('/api/vocabulary/definitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: allTexts })
      })

      if (!response.ok) throw new Error('Failed to load definitions')
      
      const data = await response.json()
      
      // Update words with definitions from database
      setWords(prev => prev.map(w => ({
        ...w,
        ...data.definitions[w.gram]
      })))
      
      // Update phrases with definitions from database
      setPhrases(prev => prev.map(p => ({
        ...p,
        ...data.definitions[p.gram]
      })))
      
      // Words from database (wrong words, dictionary) should already have definitions
      // Only prepare definitions for words from words.json/phrases.json that don't exist in database
      // We need to track which words came from JSON files
      const loadResponse = await fetch(`/api/vocabulary/load?userId=${encodeURIComponent(user?.email || '')}`)
      if (loadResponse.ok) {
        const loadData = await loadResponse.json()
        const wordsFromJson = loadData.fromJson?.words || []
        const phrasesFromJson = loadData.fromJson?.phrases || []
        
        // Only prepare words from JSON that don't have definitions
        const newWords = words.filter(w => 
          wordsFromJson.includes(w.gram) && !data.definitions[w.gram]?.definition
        )
        const newPhrases = phrases.filter(p => 
          phrasesFromJson.includes(p.gram) && !data.definitions[p.gram]?.definition
        )
        
        if (newWords.length > 0 || newPhrases.length > 0) {
          console.log(`Preparing definitions for ${newWords.length} words and ${newPhrases.length} phrases from JSON files...`)
          await prepareNewWordsFromJson(newWords, newPhrases)
        }
      }
    } catch (error) {
      console.error('Failed to load definitions:', error)
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
      
      const result = await response.json()
      console.log(`Prepared ${result.processed} new definitions from JSON files`)
      
      // Reload definitions after preparation
      await loadDefinitions()
    } catch (error) {
      console.error('Failed to prepare new words from JSON:', error)
    }
  }

  const handleReady = async () => {
    if (!user) return

    try {
      // System randomly selects 50 words/phrases
      const allItems = [...words, ...phrases]
      const shuffled = [...allItems].sort(() => Math.random() - 0.5)
      const selected = shuffled.slice(0, WORDS_TO_SELECT)

      // Save selected words
      const response = await fetch('/api/vocabulary/save-selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.email,
          selectedWords: selected.map(item => ({ gram: item.gram, freq: item.freq }))
        })
      })

      if (!response.ok) throw new Error('Failed to save selection')
      
      // Navigate to quiz with selected words
      router.push(`/quiz?selection=${encodeURIComponent(JSON.stringify(selected.map(s => s.gram)))}`)
    } catch (error) {
      console.error('Failed to save selection:', error)
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
              className="text-sm text-gray-600 hover:text-gray-800"
            >
              ← Back to Menu
            </button>
            
            <div className="flex items-center gap-4">
              <div className="bg-indigo-100 px-4 py-2 rounded-lg border-2 border-indigo-300">
                <span className="text-xs font-medium text-indigo-700 uppercase tracking-wide">Time</span>
                <div className="text-2xl font-bold text-indigo-900 mt-1">
                  {formatTime(timeRemaining)}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Study Vocabulary</h1>
            <p className="text-gray-700 mb-4">
              Study {WORDS_TO_LOAD} words and {PHRASES_TO_LOAD} phrases. System will randomly select {WORDS_TO_SELECT} for testing.
            </p>
            <p className="text-sm text-gray-500 mb-4">
              Definitions are automatically loaded from the database.
            </p>

            <button
              onClick={handleReady}
              className="w-full px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold"
            >
              Ready to Move to Testing (System will randomly select {WORDS_TO_SELECT} words)
            </button>
          </div>

          <div className="bg-white rounded-lg shadow-lg p-6 overflow-x-auto">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Vocabulary Table ({words.length + phrases.length} items)
            </h2>
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
        </div>
      </main>
    </div>
  )
}
