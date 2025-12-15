'use client';

interface QuizResultsProps {
  score: number;
  totalQuestions: number;
  onRestart: () => void;
  onReview: () => void;
}

export function QuizResults({ score, totalQuestions, onRestart, onReview }: QuizResultsProps) {
  const percentage = Math.round((score / totalQuestions) * 100);
  
  const getScoreMessage = () => {
    if (percentage >= 90) return "Excellent! You're a vocabulary master!";
    if (percentage >= 80) return "Great job! You're doing very well!";
    if (percentage >= 70) return "Good work! Keep practicing!";
    if (percentage >= 60) return "Not bad! You're making progress!";
    return "Keep practicing! You'll get better with time!";
  };

  const getScoreColor = () => {
    if (percentage >= 80) return "text-green-600";
    if (percentage >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  return (
    <div className="text-center space-y-6">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold text-gray-900">Quiz Complete!</h2>
        <p className="text-gray-600">Here&apos;s how you did:</p>
      </div>

      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md mx-auto">
        <div className={`text-6xl font-bold ${getScoreColor()} mb-4`}>
          {percentage}%
        </div>
        
        <div className="text-2xl font-semibold text-gray-800 mb-2">
          {score} out of {totalQuestions}
        </div>
        
        <p className="text-gray-600 mb-6">
          {getScoreMessage()}
        </p>

        <div className="space-y-3">
          <button
            onClick={onRestart}
            className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors font-medium cursor-pointer"
          >
            Take Another Quiz
          </button>
          
          <button
            onClick={onReview}
            className="w-full bg-gray-100 text-gray-700 py-3 px-6 rounded-lg hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors font-medium cursor-pointer"
          >
            Review Mistakes
          </button>
        </div>
      </div>
    </div>
  );
}


