'use client';

import { useState, useEffect, useCallback } from 'react';
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
  const [timeLeft, setTimeLeft] = useState(600); // 10 minutes in seconds
  const router = useRouter();

  const finishQuiz = useCallback(async () => {
    if (!session || !user || submitting) return;

    setSubmitting(true);
    
    const score = session.answers.reduce((correct: number, answer, index) => {
      return correct + (answer !== null && answer === session.questions[index].correctIndex ? 1 : 0);
    }, 0);

    try {
      await fetch('/api/quiz/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.id,
          answers: session.answers,
          score,
          endTime: new Date()
        })
      });

      setSession({
        ...session,
        endTime: new Date(),
        score: score || 0
      });
    } catch (error) {
      console.error('Error submitting quiz:', error);
      alert('Failed to submit quiz. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [session, user, submitting]);

  useEffect(() => {
    // Check if user is logged in
    const savedUser = localStorage.getItem('lexileapUser');
    if (savedUser) {
      try {
        const userData = JSON.parse(savedUser);
        setUser(userData);
      } catch (error) {
        console.error('Invalid user data:', error);
        router.push('/');
      }
    } else {
      router.push('/');
    }
    setLoading(false);
  }, [router]);

  // Timer effect
  useEffect(() => {
    if (!session || session.endTime) return;

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          // Time's up - auto submit
          finishQuiz();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [session, finishQuiz]);

  const startQuiz = async () => {
    if (!user) return;
    
    setGenerating(true);
    setTimeLeft(600); // Reset timer
    try {
      const response = await fetch('/api/quiz/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.email })
      });

      if (!response.ok) {
        throw new Error('Failed to generate quiz');
      }

      const quizData = await response.json();
      setSession(quizData);
    } catch (error) {
      console.error('Error generating quiz:', error);
      alert('Failed to generate quiz. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

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
              className="px-8 py-4 bg-blue-600 text-white text-lg font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
                className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
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
                        className={`w-full p-4 text-left rounded-lg border-2 transition-all ${
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

                  <div className="flex justify-between items-center">
                    <div className="flex space-x-3">
                      <button
                        onClick={() => router.push('/')}
                        className="px-6 py-3 text-gray-600 hover:text-gray-800"
                      >
                        ← Back to Home
                      </button>
                      {session.currentQuestion > 0 && (
                        <button
                          onClick={previousQuestion}
                          className="px-6 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
                        >
                          ← Previous
                        </button>
                      )}
                    </div>
                    <button
                      onClick={nextQuestion}
                      disabled={session.answers[session.currentQuestion] === null || submitting}
                      className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {submitting ? 'Submitting...' : (session.currentQuestion === session.questions.length - 1 ? 'Finish Quiz' : 'Next Question')}
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
