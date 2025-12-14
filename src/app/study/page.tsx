'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/app/components/Header'
import { User } from '@/types/user'
import { WordData } from '@/types/dictionary'
import { logger } from '@/libs/utils/logger'

const MAX_STUDY_TIME = 30 * 60 * 1000 // 30 minutes in milliseconds
const WORDS_TO_LOAD = 200
const PHRASES_TO_LOAD = 50
const WORDS_TO_SELECT = 50

interface VocabularyItem extends WordData {
  definition?: string
  synonyms?: string[]
  antonyms?: string[]
  isSelected?: boolean
}

export default function StudyPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [words, setWords] = useState<VocabularyItem[]>([])
  const [phrases, setPhrases] = useState<VocabularyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [preparing, setPreparing] = useState(false)
  const [timeRemaining, setTimeRemaining] = useState(MAX_STUDY_TIME)
  const [isTimerRunning, setIsTimerRunning] = useState(false)
  const [selectedCount, setSelectedCount] = useState(0)

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
    loadVocabulary()
  }, [])

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
      setWords(data.words.map((w: any) => ({ ...w, isSelected: false })))
      setPhrases(data.phrases.map((p: any) => ({ ...p, isSelected: false })))
      setLoading(false)
    } catch (error) {
      console.error('Failed to load vocabulary:', error)
      setLoading(false)
    }
  }

  const startTimer = () => {
    setIsTimerRunning(true)
  }

  const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const toggleSelection = (item: VocabularyItem, isPhrase: boolean) => {
    if (isPhrase) {
      setPhrases(prev => prev.map(p => 
        p.gram === item.gram 
          ? { ...p, isSelected: !p.isSelected }
          : p
      ))
    } else {
      setWords(prev => prev.map(w => 
        w.gram === item.gram 
          ? { ...w, isSelected: !w.isSelected }
          : w
      ))
    }
  }

  useEffect(() => {
    const totalSelected = [...words, ...phrases].filter(item => item.isSelected).length
    setSelectedCount(totalSelected)
  }, [words, phrases])

  const prepareDefinitions = async () => {
    if (preparing) return
    
    setPreparing(true)
    try {
      const allItems = [...words, ...phrases]
      const response = await fetch('/api/vocabulary/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          words: words.map(w => ({ gram: w.gram, freq: w.freq })),
          phrases: phrases.map(p => ({ gram: p.gram, freq: p.freq }))
        })
      })

      if (!response.ok) throw new Error('Failed to prepare definitions')
      
      const result = await response.json()
      console.log(`Definitions prepared: ${result.processed} processed, ${result.skipped} skipped`)
      
      // Reload items with definitions from dictionary
      await loadDefinitions()
    } catch (error) {
      console.error('Failed to prepare definitions:', error)
      alert('Failed to prepare definitions. Please try again.')
    } finally {
      setPreparing(false)
    }
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
      
      // Update words with definitions
      setWords(prev => prev.map(w => ({
        ...w,
        ...data.definitions[w.gram]
      })))
      
      // Update phrases with definitions
      setPhrases(prev => prev.map(p => ({
        ...p,
        ...data.definitions[p.gram]
      })))
      
      alert(`Loaded definitions for ${Object.keys(data.definitions).length} items`)
    } catch (error) {
      console.error('Failed to load definitions:', error)
      alert('Failed to load definitions. Please try again.')
    }
  }

  const handleReady = async () => {
    const selected = [...words, ...phrases].filter(item => item.isSelected)
    
    if (selected.length !== WORDS_TO_SELECT) {
      alert(`Please select exactly ${WORDS_TO_SELECT} words/phrases for testing`)
      return
    }

    if (!user) return

    try {
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!user) return null

  const allItems = [...words, ...phrases]
  const canProceed = selectedCount === WORDS_TO_SELECT

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
              <div className="text-sm font-semibold">
                Time: {formatTime(timeRemaining)}
              </div>
              {!isTimerRunning && timeRemaining > 0 && (
                <button
                  onClick={startTimer}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  Start Timer
                </button>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Study Vocabulary</h1>
            <p className="text-gray-700 mb-4">
              Study {WORDS_TO_LOAD} words and {PHRASES_TO_LOAD} phrases. Select {WORDS_TO_SELECT} for testing.
            </p>
            
            <div className="flex gap-4 mb-4">
              <button
                onClick={prepareDefinitions}
                disabled={preparing}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
              >
                {preparing ? 'Preparing...' : 'Load Definitions'}
              </button>
              
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">
                  Selected: {selectedCount} / {WORDS_TO_SELECT}
                </span>
              </div>
            </div>

            <button
              onClick={handleReady}
              disabled={!canProceed}
              className="w-full px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-semibold"
            >
              {canProceed ? 'Ready to Move to Testing' : `Select ${WORDS_TO_SELECT - selectedCount} more items`}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Words Section */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                Words ({words.filter(w => w.isSelected).length} selected)
              </h2>
              <div className="max-h-96 overflow-y-auto space-y-2">
                {words.map((word, idx) => (
                  <div
                    key={idx}
                    className={`p-3 border-2 rounded-lg cursor-pointer transition-all ${
                      word.isSelected
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => toggleSelection(word, false)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{word.gram}</span>
                      <input
                        type="checkbox"
                        checked={word.isSelected || false}
                        onChange={() => toggleSelection(word, false)}
                        className="ml-2"
                      />
                    </div>
                    {word.definition && (
                      <div className="mt-2 text-sm text-gray-600">
                        <p><strong>Definition:</strong> {word.definition}</p>
                        {word.synonyms && word.synonyms.length > 0 && (
                          <p><strong>Synonyms:</strong> {word.synonyms.join(', ')}</p>
                        )}
                        {word.antonyms && word.antonyms.length > 0 && (
                          <p><strong>Antonyms:</strong> {word.antonyms.join(', ')}</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Phrases Section */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                Phrases ({phrases.filter(p => p.isSelected).length} selected)
              </h2>
              <div className="max-h-96 overflow-y-auto space-y-2">
                {phrases.map((phrase, idx) => (
                  <div
                    key={idx}
                    className={`p-3 border-2 rounded-lg cursor-pointer transition-all ${
                      phrase.isSelected
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => toggleSelection(phrase, true)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{phrase.gram}</span>
                      <input
                        type="checkbox"
                        checked={phrase.isSelected || false}
                        onChange={() => toggleSelection(phrase, true)}
                        className="ml-2"
                      />
                    </div>
                    {phrase.definition && (
                      <div className="mt-2 text-sm text-gray-600">
                        <p><strong>Definition:</strong> {phrase.definition}</p>
                        {phrase.synonyms && phrase.synonyms.length > 0 && (
                          <p><strong>Synonyms:</strong> {phrase.synonyms.join(', ')}</p>
                        )}
                        {phrase.antonyms && phrase.antonyms.length > 0 && (
                          <p><strong>Antonyms:</strong> {phrase.antonyms.join(', ')}</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
