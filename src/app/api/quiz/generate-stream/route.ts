import { NextResponse } from 'next/server'
import { getDb } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'
import { getSecret } from '@/libs/firebase/secret'
import { QuizQuestion } from '@/types/quiz'
import { encryptSessionId } from '@/libs/utils/encryption'

export const dynamic = 'force-dynamic'

const CONCURRENT_REQUESTS = 50 // Process 50 API calls in parallel
const BATCH_DELAY = 200 // Small delay between batches to avoid overwhelming the API

// Get a question from the bank for a specific word (if it exists)
async function getQuestionFromBankForWord(word: string): Promise<QuizQuestion | null> {
  try {
    const db = await getDb()
    const wordLower = word.toLowerCase().trim()
    const snapshot = await db.collection('quiz_questions')
      .where('word', '==', wordLower)
      .limit(1)
      .get()
    
    if (snapshot.empty) return null
    
    const doc = snapshot.docs[0]
    const data = doc.data()
    if (data?.word && Array.isArray(data?.options) && data.options.length === 4) {
      return {
        id: doc.id,
        word: data.word,
        correctDefinition: data.correctDefinition,
        options: data.options,
        correctIndex: data.correctIndex,
        nGramFreq: typeof data.nGramFreq === 'number' ? data.nGramFreq : (data.wordnetData?.frequency || 0)
      }
    }
    return null
  } catch (error) {
    logger.error('SSE: get question from bank error:', error instanceof Error ? error : new Error(String(error)))
    return null
  }
}

// Set to false to disable DeepSeek API calls and use mock data for testing
const DEEPSEEK_ENABLED = true

async function callDeepSeekForOptions(word: string, correctDefinition: string): Promise<string[] | null> {
  // Return mock data when DeepSeek is disabled
  if (!DEEPSEEK_ENABLED) {
    logger.info(`[MOCK] Returning mock options for "${word}" (DeepSeek disabled)`)
    return [
      `An unrelated meaning of "${word}" (mock 1)`,
      `Another incorrect sense of "${word}" (mock 2)`,
      `A plausible but wrong definition for "${word}" (mock 3)`
    ]
  }

  try {
    const apiKey = await getSecret('lexileap-deepseek-api-key')
    if (!apiKey) {
      logger.error('SSE: DeepSeek key missing')
      return null
    }
    const prompt = `Generate three plausible but incorrect definitions for the English word "${word}".
The correct definition is: ${correctDefinition}.

CRITICAL REQUIREMENTS:
- Return EXACTLY 3 incorrect definitions as a JSON array of strings
- Each definition must be a complete sentence or phrase (not just a single word)
- Each definition should be plausible but clearly different from the correct meaning
- Keep each definition concise (max 15 words)
- Use simple language suitable for children under 12 years old
- Do NOT repeat or closely mirror the correct definition
- Make the distractors believable but wrong (e.g., for "cat", don't use "a type of dog")

RETURN FORMAT:
Return ONLY a valid JSON array with exactly 3 string elements, for example:
["A definition that sounds plausible but is wrong", "Another incorrect but believable definition", "A third distractor definition"]

Do NOT include any explanation, markdown formatting, or additional text - ONLY the JSON array.`
    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: 'You are a helpful assistant for a vocabulary quiz app.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.8,
        max_tokens: 200
      })
    })
    if (!resp.ok) return null
    const data = await resp.json()
    const content: string | undefined = data?.choices?.[0]?.message?.content
    if (!content) return null
    try {
      const parsed = JSON.parse(content)
      if (Array.isArray(parsed)) {
        const cleaned = parsed.map((s: unknown) => typeof s === 'string' ? s.trim() : '').filter((s: string) => s).slice(0, 3)
        return cleaned.length === 3 ? cleaned : null
      }
    } catch {
      const lines = content.split('\n').map(l => l.replace(/^[-*\d\.\)\s]+/, '').trim()).filter(Boolean).slice(0, 3)
      if (lines.length === 3) return lines
    }
    return null
  } catch (error) {
    logger.error('SSE: DeepSeek call failed:', error instanceof Error ? error : new Error(String(error)))
    return null
  }
}

