'use client';

import { useState, useEffect } from 'react';
import { QuizQuestion } from './QuizQuestion';
import { QuizResults } from './QuizResults';
import { QuizStats } from './QuizStats';

interface User {
  email: string;
  name?: string;
}

interface WordSense {
  word: string;
  definition: string;
  examples: string[];
  synonyms: string[];
  lexFileNum: string;
  synsetOffset: string;
}

interface WordData {
  wordId: string;
  word: string;
  pos: string;
  senses: WordSense[];
  antonyms: string[];
  relatedWords: string[];
}

interface QuizQuestion {
  word: string;
  definition: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
  examples: string[];
}

interface QuizStats {
  totalQuestions: number;
  correctAnswers: number;
  currentStreak: number;
  bestStreak: number;
}

export function QuizInterface({ user }: { user: User }) {
  const [wordNetData, setWordNetData] = useState<Record<string, WordData> | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<QuizQuestion | null>(null);
  const [userAnswer, setUserAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [quizStats, setQuizStats] = useState<QuizStats>({
    totalQuestions: 0,
    correctAnswers: 0,
    currentStreak: 0,
    bestStreak: 0
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadWordNetData();
    loadUserStats();
  }, []);

  const loadWordNetData = async () => {
    try {
      const response = await fetch('/data/wordnet.json');
      if (!response.ok) {
        throw new Error('Failed to load WordNet data');
      }
      const data = await response.json();
      setWordNetData(data);
      generateNewQuestion(data);
    } catch (err) {
      setError('Failed to load vocabulary data. Please refresh the page.');
      console.error('Error loading WordNet data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadUserStats = () => {
    const savedStats = localStorage.getItem(`lexileap_stats_${user.email}`);
    if (savedStats) {
      setQuizStats(JSON.parse(savedStats));
    }
  };

  const saveUserStats = (newStats: QuizStats) => {
    setQuizStats(newStats);
    localStorage.setItem(`lexileap_stats_${user.email}`, JSON.stringify(newStats));
  };

  const generateNewQuestion = (data: Record<string, WordData>) => {
    const words = Object.values(data);
    const randomWord = words[Math.floor(Math.random() * words.length)];
    
    if (!randomWord || randomWord.senses.length === 0) {
      generateNewQuestion(data);
      return;
    }

    const randomSense = randomWord.senses[Math.floor(Math.random() * randomWord.senses.length)];
    
    // Generate wrong options from other words
    const wrongOptions: string[] = [];
    const usedWords = new Set([randomWord.wordId]);
    
    while (wrongOptions.length < 3) {
      const randomWrongWord = words[Math.floor(Math.random() * words.length)];
      if (!usedWords.has(randomWrongWord.wordId) && randomWrongWord.senses.length > 0) {
        const wrongSense = randomWrongWord.senses[Math.floor(Math.random() * randomWrongWord.senses.length)];
        if (wrongSense.definition && wrongSense.definition.length > 10) {
          wrongOptions.push(wrongSense.definition);
          usedWords.add(randomWrongWord.wordId);
        }
      }
    }

    // Shuffle options
    const allOptions = [randomSense.definition, ...wrongOptions];
    const correctIndex = 0;
    
    // Shuffle the array
    for (let i = allOptions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allOptions[i], allOptions[j]] = [allOptions[j], allOptions[i]];
    }
    
    const newCorrectIndex = allOptions.findIndex(option => option === randomSense.definition);

    const question: QuizQuestion = {
      word: randomSense.word,
      definition: randomSense.definition,
      options: allOptions,
      correctAnswer: newCorrectIndex,
      explanation: `"${randomSense.word}" is a ${randomWord.pos === 'n' ? 'noun' : randomWord.pos === 'v' ? 'verb' : randomWord.pos === 'a' ? 'adjective' : 'adverb'}.`,
      examples: randomSense.examples.slice(0, 2) // Show up to 2 examples
    };

    setCurrentQuestion(question);
    setUserAnswer(null);
    setShowResult(false);
  };

  const handleAnswer = (answerIndex: number) => {
    if (showResult) return;
    
    setUserAnswer(answerIndex);
    const correct = answerIndex === currentQuestion?.correctAnswer;
    setIsCorrect(correct);
    setShowResult(true);

    // Update stats
    const newStats = {
      totalQuestions: quizStats.totalQuestions + 1,
      correctAnswers: quizStats.correctAnswers + (correct ? 1 : 0),
      currentStreak: correct ? quizStats.currentStreak + 1 : 0,
      bestStreak: correct ? Math.max(quizStats.bestStreak, quizStats.currentStreak + 1) : quizStats.bestStreak
    };
    saveUserStats(newStats);
  };

  const handleNextQuestion = () => {
    if (wordNetData) {
      generateNewQuestion(wordNetData);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading vocabulary data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <h2 className="text-lg font-semibold text-red-800 mb-2">Error</h2>
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 transition-colors"
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }

  if (!wordNetData || !currentQuestion) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="text-center py-12">
          <p className="text-gray-600">No questions available. Please try again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <QuizStats stats={quizStats} />
      </div>

      <div className="bg-white rounded-lg shadow-lg p-6">
        {currentQuestion && (
          <QuizQuestion
            question={currentQuestion}
            userAnswer={userAnswer}
            showResult={showResult}
            isCorrect={isCorrect}
            onAnswer={handleAnswer}
            onNext={handleNextQuestion}
          />
        )}
      </div>
    </div>
  );
}
