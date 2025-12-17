'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/app/components/Header';
import { User } from '@/types/user';
import { QuizSession } from '@/types/quiz';

export default function QuizPage() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<QuizSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [timeLeft, setTimeLeft] = useState(1500); // each question is 30 seconds
  const router = useRouter();
  const sessionRef = useRef<QuizSession | null>(null);
  const userRef = useRef<User | null>(null);
  const submittingRef = useRef(false);

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

  const startQuiz = useCallback(async () => {
    if (!user) return;
    
    const urlParams = new URLSearchParams(window.location.search)
    const sessionIdParam = urlParams.get('sessionId')
    
    // If sessionId is provided, load the existing session
    if (sessionIdParam) {
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
        return
      } catch (error) {
        setLoading(false)
        alert('Failed to load quiz session. Please try again.')
        router.push('/study')
        return
      }
    }
    
    // Fallback to old flow: Check for selected words from URL or saved selection
    const selectionParam = urlParams.get('selection')
    let selectedWords: string[] = []
    
    if (selectionParam) {
      try {
        selectedWords = JSON.parse(decodeURIComponent(selectionParam))
      } catch {
        // Invalid selection parameter
      }
    }
    
    // If no selection in URL, try to get from saved selection
    if (selectedWords.length === 0) {
      try {
        const response = await fetch(`/api/vocabulary/get-selection?userId=${encodeURIComponent(user.email)}`)
        if (response.ok) {
          const data = await response.json()
          selectedWords = data.selectedWords || []
        }
      } catch (error) {
        // Failed to load saved selection
      }
    }
    
    if (selectedWords.length === 0) {
      alert('No words selected. Please go back to study page and select words.')
      router.push('/study')
      return
    }
    
    setGenerating(true);
    setTimeLeft(600); // Reset timer
    try {
      // Use new endpoint that generates quiz from selected words
      const es = new EventSource(
        `/api/quiz/generate-from-selection?userId=${encodeURIComponent(user.email)}&words=${encodeURIComponent(JSON.stringify(selectedWords))}`
      )

      const handleComplete = (e: MessageEvent) => {
        try {
          const data = JSON.parse((e as MessageEvent).data);
          if (data && data.session) {
            setSession(data.session);
          }
        } catch {}
        es.close();
        setGenerating(false);
      };

      const handleError = () => {
        es.close();
        setGenerating(false);
        alert('Failed to generate quiz. Please try again.');
      };

      es.addEventListener('complete', handleComplete as EventListener);
      es.addEventListener('error', handleError as EventListener);
    } catch (error) {
      setGenerating(false);
      alert('Failed to start quiz generation. Please try again.');
    }
  }, [user, router]);

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

  const handleLogout = () => {
    localStorage.removeItem('lexileapUser');
    router.push('/');
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-sky-50 to-indigo-100">
      <Header user={user} onLogout={handleLogout} />
      
      <main className="container mx-auto px-4 py-8">
        {!session ? (
          <div className="max-w-2xl mx-auto text-center">
            <h1 className="text-4xl font-bold text-gray-900 mb-6">Vocabulary Quiz</h1>
            <p className="text-lg text-gray-700 mb-8">
              Test your vocabulary knowledge with 50 questions!
            </p>
            <button
              onClick={startQuiz}
              disabled={generating}
              className="px-8 py-4 bg-blue-600 text-white text-lg font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {generating ? 'Generating Quiz...' : 'Start Quiz'}
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
                onClick={() => router.push('/')}
                className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 cursor-pointer"
              >
                Back to Home
              </button>
              <button
                onClick={() => {
                  setSession(null);
                  startQuiz();
                }}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Take Another Quiz
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
                      {submitting ? 'Submitting...' : (session.currentQuestion === session.questions.length - 1 ? 'Finish Quiz' : 'Next Question')}
                    </button>
                  </div>

                  {/* Back to Home - separate row below, left aligned */}
                  <div className="flex justify-start">
                    <button
                      onClick={() => router.push('/')}
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
      </main>
    </div>
  );
}
