import { NextResponse } from 'next/server'
import { getDb } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'
import { QuizQuestion } from '@/types/quiz'

export const dynamic = 'force-dynamic'

async function updateDailyAnalytics(db: any, date: Date, score: number, totalQuestions: number, userId: string) {
  try {
    const dateStr = date.toISOString().split('T')[0] // YYYY-MM-DD format
    const dailyRef = db.collection('daily_analytics').doc(dateStr)
    
    await db.runTransaction(async (transaction: any) => {
      const dailyDoc = await transaction.get(dailyRef)
      
      if (dailyDoc.exists) {
        const data = dailyDoc.data()
        const newTotalQuizzes = (data.totalQuizzes || 0) + 1
        const newTotalScore = (data.totalScore || 0) + score
        const newTotalQuestions = (data.totalQuestions || 0) + totalQuestions
        
        // Check if this is a new user for today
        const existingUsers = data.users || []
        const isNewUser = !existingUsers.includes(userId)
        const newTotalUsers = isNewUser ? (data.totalUsers || 0) + 1 : (data.totalUsers || 0)
        
        transaction.update(dailyRef, {
          totalUsers: newTotalUsers,
          totalQuizzes: newTotalQuizzes,
          totalScore: newTotalScore,
          totalQuestions: newTotalQuestions,
          averageScore: Math.round(newTotalScore / newTotalQuizzes),
          averagePercentage: Math.round((newTotalScore / newTotalQuestions) * 100),
          users: isNewUser ? [...existingUsers, userId] : existingUsers,
          lastUpdated: new Date()
        })
      } else {
        transaction.set(dailyRef, {
          date: dateStr,
          totalUsers: 1,
          totalQuizzes: 1,
          totalScore: score,
          totalQuestions: totalQuestions,
          averageScore: score,
          averagePercentage: Math.round((score / totalQuestions) * 100),
          users: [userId],
          createdAt: new Date(),
          lastUpdated: new Date()
        })
      }
    })
  } catch (error) {
    logger.error('Error updating daily analytics:', error instanceof Error ? error : new Error(String(error)))
  }
}

async function updateWordAnalytics(db: any, questions: QuizQuestion[], answers: number[]) {
  try {
    const batch = db.batch()
    
    for (let i = 0; i < questions.length; i++) {
      const question = questions[i]
      const answer = answers[i]
      const isCorrect = answer !== null && answer === question.correctIndex
      
      const wordRef = db.collection('word_analytics').doc(question.word)
      const wordDoc = await wordRef.get()
      
      if (wordDoc.exists) {
        const data = wordDoc.data()
        const newTimesTested = (data.timesTested || 0) + 1
        const newTimesCorrect = (data.timesCorrect || 0) + (isCorrect ? 1 : 0)
        const newAccuracy = Math.round((newTimesCorrect / newTimesTested) * 100)
        
        // Determine difficulty based on accuracy
        let difficulty = 'medium'
        if (newAccuracy >= 80) difficulty = 'easy'
        else if (newAccuracy <= 40) difficulty = 'hard'
        
        batch.update(wordRef, {
          word: question.word,
          timesTested: newTimesTested,
          timesCorrect: newTimesCorrect,
          accuracy: newAccuracy,
          difficulty: difficulty,
          lastUsed: new Date(),
          lastUpdated: new Date()
        })
      } else {
        const accuracy = isCorrect ? 100 : 0
        let difficulty = 'medium'
        if (accuracy >= 80) difficulty = 'easy'
        else if (accuracy <= 40) difficulty = 'hard'
        
        batch.set(wordRef, {
          word: question.word,
          timesTested: 1,
          timesCorrect: isCorrect ? 1 : 0,
          accuracy: accuracy,
          difficulty: difficulty,
          firstUsed: new Date(),
          lastUsed: new Date(),
          createdAt: new Date(),
          lastUpdated: new Date()
        })
      }
    }
    
    await batch.commit()
  } catch (error) {
    logger.error('Error updating word analytics:', error instanceof Error ? error : new Error(String(error)))
  }
}

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

    // Update daily analytics
    await updateDailyAnalytics(db, new Date(endTime), score, questions.length, sessionData.userId)

    // Update word analytics for each question
    await updateWordAnalytics(db, questions, answers)

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
        lastQuizDate: new Date(endTime)
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
