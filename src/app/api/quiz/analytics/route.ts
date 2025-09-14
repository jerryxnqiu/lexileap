import { NextResponse } from 'next/server'
import { getDb } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'
import { DocumentSnapshot } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') || 'overview'
    const userId = searchParams.get('userId')
    const days = parseInt(searchParams.get('days') || '30')

    const db = await getDb()
    const results: any = {}

    switch (type) {
      case 'overview':
        results.overview = await getOverviewStats(db, days)
        break
      case 'user':
        if (!userId) {
          return NextResponse.json({ error: 'User ID required for user analytics' }, { status: 400 })
        }
        results.user = await getUserStats(db, userId, days)
        break
      case 'words':
        results.words = await getWordStats(db, days)
        break
      case 'recent':
        results.recent = await getRecentActivity(db, days)
        break
      default:
        // Return all analytics
        results.overview = await getOverviewStats(db, days)
        results.words = await getWordStats(db, days)
        results.recent = await getRecentActivity(db, days)
    }

    return NextResponse.json(results)
  } catch (error) {
    logger.error('Analytics error:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 })
  }
}

async function getOverviewStats(db: any, days: number) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - days)

  // Get total users who took quizzes
  const usersSnapshot = await db.collection('users')
    .where('lastQuizDate', '>=', cutoffDate)
    .get()

  // Get total quiz sessions
  const sessionsSnapshot = await db.collection('quiz_sessions')
    .where('startTime', '>=', cutoffDate)
    .where('completed', '==', true)
    .get()

  let totalScore = 0
  let totalQuestions = 0
  const scores: number[] = []

  sessionsSnapshot.forEach((doc: DocumentSnapshot) => {
    const data = doc.data()
    if (data && data.score !== undefined) {
      totalScore += data.score
      totalQuestions += data.questions?.length || 0
      scores.push(data.score)
    }
  })

  const averageScore = scores.length > 0 ? Math.round(totalScore / scores.length) : 0
  const averagePercentage = totalQuestions > 0 ? Math.round((totalScore / totalQuestions) * 100) : 0

  return {
    totalUsers: usersSnapshot.size,
    totalQuizzes: sessionsSnapshot.size,
    averageScore,
    averagePercentage,
    totalQuestions,
    period: `${days} days`
  }
}

async function getUserStats(db: any, userId: string, days: number) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - days)

  // Get ALL user's quiz attempts (not limited by days for complete history)
  // Query by session ID pattern since userId is embedded in session ID
  const sanitizedUserId = userId.replace(/[^a-zA-Z0-9]/g, '_')
  const attemptsSnapshot = await db.collection('user_quiz_attempts')
    .where('__name__', '>=', `_${sanitizedUserId}_`)
    .where('__name__', '<', `_${sanitizedUserId}_\uf8ff`)
    .orderBy('completedAt', 'desc')
    .get()

  const allAttempts = attemptsSnapshot.docs.map((doc: DocumentSnapshot) => {
    const data = doc.data()
    return {
      id: doc.id,
      userId: userId, // Extract from session ID
      ...data,
      completedAt: data?.completedAt?.toDate(),
      createdAt: data?.createdAt?.toDate()
    }
  })

  // Filter recent attempts if days specified
  const recentAttempts = days > 0 ? 
    allAttempts.filter((attempt: any) => attempt.completedAt >= cutoffDate) : 
    allAttempts

  const scores = allAttempts.map((a: { score: number }) => a.score).filter((s: number | undefined) => s !== undefined)
  const recentScores = recentAttempts.map((a: { score: number }) => a.score).filter((s: number | undefined) => s !== undefined)
  
  const overallAverageScore = scores.length > 0 ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0
  const recentAverageScore = recentScores.length > 0 ? Math.round(recentScores.reduce((a: number, b: number) => a + b, 0) / recentScores.length) : 0

  // Get user's overall stats
  const userDoc = await db.collection('users').doc(userId).get()
  const userData = userDoc.exists ? userDoc.data() : null

  // Calculate additional stats
  const bestScore = Math.max(...scores, 0)
  const worstScore = Math.min(...scores, 0)
  const improvement = allAttempts.length > 1 ? 
    (recentScores.slice(0, 5).reduce((a: number, b: number) => a + b, 0) / Math.min(5, recentScores.length)) - 
    (scores.slice(-5).reduce((a: number, b: number) => a + b, 0) / Math.min(5, scores.length)) : 0

  return {
    userId,
    allAttempts: allAttempts.slice(0, 100), // Return up to 100 most recent
    recentAttempts: recentAttempts,
    totalQuizzes: allAttempts.length,
    overallAverageScore,
    recentAverageScore,
    bestScore,
    worstScore,
    improvement: Math.round(improvement),
    firstQuizDate: allAttempts.length > 0 ? allAttempts[allAttempts.length - 1].completedAt : null,
    lastQuizDate: allAttempts.length > 0 ? allAttempts[0].completedAt : null,
    period: days > 0 ? `${days} days` : 'all time'
  }
}

async function getWordStats(db: any, days: number) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - days)

  // Get recently tested words
  const questionsSnapshot = await db.collection('quiz_questions')
    .where('lastUsed', '>=', cutoffDate)
    .orderBy('lastUsed', 'desc')
    .limit(50)
    .get()

  const words = questionsSnapshot.docs.map((doc: DocumentSnapshot) => {
    const data = doc.data()
    if (!data) return null
    return {
      word: data.word,
      timesTested: data.timesTested,
      timesCorrect: data.timesCorrect,
      accuracy: data.timesTested > 0 ? Math.round((data.timesCorrect / data.timesTested) * 100) : 0,
      lastUsed: data.lastUsed?.toDate()
    }
  }).filter((word: { word: string; timesTested: number; timesCorrect: number; accuracy: number; lastUsed: Date | null } | null) => word !== null)

  return {
    recentlyTestedWords: words,
    period: `${days} days`
  }
}

async function getRecentActivity(db: any, days: number) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - days)

  // Get recent quiz sessions
  const sessionsSnapshot = await db.collection('quiz_sessions')
    .where('startTime', '>=', cutoffDate)
    .where('completed', '==', true)
    .orderBy('startTime', 'desc')
    .limit(20)
    .get()

  const recentSessions = sessionsSnapshot.docs.map((doc: DocumentSnapshot) => {
    const data = doc.data()
    if (!data) return null
    return {
      sessionId: doc.id,
      userId: data.userId,
      score: data.score,
      totalQuestions: data.questions?.length || 0,
      percentage: data.questions?.length > 0 ? Math.round((data.score / data.questions.length) * 100) : 0,
      startTime: data.startTime?.toDate(),
      endTime: data.endTime?.toDate(),
      duration: data.endTime && data.startTime ? 
        Math.round((data.endTime.toDate() - data.startTime.toDate()) / 1000 / 60) : null // minutes
    }
  }).filter((session: { sessionId: string; userId: string; score: number; totalQuestions: number; percentage: number; startTime: Date | null; endTime: Date | null; duration: number | null } | null) => session !== null)

  return {
    recentSessions,
    period: `${days} days`
  }
}
