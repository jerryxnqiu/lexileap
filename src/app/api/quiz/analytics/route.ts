import { NextResponse } from 'next/server'
import { getDb } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'
import { DocumentSnapshot, Firestore } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') || 'overview'
    const userId = searchParams.get('userId')
    const days = parseInt(searchParams.get('days') || '30')

    const db = await getDb()
    const results: Record<string, unknown> = {}

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
      case 'daily':
        results.daily = await getDailyStats(db, days)
        break
      case 'word-analytics':
        results.wordAnalytics = await getWordAnalytics(db, days)
        break
      default:
        // Return all analytics
        results.overview = await getOverviewStats(db, days)
        results.words = await getWordStats(db, days)
        results.recent = await getRecentActivity(db, days)
        results.daily = await getDailyStats(db, days)
        results.wordAnalytics = await getWordAnalytics(db, days)
    }

    return NextResponse.json(results)
  } catch (error) {
    logger.error('Analytics error:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 })
  }
}

async function getOverviewStats(db: Firestore, days: number) {
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

async function getUserStats(db: Firestore, userId: string, days: number) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - days)

  // Get ALL user's quiz attempts by querying the userId field
  logger.info(`Querying user_quiz_attempts for userId: ${userId}`)
  const attemptsSnapshot = await db.collection('user_quiz_attempts')
    .where('userId', '==', userId)
    .get()
  
  logger.info(`Found ${attemptsSnapshot.docs.length} documents for user ${userId}`)

  const allAttempts = attemptsSnapshot.docs.map((doc: DocumentSnapshot) => {
    const data = doc.data()
    return {
      id: doc.id,
      userId: userId, // Extract from session ID
      ...data,
      completedAt: data?.completedAt?.toDate(),
      createdAt: data?.createdAt?.toDate()
    }
  }).sort((a, b) => {
    // Sort by completedAt descending (most recent first)
    if (!a.completedAt || !b.completedAt) return 0
    return b.completedAt.getTime() - a.completedAt.getTime()
  })

  // Filter recent attempts if days specified
  const recentAttempts = days > 0 ? 
    allAttempts.filter((attempt: { completedAt: Date }) => attempt.completedAt >= cutoffDate) : 
    allAttempts

  const scores = allAttempts.map((a: Record<string, unknown>) => a.score as number | undefined).filter((s: number | undefined) => s !== undefined)
  const recentScores = recentAttempts.map((a: Record<string, unknown>) => a.score as number | undefined).filter((s: number | undefined) => s !== undefined)
  
  const overallAverageScore = scores.length > 0 ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0
  const recentAverageScore = recentScores.length > 0 ? Math.round(recentScores.reduce((a: number, b: number) => a + b, 0) / recentScores.length) : 0


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

async function getWordStats(db: Firestore, days: number) {
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

async function getRecentActivity(db: Firestore, days: number) {
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

async function getDailyStats(db: Firestore, days: number) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - days)
  const cutoffDateStr = cutoffDate.toISOString().split('T')[0]

  const dailySnapshot = await db.collection('daily_analytics')
    .where('date', '>=', cutoffDateStr)
    .orderBy('date', 'desc')
    .get()

  const dailyStats = dailySnapshot.docs.map((doc: DocumentSnapshot) => {
    const data = doc.data()
    if (!data) return null
    return {
      date: data.date,
      totalUsers: data.totalUsers || 0,
      totalQuizzes: data.totalQuizzes || 0,
      totalScore: data.totalScore || 0,
      totalQuestions: data.totalQuestions || 0,
      averageScore: data.averageScore || 0,
      averagePercentage: data.averagePercentage || 0,
      lastUpdated: data.lastUpdated?.toDate()
    }
  }).filter((stat: { date: string; totalUsers: number; totalQuizzes: number; totalScore: number; totalQuestions: number; averageScore: number; averagePercentage: number; lastUpdated: Date } | null) => stat !== null)

  // Calculate totals across all days
  const totals = dailyStats.reduce((acc: { totalUsers: number; totalQuizzes: number; totalScore: number; totalQuestions: number }, day: { totalUsers: number; totalQuizzes: number; totalScore: number; totalQuestions: number }) => ({
    totalUsers: acc.totalUsers + day.totalUsers,
    totalQuizzes: acc.totalQuizzes + day.totalQuizzes,
    totalScore: acc.totalScore + day.totalScore,
    totalQuestions: acc.totalQuestions + day.totalQuestions
  }), { totalUsers: 0, totalQuizzes: 0, totalScore: 0, totalQuestions: 0 })

  return {
    dailyStats,
    totals: {
      ...totals,
      averageScore: totals.totalQuizzes > 0 ? Math.round(totals.totalScore / totals.totalQuizzes) : 0,
      averagePercentage: totals.totalQuestions > 0 ? Math.round((totals.totalScore / totals.totalQuestions) * 100) : 0
    },
    period: `${days} days`
  }
}

async function getWordAnalytics(db: Firestore, days: number) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - days)

  // Get words that were used recently
  const wordSnapshot = await db.collection('word_analytics')
    .where('lastUsed', '>=', cutoffDate)
    .orderBy('lastUsed', 'desc')
    .limit(100)
    .get()

  const wordStats = wordSnapshot.docs.map((doc: DocumentSnapshot) => {
    const data = doc.data()
    if (!data) return null
    return {
      word: data.word,
      timesTested: data.timesTested || 0,
      timesCorrect: data.timesCorrect || 0,
      accuracy: data.accuracy || 0,
      difficulty: data.difficulty || 'medium',
      lastUsed: data.lastUsed?.toDate(),
      firstUsed: data.firstUsed?.toDate()
    }
  }).filter((word: { word: string; timesTested: number; timesCorrect: number; accuracy: number; difficulty: string; lastUsed: Date; firstUsed: Date } | null) => word !== null)

  // Get difficulty distribution
  const difficultyStats = wordStats.reduce((acc: Record<string, number>, word: { word: string; timesTested: number; timesCorrect: number; accuracy: number; difficulty: string; lastUsed: Date; firstUsed: Date }) => {
    acc[word.difficulty] = (acc[word.difficulty] || 0) + 1
    return acc
  }, {})

  // Get most/least accurate words
  const sortedByAccuracy = [...wordStats].sort((a: { word: string; timesTested: number; timesCorrect: number; accuracy: number; difficulty: string; lastUsed: Date; firstUsed: Date }, b: { word: string; timesTested: number; timesCorrect: number; accuracy: number; difficulty: string; lastUsed: Date; firstUsed: Date }) => b.accuracy - a.accuracy)
  const mostAccurate = sortedByAccuracy.slice(0, 10)
  const leastAccurate = sortedByAccuracy.slice(-10).reverse()

  return {
    wordStats,
    difficultyStats,
    mostAccurate,
    leastAccurate,
    totalWords: wordStats.length,
    period: `${days} days`
  }
}
