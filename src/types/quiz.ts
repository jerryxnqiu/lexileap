export interface QuizQuestion {
  word: string;
  definition: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
  examples: string[];
}

export interface QuizStats {
  totalQuestions: number;
  correctAnswers: number;
  currentStreak: number;
  bestStreak: number;
}
