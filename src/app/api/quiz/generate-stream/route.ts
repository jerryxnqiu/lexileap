import { NextResponse } from 'next/server'
import { getDb } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'
import { getSecret } from '@/libs/firebase/secret'
import { QuizQuestion, WordData } from '@/types/quiz'

export const dynamic = 'force-dynamic'

async function getQuestionsFromBank(count: number): Promise<QuizQuestion[]> {
  try {
    const db = await getDb()
    const snapshot = await db.collection('quiz_questions').limit(count * 2).get()
    const questions: QuizQuestion[] = []
    snapshot.forEach(doc => {
      const data = doc.data()
      if (data?.word && Array.isArray(data?.options) && data.options.length === 4) {
        questions.push({
          id: doc.id,
          word: data.word,
          correctDefinition: data.correctDefinition,
          options: data.options,
          correctIndex: data.correctIndex,
          wordnetData: data.wordnetData || { pos: '', examples: [] }
        })
      }
    })
    return questions.sort(() => Math.random() - 0.5).slice(0, count)
  } catch (error) {
    logger.error('SSE: bank fetch error:', error instanceof Error ? error : new Error(String(error)))
    return []
  }
}

async function getUserWeakWords(db: FirebaseFirestore.Firestore, userId: string, limit: number): Promise<string[]> {
  try {
    // Pull user's attempts and aggregate wrong rates per word
    const attemptsSnap = await db.collection('user_quiz_attempts')
      .where('userId', '==', userId)
      .get()

    type Agg = { total: number; wrong: number; lastFailedAt?: number }
    const agg: Record<string, Agg> = {}
    attemptsSnap.forEach(doc => {
      const raw = doc.data() as Record<string, unknown>
      const answers = Array.isArray(raw?.answers) ? (raw.answers as Array<Record<string, unknown>>) : []
      const ts = raw?.completedAt as { toDate?: () => Date } | undefined
      const completedAt: number = ts?.toDate?.()?.getTime?.() ?? Date.now()
      for (const a of answers) {
        const word = (a?.word as string | undefined)
        const isCorrect = (a?.isCorrect as boolean | undefined)
        if (!word) continue
        if (!agg[word]) agg[word] = { total: 0, wrong: 0 }
        agg[word].total += 1
        if (isCorrect === false) {
          agg[word].wrong += 1
          const t = completedAt
          if (!agg[word].lastFailedAt || t > agg[word].lastFailedAt) agg[word].lastFailedAt = t
        }
      }
    })

    // Score: higher wrong rate first; tie-breaker: more recent failure
    const scored = Object.entries(agg)
      .filter(([, v]) => v.total > 0)
      .map(([word, v]) => ({
        word,
        wrongRate: v.wrong / v.total,
        lastFailedAt: v.lastFailedAt ?? 0
      }))
      .sort((a, b) => {
        if (b.wrongRate !== a.wrongRate) return b.wrongRate - a.wrongRate
        return (b.lastFailedAt - a.lastFailedAt)
      })
      .slice(0, Math.max(limit, 0))

    return scored.map(s => s.word)
  } catch {
    return []
  }
}

async function getRandomWords(count: number): Promise<WordData[]> {
  try {
    const { getStorage } = await import('@/libs/firebase/admin')
    const storage = await getStorage()
    const file = storage.bucket().file('data/wordnet.json')
    const [fileContent] = await file.download()
    const wordnetData = JSON.parse(fileContent.toString())
    const allWordIds = Object.keys(wordnetData)
    const shuffledWordIds = allWordIds.sort(() => Math.random() - 0.5)
    const words: WordData[] = []
    for (const wordId of shuffledWordIds.slice(0, count)) {
      const wd = wordnetData[wordId]
      if (wd?.senses?.length > 0) {
        words.push({
          wordId: wd.wordId,
          word: wd.word,
          pos: wd.pos,
          senses: wd.senses
        })
      }
    }
    return words
  } catch (error) {
    logger.error('SSE: random words error:', error instanceof Error ? error : new Error(String(error)))
    return []
  }
}

