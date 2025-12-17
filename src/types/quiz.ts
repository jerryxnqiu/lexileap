export interface QuizQuestion {
  id: string;
  word: string;
  correctDefinition: string;
  options: string[];
  correctIndex: number;
  nGramFreq: number;
}

export interface QuizSession {
  id: string;
  userId: string;
  questions: QuizQuestion[];
  currentQuestion: number;
  answers: (number | null)[];
  startTime: Date;
  endTime?: Date;
  score?: number;
  completed?: boolean;
}

export interface QuizResult {
  sessionId: string;
  score: number;
  totalQuestions: number;
  percentage: number;
  completedAt: Date;
  answers: {
    questionId: string;
    word: string;
    userAnswer: number;
    correctAnswer: number;
    isCorrect: boolean;
  }[];
}

export interface UserQuizStats {
  userId: string;
  quizHistory: QuizResult[];
  totalQuizzes: number;
  totalScore: number;
  averageScore: number;
  firstQuizDate?: Date;
  lastQuizDate?: Date;
}

export interface QuestionBankEntry {
  id: string;
  word: string;
  correctDefinition: string;
  options: string[];
  correctIndex: number;
  wordnetData: {
    pos: string;
    examples: string[];
  };
  timesTested: number;
  timesCorrect: number;
  createdAt: Date;
  lastUsed: Date;
}

export interface WordData {
  wordId: string;
  word: string;
  pos: string;
  senses: Array<{
    definition: string;
    examples: string[];
  }>;
}