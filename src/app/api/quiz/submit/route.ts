import { NextResponse } from 'next/server'
import { getDb } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const { sessionId, answers, score, endTime } = await request.json()
    
    if (!sessionId || !answers || score === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    logger.info('Submitting quiz results:', { sessionId, score })

    const db = await getDb()
    
    // Check if session already completed (prevent duplicate submissions)
    const sessionRef = db.collection('quiz_sessions').doc(sessionId)
    const existingSession = await sessionRef.get()
    
    if (existingSession.exists && existingSession.data()?.completed) {
      logger.warn('Quiz already submitted:', sessionId)
      return NextResponse.json({ error: 'Quiz already submitted' }, { status: 409 })
    }
    
    // Update quiz session with analytics fields
    const endTimeDate = new Date(endTime)
    const startTime = existingSession.data()?.startTime?.toDate()
    const duration = startTime ? Math.round((endTimeDate.getTime() - startTime.getTime()) / 1000) : null
    
    await sessionRef.update({
      answers,
      score,
      endTime: endTimeDate,
      completed: true,
      totalQuestions: answers.length,
      percentage: Math.round((score / answers.length) * 100),
      duration: duration // in seconds
    })

    // Get session data to update question statistics
    const sessionDoc = await sessionRef.get()
    if (!sessionDoc.exists) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const sessionData = sessionDoc.data()
    if (!sessionData) {
      return NextResponse.json({ error: 'Session data not found' }, { status: 404 })
    }
    
    const questions = sessionData.questions || []

    // Update question bank statistics
    for (let i = 0; i < questions.length; i++) {
      const question = questions[i]
      const userAnswer = answers[i]
      const isCorrect = userAnswer === question.correctIndex

      const questionRef = db.collection('quiz_questions').doc(question.id)
      const questionDoc = await questionRef.get()

      if (questionDoc.exists) {
        const currentData = questionDoc.data()
        await questionRef.update({
          timesCorrect: (currentData?.timesCorrect || 0) + (isCorrect ? 1 : 0),
          lastUsed: new Date()
        })
      }
    }

    // Save user's quiz history
    const userRef = db.collection('users').doc(sessionData.userId)
    const userDoc = await userRef.get()

    const quizResult = {
      sessionId,
      score,
      totalQuestions: questions.length,
      percentage: Math.round((score / questions.length) * 100),
      completedAt: new Date(endTime),
      answers: answers.map((answer: number, index: number) => ({
        questionId: questions[index].id,
        word: questions[index].word,
        userAnswer: answer,
        correctAnswer: questions[index].correctIndex,
        isCorrect: answer === questions[index].correctIndex
      }))
    }

    // Store individual quiz attempt in user_quiz_attempts collection
    const attemptRef = db.collection('user_quiz_attempts').doc(sessionId)
    await attemptRef.set({
      ...quizResult,
      createdAt: new Date()
    })

    if (userDoc.exists) {
      // Update existing user summary
      const userData = userDoc.data()
      const newTotalQuizzes = (userData?.totalQuizzes || 0) + 1
      const newTotalScore = (userData?.totalScore || 0) + score

      await userRef.update({
        totalQuizzes: newTotalQuizzes,
        totalScore: newTotalScore,
        averageScore: Math.round(newTotalScore / newTotalQuizzes),
        bestScore: Math.max(userData?.bestScore || 0, score),
        lastQuizDate: new Date(endTime),
        // Keep a small recent history for quick access (last 5)
        recentQuizzes: [quizResult, ...(userData?.recentQuizzes || []).slice(0, 4)]
      })
    } else {
      // Create new user record
      await userRef.set({
        userId: sessionData.userId,
        totalQuizzes: 1,
        totalScore: score,
        averageScore: score,
        bestScore: score,
        firstQuizDate: new Date(endTime),
        lastQuizDate: new Date(endTime),
        recentQuizzes: [quizResult]
      })
    }

    logger.info('Quiz results saved successfully:', { sessionId, score })

    return NextResponse.json({ success: true, score })
  } catch (error) {
    logger.error('Error submitting quiz results:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Failed to submit quiz results' }, { status: 500 })
  }
}
