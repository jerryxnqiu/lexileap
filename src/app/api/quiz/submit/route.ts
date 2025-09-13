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
    
    // Update quiz session
    const sessionRef = db.collection('quiz_sessions').doc(sessionId)
    await sessionRef.update({
      answers,
      score,
      endTime: new Date(endTime),
      completed: true
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

    if (userDoc.exists) {
      // Update existing user
      const userData = userDoc.data()
      const quizHistory = userData?.quizHistory || []
      quizHistory.push(quizResult)

      await userRef.update({
        quizHistory: quizHistory.slice(-10), // Keep last 10 quizzes
        totalQuizzes: (userData?.totalQuizzes || 0) + 1,
        totalScore: (userData?.totalScore || 0) + score,
        averageScore: Math.round(((userData?.totalScore || 0) + score) / ((userData?.totalQuizzes || 0) + 1)),
        lastQuizDate: new Date(endTime)
      })
    } else {
      // Create new user record
      await userRef.set({
        userId: sessionData.userId,
        quizHistory: [quizResult],
        totalQuizzes: 1,
        totalScore: score,
        averageScore: score,
        firstQuizDate: new Date(endTime),
        lastQuizDate: new Date(endTime)
      })
    }

    logger.info('Quiz results saved successfully:', { sessionId, score })

    return NextResponse.json({ success: true, score })
  } catch (error) {
    logger.error('Error submitting quiz results:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Failed to submit quiz results' }, { status: 500 })
  }
}
