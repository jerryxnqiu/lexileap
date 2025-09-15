import { NextResponse } from 'next/server'
import { getDb } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, context: { params: { id: string } }) {
  try {
    const sessionId = context.params.id
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing session id' }, { status: 400 })
    }

    const db = await getDb()
    // Fetch session (questions/options)
    const sessionDoc = await db.collection('quiz_sessions').doc(sessionId).get()
    if (!sessionDoc.exists) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    const sessionData = sessionDoc.data() as Record<string, unknown>

    // Fetch user attempt (answers, score, timestamps)
    const attemptDoc = await db.collection('user_quiz_attempts').doc(sessionId).get()
    const attemptData = attemptDoc.exists ? (attemptDoc.data() as Record<string, unknown>) : undefined

    const questions = Array.isArray(sessionData?.questions) ? (sessionData!.questions as Array<Record<string, unknown>>) : []
    // Prefer answers from attempt; fallback to session.answers if present
    const answersArray = Array.isArray(attemptData?.answers)
      ? (attemptData!.answers as Array<Record<string, unknown>>)
      : (Array.isArray(sessionData?.answers) ? (sessionData!.answers as Array<unknown>) : [])

    const merged = questions.map((q, idx) => {
      const ans = answersArray[idx] as Record<string, unknown> | undefined
      const userAnswer = (ans?.userAnswer as number | null | undefined) ?? null
      const isCorrect = (ans?.isCorrect as boolean | undefined)
      const correctIndex = (q?.correctIndex as number | undefined) ?? -1
      return {
        word: q.word as string,
        options: (q.options as string[]) || [],
        correctIndex,
        userAnswer,
        isCorrect: typeof isCorrect === 'boolean' ? isCorrect : (userAnswer !== null && userAnswer === correctIndex)
      }
    })

    return NextResponse.json({
      sessionId,
      userId: sessionData.userId,
      startTime: sessionData.startTime,
      endTime: attemptData?.completedAt ?? sessionData.endTime,
      score: attemptData?.score ?? sessionData.score,
      totalQuestions: questions.length,
      questions: merged
    })
  } catch (error) {
    logger.error('Attempt fetch error:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Failed to load attempt' }, { status: 500 })
  }
}


