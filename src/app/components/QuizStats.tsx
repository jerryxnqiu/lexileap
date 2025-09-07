'use client';

interface QuizStats {
  totalQuestions: number;
  correctAnswers: number;
  currentStreak: number;
  bestStreak: number;
}

interface QuizStatsProps {
  stats: QuizStats;
}

export function QuizStats({ stats }: QuizStatsProps) {
  const accuracy = stats.totalQuestions > 0 
    ? Math.round((stats.correctAnswers / stats.totalQuestions) * 100) 
    : 0;

  return (
    <div className="bg-white rounded-lg shadow-sm border p-4">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Your Progress</h3>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-600">
            {stats.totalQuestions}
          </div>
          <div className="text-sm text-gray-600">Questions</div>
        </div>
        
        <div className="text-center">
          <div className="text-2xl font-bold text-green-600">
            {accuracy}%
          </div>
          <div className="text-sm text-gray-600">Accuracy</div>
        </div>
        
        <div className="text-center">
          <div className="text-2xl font-bold text-orange-600">
            {stats.currentStreak}
          </div>
          <div className="text-sm text-gray-600">Current Streak</div>
        </div>
        
        <div className="text-center">
          <div className="text-2xl font-bold text-purple-600">
            {stats.bestStreak}
          </div>
          <div className="text-sm text-gray-600">Best Streak</div>
        </div>
      </div>
      
      {stats.totalQuestions > 0 && (
        <div className="mt-4">
          <div className="flex justify-between text-sm text-gray-600 mb-1">
            <span>Progress</span>
            <span>{stats.correctAnswers}/{stats.totalQuestions}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${accuracy}%` }}
            ></div>
          </div>
        </div>
      )}
    </div>
  );
}


