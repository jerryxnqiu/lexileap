import { NextResponse, NextRequest } from 'next/server'
import { getDb } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'
import { decryptSessionId } from '@/libs/utils/encryption'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    // Try to decrypt if it's an encrypted token, otherwise use as-is
    let sessionId: string
    try {
      sessionId = await decryptSessionId(id)
    } catch {
      // If decryption fails, assume it's already a plain sessionId
      sessionId = id
    }
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

    // Check if session is completed
    const isCompleted = sessionData.completed === true

    // Helper function to convert Firestore Timestamp to ISO string
    const convertTimestamp = (ts: unknown): string | null => {
      if (!ts) return null
      if (typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
        return (ts as { toDate: () => Date }).toDate().toISOString()
      }
      if (ts instanceof Date) {
        return ts.toISOString()
      }
      return typeof ts === 'string' ? ts : null
    }

    // If session is not completed (active quiz), return session data directly
    if (!isCompleted) {
      const session = {
        id: sessionId,
        userId: sessionData.userId,
        questions: sessionData.questions || [],
        currentQuestion: sessionData.currentQuestion || 0,
        answers: sessionData.answers || [],
        startTime: convertTimestamp(sessionData.startTime) || '',
        endTime: convertTimestamp(sessionData.endTime),
        score: sessionData.score,
        completed: false
      }
      return NextResponse.json(session)
    }

    // If completed, return merged data with attempt details (for viewing results)
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


