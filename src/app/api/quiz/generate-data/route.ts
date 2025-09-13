import { NextResponse } from 'next/server'
import { getDb } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'
import { QuizQuestion, WordData } from '@/types/quiz'

export const dynamic = 'force-dynamic'

async function getQuestionsFromBank(count: number): Promise<QuizQuestion[]> {
  try {
    const db = await getDb()
    const questionsRef = db.collection('quiz_questions')
    const snapshot = await questionsRef.limit(count * 2).get() // Get more than needed for variety
    
    const questions: QuizQuestion[] = []
    snapshot.forEach(doc => {
      const data = doc.data()
      if (data.word && data.options && data.options.length === 4) {
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
    
    // Shuffle and return requested count
    return questions.sort(() => Math.random() - 0.5).slice(0, count)
  } catch (error) {
    logger.error('Error getting questions from bank:', error instanceof Error ? error : new Error(String(error)))
    return []
  }
}

async function getRandomWords(count: number): Promise<WordData[]> {
  try {
    // Get random samples from Firestore
    const db = await getDb()
    const samplesRef = db.collection('wordnet_samples')
    const snapshot = await samplesRef.limit(count * 2).get() // Get more than needed for variety
    
    const words: WordData[] = []
    snapshot.forEach(doc => {
      const data = doc.data()
      if (data.senses && data.senses.length > 0) {
        words.push({
          wordId: data.wordId,
          word: data.word,
          pos: data.pos,
          senses: data.senses
        })
      }
    })
    
    // Shuffle and return requested count
    return words.sort(() => Math.random() - 0.5).slice(0, count)
  } catch (error) {
    logger.error('Error getting random words:', error instanceof Error ? error : new Error(String(error)))
    return []
  }
}

async function generateMisleadingOptions(word: string): Promise<string[]> {
  try {
    // For now, we'll generate simple misleading options
    // In production, you'd call DeepSeek API here
    const misleadingOptions = [
      `A type of ${word.toLowerCase()} used in ancient times`,
      `The opposite of ${word.toLowerCase()}`,
      `A small version of ${word.toLowerCase()}`,
      `A tool used for ${word.toLowerCase()}`,
      `The process of making ${word.toLowerCase()}`,
      `A place where ${word.toLowerCase()} is found`,
      `Someone who studies ${word.toLowerCase()}`,
      `The color of ${word.toLowerCase()}`
    ]
    
    // Shuffle and pick 3
    const shuffled = misleadingOptions.sort(() => Math.random() - 0.5)
    return shuffled.slice(0, 3)
  } catch (error) {
    logger.error('Error generating misleading options:', error instanceof Error ? error : new Error(String(error)))
    return ['Option A', 'Option B', 'Option C'] // Fallback
  }
}

async function createQuizQuestion(wordData: WordData): Promise<QuizQuestion> {
  const sense = wordData.senses[0] // Use first sense
  const correctDefinition = sense.definition || 'No definition available'
  
  // Generate misleading options
  const misleadingOptions = await generateMisleadingOptions(wordData.word)
  
  // Combine correct answer with misleading options
  const allOptions = [correctDefinition, ...misleadingOptions]
  
  // Shuffle options
  const shuffledOptions = allOptions.sort(() => Math.random() - 0.5)
  const correctIndex = shuffledOptions.indexOf(correctDefinition)
  
  return {
    id: `${wordData.wordId}_${Date.now()}`,
    word: wordData.word,
    correctDefinition,
    options: shuffledOptions,
    correctIndex,
    wordnetData: {
      pos: wordData.pos,
      examples: sense.examples || []
    }
  }
}

async function saveQuestionToBank(question: QuizQuestion): Promise<void> {
  try {
    const db = await getDb()
    const questionRef = db.collection('quiz_questions').doc(question.id)
    
    // Check if question already exists
    const existingDoc = await questionRef.get()
    
    if (existingDoc.exists) {
      // Update existing question
      await questionRef.update({
        timesTested: (existingDoc.data()?.timesTested || 0) + 1,
        lastUsed: new Date()
      })
    } else {
      // Create new question
      await questionRef.set({
        ...question,
        timesTested: 1,
        timesCorrect: 0,
        createdAt: new Date(),
        lastUsed: new Date()
      })
    }
  } catch (error) {
    logger.error('Error saving question to bank:', error instanceof Error ? error : new Error(String(error)))
  }
}

export async function POST(request: Request) {
  try {
    const { userId } = await request.json()
    
    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    logger.info('Generating quiz for user:', userId)

    // First, try to get 30-40 questions from the question bank
    const bankQuestions = await getQuestionsFromBank(40)
    logger.info(`Found ${bankQuestions.length} questions in bank`)
    
    // Generate remaining questions from WordNet data
    const remainingCount = 50 - bankQuestions.length
    const words = remainingCount > 0 ? await getRandomWords(remainingCount) : []
    logger.info(`Generating ${words.length} new questions from WordNet`)

    // Start with questions from bank
    const questions: QuizQuestion[] = [...bankQuestions]
    
    // Generate new questions for the remaining slots
    for (const wordData of words) {
      const question = await createQuizQuestion(wordData)
      questions.push(question)
      
      // Save to question bank
      await saveQuestionToBank(question)
    }
    
    if (questions.length === 0) {
      return NextResponse.json({ error: 'No questions available for quiz' }, { status: 500 })
    }

    // Create quiz session
    const sessionId = `quiz_${userId}_${Date.now()}`
    const session = {
      id: sessionId,
      userId,
      questions,
      currentQuestion: 0,
      answers: new Array(questions.length).fill(null),
      startTime: new Date()
    }

    // Save session to Firestore
    const db = await getDb()
    await db.collection('quiz_sessions').doc(sessionId).set(session)

    logger.info('Quiz generated successfully:', { sessionId, questionCount: questions.length })

    return NextResponse.json(session)
  } catch (error) {
    logger.error('Error generating quiz:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Failed to generate quiz' }, { status: 500 })
  }
}
