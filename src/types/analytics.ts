// Analytics Types

export interface OverviewStats {
  totalUsers: number;
  totalQuizzes: number;
  averageScore: number;
  averagePercentage: number;
  totalQuestions: number;
  period: string;
}

export interface DailyStats {
  dailyStats: Array<{
    date: string;
    totalUsers: number;
    totalQuizzes: number;
    totalScore: number;
    totalQuestions: number;
    averageScore: number;
    averagePercentage: number;
    lastUpdated: Date;
  }>;
  totals: {
    totalUsers: number;
    totalQuizzes: number;
    totalScore: number;
    totalQuestions: number;
    averageScore: number;
    averagePercentage: number;
  };
  period: string;
}

export interface WordAnalytics {
  wordStats: Array<{
    word: string;
    timesTested: number;
    timesCorrect: number;
    accuracy: number;
    difficulty: string;
    lastUsed: Date;
    firstUsed: Date;
  }>;
  difficultyStats: Record<string, number>;
  mostAccurate: Array<{
    word: string;
    timesTested: number;
    timesCorrect: number;
    accuracy: number;
    difficulty: string;
    lastUsed: Date;
    firstUsed: Date;
  }>;
  leastAccurate: Array<{
    word: string;
    timesTested: number;
    timesCorrect: number;
    accuracy: number;
    difficulty: string;
    lastUsed: Date;
    firstUsed: Date;
  }>;
  totalWords: number;
  period: string;
}

export interface RecentActivity {
  recentSessions: Array<{
    sessionId: string;
    userId: string;
    score: number;
    totalQuestions: number;
    percentage: number;
    startTime: Date;
    endTime: Date;
    duration: number | null;
  }>;
  period: string;
}

export interface UserStats {
  userId: string;
  totalQuizzes: number;
  overallAverageScore: number;
  recentAverageScore: number;
  bestScore: number;
  worstScore: number;
  improvement: number;
  firstQuizDate: Date | null;
  lastQuizDate: Date | null;
  period: string;
  allAttempts: Array<{
    id: string;
    score: number;
    totalQuestions: number;
    percentage: number;
    completedAt: Date;
  }>;
  recentAttempts: Array<{
    id: string;
    score: number;
    totalQuestions: number;
    percentage: number;
    completedAt: Date;
  }>;
}
