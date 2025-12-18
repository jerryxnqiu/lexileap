'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { User } from '@/types/user';
import { QuizSession } from '@/types/quiz';

interface QuizProps {
  user: User;
  token?: string | null;
  sessionId?: string | null;
  onBack: () => void;
  onStudyMore: () => void;
}

export function Quiz({ user, token, sessionId, onBack, onStudyMore }: QuizProps) {
  const [session, setSession] = useState<QuizSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [timeLeft, setTimeLeft] = useState(1500); // each question is 30 seconds
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [confirmCallback, setConfirmCallback] = useState<(() => void) | null>(null);
  const sessionRef = useRef<QuizSession | null>(null);
  const userRef = useRef<User | null>(null);
  const submittingRef = useRef(false);
  const autoStartedRef = useRef(false);

  // Update refs when state changes
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  useEffect(() => {
    if (user && !autoStartedRef.current && !session) {
      const sessionIdParam = token || sessionId;
      if (sessionIdParam) {
        autoStartedRef.current = true;
        startQuiz(sessionIdParam);
      } else {
        setLoading(false);
      }
    }
  }, [user, token, sessionId, session]);

  const finishQuiz = useCallback(async () => {
    const currentSession = sessionRef.current;
    const currentUser = userRef.current;
    const isSubmitting = submittingRef.current;

    if (!currentSession || !currentUser || isSubmitting) return;

    setSubmitting(true);
    
    const score = currentSession.answers.reduce((correct: number, answer, index) => {
      return correct + (answer !== null && answer === currentSession.questions[index].correctIndex ? 1 : 0);
    }, 0);

    try {
      await fetch('/api/quiz/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: currentSession.id,
          answers: currentSession.answers,
          score,
          endTime: new Date()
        })
      });

      setSession({
        ...currentSession,
        endTime: new Date(),
        score: score || 0
      });
    } catch (error) {
      alert('Failed to submit quiz. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, []); // No dependencies - uses refs instead

  // Timer countdown effect (after finishQuiz is declared)
  useEffect(() => {
    if (!session || session.endTime || submitting) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 0) {
          // Time's up - auto-finish quiz
          const currentSession = sessionRef.current;
          const currentUser = userRef.current;
          if (currentSession && currentUser && !submittingRef.current) {
            finishQuiz();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [session, submitting, finishQuiz]);

  const startQuiz = useCallback(async (sessionIdParam: string) => {
    if (!user) return;
    
    setLoading(true);
    try {
      // Load session from attempt endpoint (handles both active and completed sessions)
      const response = await fetch(`/api/quiz/attempt/${encodeURIComponent(sessionIdParam)}`)
      if (!response.ok) {
        throw new Error('Failed to load session')
      }
      const sessionData = await response.json()
      
      // Check if this is a completed attempt (has merged question format) or active session
      const isCompletedAttempt = sessionData.questions && sessionData.questions[0] && 'userAnswer' in sessionData.questions[0]
      
      let quizSession: QuizSession
      
      if (isCompletedAttempt) {
        // Completed attempt format - convert to QuizSession
        quizSession = {
          id: sessionData.sessionId,
          userId: sessionData.userId,
          questions: sessionData.questions.map((q: any) => ({
            id: '',
            word: q.word,
            correctDefinition: '',
            options: q.options,
            correctIndex: q.correctIndex,
            nGramFreq: 0
          })),
          currentQuestion: 0,
          answers: sessionData.questions.map((q: any) => q.userAnswer),
          startTime: new Date(sessionData.startTime),
          endTime: sessionData.endTime ? new Date(sessionData.endTime) : undefined,
          score: sessionData.score,
          completed: true
        }
      } else {
        // Active session format - use directly
        quizSession = {
          id: sessionData.id,
          userId: sessionData.userId,
          questions: sessionData.questions || [],
          currentQuestion: sessionData.currentQuestion || 0,
          answers: sessionData.answers || new Array(sessionData.questions?.length || 0).fill(null),
          startTime: new Date(sessionData.startTime),
          endTime: sessionData.endTime ? new Date(sessionData.endTime) : undefined,
          score: sessionData.score,
          completed: sessionData.completed || false
        }
      }
      
      setSession(quizSession)
      setTimeLeft(600) // Reset timer
      setLoading(false)
    } catch (error) {
      setLoading(false)
      alert('Failed to load quiz session. Please try again.')
      onBack()
    }
  }, [user, onBack]);

  const handleAnswer = (answerIndex: number) => {
    if (!session) return;

    const newAnswers = [...session.answers];
    newAnswers[session.currentQuestion] = answerIndex;
    
    setSession({
      ...session,
      answers: newAnswers
    });
  };

  const nextQuestion = () => {
    if (!session) return;

    if (session.currentQuestion < session.questions.length - 1) {
      setSession({
        ...session,
        currentQuestion: session.currentQuestion + 1
      });
    } else {
      // Quiz completed
      finishQuiz();
    }
  };

  const previousQuestion = () => {
    if (!session || session.currentQuestion === 0) return;

    setSession({
      ...session,
      currentQuestion: session.currentQuestion - 1
    });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const showConfirm = (callback: () => void) => {
    setConfirmCallback(() => callback);
    setShowConfirmDialog(true);
  };

  const handleConfirm = () => {
    if (confirmCallback) {
      confirmCallback();
    }
    setShowConfirmDialog(false);
    setConfirmCallback(null);
  };

  const handleCancel = () => {
    setShowConfirmDialog(false);
    setConfirmCallback(null);
  };

  if (loading || submitting) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-sky-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="relative w-56 h-56 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-indigo-200 via-sky-200 to-emerald-200 animate-pulse"></div>
            <div className="absolute inset-4 rounded-full bg-white shadow-inner flex items-center justify-center">
              <div className="text-3xl font-bold text-indigo-700">{submitting ? 'Submitting...' : 'Loading...'}</div>
            </div>
          </div>
          <p className="text-lg text-gray-700 font-semibold">{submitting ? 'Submitting your quiz results' : 'Preparing your quiz'}</p>
          <p className="text-sm text-gray-500 mt-2">Please wait a moment</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {!session ? (
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-6">Vocabulary Quiz</h1>
          <p className="text-lg text-gray-700 mb-8">
            Test your vocabulary knowledge with 50 questions!
          </p>
          <button
            onClick={() => {
              const sessionIdParam = token || sessionId;
              if (sessionIdParam) {
                startQuiz(sessionIdParam);
              } else {
                alert('No quiz session found. Please go back to study page and prepare quiz questions.')
                onBack();
              }
            }}
            className="px-8 py-4 bg-blue-600 text-white text-lg font-semibold rounded-lg hover:bg-blue-700 cursor-pointer"
          >
            Start Quiz
          </button>
        </div>
      ) : session.endTime ? (
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-6">Quiz Complete!</h1>
          <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
            <div className="text-6xl font-bold text-blue-600 mb-4">
              {session.score}/{session.questions.length}
            </div>
            <div className="text-2xl text-gray-700 mb-4">
              {Math.round((session.score! / session.questions.length) * 100)}% Correct
            </div>
            <div className="text-gray-600">
              Great job, {user.name || user.email}!
            </div>
          </div>
          <div className="space-x-4">
            <button
              onClick={onStudyMore}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer"
            >
              Study More Words
            </button>
            <button
              onClick={() => showConfirm(onBack)}
              className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 cursor-pointer"
            >
              Back to Home
            </button>
          </div>
        </div>
      ) : (
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow-lg p-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">
                Question {session.currentQuestion + 1} of {session.questions.length}
              </h2>
              <div className="flex items-center space-x-4">
                <div className={`text-lg font-bold ${timeLeft < 60 ? 'text-red-600' : timeLeft < 300 ? 'text-yellow-600' : 'text-green-600'}`}>
                  ⏰ {formatTime(timeLeft)}
                </div>
                <div className="text-sm text-gray-600">
                  Progress: {Math.round(((session.currentQuestion + 1) / session.questions.length) * 100)}%
                </div>
              </div>
            </div>

            <div className="mb-8">
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${((session.currentQuestion + 1) / session.questions.length) * 100}%` }}
                ></div>
              </div>
            </div>

            {session.questions[session.currentQuestion] && (
              <div>
                <div className="text-center mb-8">
                  <h3 className="text-3xl font-bold text-gray-900 mb-4">
                    {session.questions[session.currentQuestion].word}
                  </h3>
                  <p className="text-lg text-gray-600">
                    What does this word mean?
                  </p>
                </div>

                <div className="space-y-4 mb-8">
                  {session.questions[session.currentQuestion].options.map((option, index) => (
                    <button
                      key={index}
                      onClick={() => handleAnswer(index)}
                      className={`w-full p-4 text-left rounded-lg border-2 transition-all cursor-pointer ${
                        session.answers[session.currentQuestion] === index
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <span className="font-medium text-gray-700">
                        {String.fromCharCode(65 + index)}. {option}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Quiz Navigation - Previous and Next */}
                <div className="flex justify-between items-center mb-4">
                  <div>
                    {session.currentQuestion > 0 && (
                      <button
                        onClick={previousQuestion}
                        className="px-6 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 cursor-pointer"
                      >
                        ← Previous
                      </button>
                    )}
                  </div>
                  <button
                    onClick={nextQuestion}
                    disabled={session.answers[session.currentQuestion] === null || submitting}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {submitting ? 'Calculating your score...' : (session.currentQuestion === session.questions.length - 1 ? 'Finish Quiz' : 'Next Question')}
                  </button>
                </div>

                {/* Back to Home - separate row below, left aligned */}
                <div className="flex justify-start">
                  <button
                    onClick={() => showConfirm(onBack)}
                    className="px-6 py-3 text-gray-600 hover:text-gray-800 cursor-pointer"
                  >
                    ← Back to Home
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 bg-white/30 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md mx-4 border border-gray-200">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Confirm Action</h3>
            <p className="text-gray-700 mb-6">
              {session && !session.endTime 
                ? 'Are you sure you want to go back to home? Your quiz progress will be lost.'
                : 'Are you sure you want to go back to home?'}
            </p>
            <div className="flex justify-end space-x-4">
              <button
                onClick={handleCancel}
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 cursor-pointer transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