async function callDeepSeekForOptions(word: string, correctDefinition: string): Promise<string[] | null> {
  try {
    const apiKey = await getSecret('lexileap-deepseek-api-key')
    if (!apiKey) {
      logger.error('SSE: DeepSeek key missing')
      return null
    }
    const prompt = `Generate three plausible but incorrect definitions for the English word "${word}".\n` +
      `The correct definition is: ${correctDefinition}.\n` +
      `Rules:\n- Do NOT repeat the correct meaning.\n- Keep each option concise (max 15 words).\n- Return ONLY a JSON array of strings.`
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
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

async function createQuizQuestion(wordData: WordData): Promise<QuizQuestion> {
  const sense = wordData.senses[0]
  const correctDefinition = sense.definition || 'No definition available'
  const aiOptions = await callDeepSeekForOptions(wordData.word, correctDefinition)
  if (!aiOptions || aiOptions.length !== 3) {
    throw new Error('DeepSeek did not return 3 options')
  }
  const allOptions = [correctDefinition, ...aiOptions]
  const shuffled = allOptions.sort(() => Math.random() - 0.5)
  const correctIndex = shuffled.indexOf(correctDefinition)
  return {
    id: wordData.wordId,
    word: wordData.word,
    correctDefinition,
    options: shuffled,
    correctIndex,
    wordnetData: { pos: wordData.pos, examples: sense.examples || [] }
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('userId')
  if (!userId) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }
      try {
        send('start', { message: 'Starting generation', target: 50 })

        // New-first strategy: aim for at least 30 new words from big JSON
        const questions: QuizQuestion[] = []
        const usedWords = new Set<string>()
        const target = 50
        let batchIndex = 0
        let consecutiveNoProgress = 0
        const minNewFirst = 30
        // Phase 1: create new questions until we reach minNewFirst (or target)
        while (questions.length < Math.min(minNewFirst, target)) {
          batchIndex += 1
          const remaining = target - questions.length
          const candidates = await getRandomWords(remaining * 3)
          send('batch', { batch: batchIndex, fetched: candidates.length, remaining })
          const before = questions.length
          for (const w of candidates) {
            if (questions.length >= target) break
            if (usedWords.has(w.word)) continue
            try {
              const q = await createQuizQuestion(w)
              questions.push(q)
              usedWords.add(w.word)
              send('word', { word: w.word, count: questions.length })
              await saveQuestionToBank(q)
            } catch {
              send('error', { word: w.word, message: 'DeepSeek failed' })
            }
          }

          // If this batch made no progress, try more candidates; only top-up after a few consecutive no-progress batches
          if (questions.length === before) {
            consecutiveNoProgress += 1
            if (consecutiveNoProgress >= 3) {
              const needed = Math.min(target - questions.length, Math.max(0, minNewFirst - questions.length))
              if (needed > 0) {
                const bankTopup = await getQuestionsFromBank(needed * 3)
                const uniqueTopup = bankTopup.filter(q => !usedWords.has(q.word)).slice(0, needed)
                uniqueTopup.forEach(q => usedWords.add(q.word))
                questions.push(...uniqueTopup)
                send('admin-bank-topup', { added: uniqueTopup.length, total: questions.length, adminOnly: true })
              }
              break
            }
          } else {
            consecutiveNoProgress = 0
          }
        }

        // Phase 2: top-up remaining with bank, prioritizing user's weak words
        if (questions.length < target) {
          const db = await getDb()
          const need = target - questions.length
          // Get prioritized list of weak words
          const weakWords = await getUserWeakWords(db, userId, need * 3)
          // Fetch bank pool and map by word for quick lookup
          const bankPool = await getQuestionsFromBank(need * 5)
          const byWord = new Map<string, QuizQuestion>()
          for (const q of bankPool) if (!byWord.has(q.word)) byWord.set(q.word, q)

          const picked: QuizQuestion[] = []
          // 1) Pick from weakWords first
          for (const w of weakWords) {
            if (picked.length >= need) break
            if (usedWords.has(w)) continue
            const q = byWord.get(w)
            if (q) {
              picked.push(q)
              usedWords.add(w)
            }
          }
          // 2) Fill remaining from any bank questions
          if (picked.length < need) {
            for (const q of bankPool) {
              if (picked.length >= need) break
              if (usedWords.has(q.word)) continue
              picked.push(q)
              usedWords.add(q.word)
            }
          }
          questions.push(...picked)
          send('admin-bank-topup', { added: picked.length, total: questions.length, adminOnly: true })
        }

        // Create session
        const now = new Date()
        const dateStr = now.toISOString().split('T')[0]
        const timeStr = now.toISOString().split('T')[1].split('.')[0].replace(/:/g, '-')
        const hash = Math.random().toString(36).substring(2, 8)
        const sanitizedUserId = userId.replace(/[^a-zA-Z0-9]/g, '_')
        const sessionId = `${dateStr}_${timeStr}_${sanitizedUserId}_${hash}`

        const session = {
          id: sessionId,
          userId,
          questions,
          currentQuestion: 0,
          answers: new Array(questions.length).fill(null),
          startTime: now,
          date: dateStr
        }

        const db = await getDb()
        await db.collection('quiz_sessions').doc(sessionId).set(session)
        send('complete', { session })
        controller.close()
      } catch (error) {
        logger.error('SSE generation error:', error instanceof Error ? error : new Error(String(error)))
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
}