async function saveQuestionToBank(question: QuizQuestion): Promise<void> {
  try {
    const db = await getDb()
    const ref = db.collection('quiz_questions').doc(question.id)
    const doc = await ref.get()
    if (doc.exists) {
      await ref.update({ timesTested: (doc.data()?.timesTested || 0) + 1, lastUsed: new Date() })
    } else {
      await ref.set({ ...question, timesTested: 1, timesCorrect: 0, createdAt: new Date(), lastUsed: new Date() })
    }
  } catch (e) {
    logger.error('SSE: save to bank error:', e instanceof Error ? e : new Error(String(e)))
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const userId = body.userId
    // Receive full DictionaryEntry objects from frontend
    const words = body.words as Array<{
      word: string
      definition?: string
      synonyms?: string[]
      antonyms?: string[]
      frequency?: number
      lastUpdated?: Date | string
    }> | undefined

    logger.info('SSE: Handling quiz generation', { userId, wordCount: words?.length })

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    if (!words || words.length === 0) {
      return NextResponse.json({ error: 'Words array is required' }, { status: 400 })
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder()
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\n`))
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }
        try {
          send('start', { message: 'Starting generation', target: words.length })

          // Use the full DictionaryEntry objects provided (already randomly selected 50 in frontend)
          logger.info('SSE: Processing provided words', { wordCount: words.length })

          const questions: QuizQuestion[] = []
          const db = await getDb()

          // Process a single word and return the question (or null if skipped)
          const processWord = async (wordEntry: { word: string, definition?: string, frequency?: number }): Promise<{ question: QuizQuestion | null, word: string, source: 'bank' | 'generated' | 'skipped', error?: string }> => {
            const word = wordEntry.word.toLowerCase().trim()
            
            // Get definition from entry, or fetch from database if missing
            let correctDefinition = wordEntry.definition
            if (!correctDefinition) {
              // Try to fetch from dictionary database
              try {
                const dictDoc = await db.collection('dictionary').doc(word).get()
                if (dictDoc.exists) {
                  const dictData = dictDoc.data()
                  correctDefinition = dictData?.definition || null
                  logger.info(`SSE: Fetched definition from database for "${word}"`)
                }
              } catch (error) {
                logger.warn(`SSE: Failed to fetch definition from database for "${word}"`, { 
                  error: error instanceof Error ? error.message : String(error) 
                })
              }
            }
            
            // If still no definition, skip this word
            if (!correctDefinition) {
              logger.warn(`SSE: Skipping "${word}" - no definition available`)
              return { question: null, word, source: 'skipped', error: 'No definition available' }
            }
            
            // Check if question exists in quiz_questions
            let question = await getQuestionFromBankForWord(word)
            
            if (question) {
              // Use existing question
              logger.info(`SSE: Using existing question for "${word}"`)
              return { question, word, source: 'bank' }
            } else {
              // Generate new question using DeepSeek
              try {
                // Generate options using DeepSeek
                const aiOptions = await callDeepSeekForOptions(word, correctDefinition)
                if (!aiOptions || aiOptions.length !== 3) {
                  logger.error(`SSE: Failed to generate options for "${word}"`)
                  return { question: null, word, source: 'skipped', error: 'Failed to generate options' }
                }

                // Create question
                const allOptions = [correctDefinition, ...aiOptions]
                const shuffledOptions = allOptions.sort(() => Math.random() - 0.5)
                const correctIndex = shuffledOptions.indexOf(correctDefinition)

                question = {
                  id: word,
                  word: word,
                  correctDefinition,
                  options: shuffledOptions,
                  correctIndex,
                  nGramFreq: wordEntry.frequency || 0
                }

                // Save to quiz_questions bank
                await saveQuestionToBank(question)
                logger.info(`SSE: Generated and saved question for "${word}"`)
                return { question, word, source: 'generated' }
              } catch (error) {
                logger.error(`SSE: Error generating question for "${word}":`, error instanceof Error ? error : new Error(String(error)))
                return { question: null, word, source: 'skipped', error: 'Generation failed' }
              }
            }
          }

          // Process words in parallel batches
          for (let i = 0; i < words.length; i += CONCURRENT_REQUESTS) {
            const batch = words.slice(i, i + CONCURRENT_REQUESTS)
            logger.info(`SSE: Processing batch ${Math.floor(i / CONCURRENT_REQUESTS) + 1}: ${batch.length} words`)

            // Process batch in parallel
            const results = await Promise.all(batch.map(processWord))

            // Collect results and send SSE events
            for (const { question, word, source, error } of results) {
              if (question) {
                questions.push(question)
                send('word', { word, count: questions.length, source })
              } else if (error) {
                send('error', { word, message: error })
              }
            }

            // Small delay between batches to avoid overwhelming the API
            if (i + CONCURRENT_REQUESTS < words.length) {
              await new Promise(resolve => setTimeout(resolve, BATCH_DELAY))
            }
          }

          // Create and save session with all 50 questions
          const now = new Date()
          const dateStr = now.toISOString().split('T')[0]
          const timeStr = now.toISOString().split('T')[1].split('.')[0].replace(/:/g, '-')
          const hash = Math.random().toString(36).substring(2, 8)
          const sanitizedUserId = userId.replace(/[^a-zA-Z0-9]/g, '_')
          const sessionId = `study_${dateStr}_${timeStr}_${sanitizedUserId}_${hash}`

          const session = {
            id: sessionId,
            userId,
            questions,
            currentQuestion: 0,
            answers: new Array(questions.length).fill(null),
            startTime: now,
            date: dateStr
          }

          await db.collection('quiz_sessions').doc(sessionId).set(session)
          logger.info('SSE: Saved quiz session', { sessionId, questionCount: questions.length })

          // Encrypt sessionId before sending to client
          const encryptedToken = await encryptSessionId(sessionId)
          send('complete', { message: 'Quiz questions prepared', count: questions.length, sessionId, token: encryptedToken })
          controller.close()
        } catch (error) {
          logger.error('SSE POST generation error:', error instanceof Error ? error : new Error(String(error)))
          const encoder = new TextEncoder()
          controller.enqueue(encoder.encode(`event: error\n`))
          controller.enqueue(encoder.encode(`data: {"error":"internal"}\n\n`))
          controller.close()
        }
      }
    })

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive'
      }
    })
  } catch (error) {
    logger.error('POST request error:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}


