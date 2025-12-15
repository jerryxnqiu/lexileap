'use client';

interface QuizQuestion {
  word: string;
  definition: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
  examples: string[];
}

interface QuizQuestionProps {
  question: QuizQuestion;
  userAnswer: number | null;
  showResult: boolean;
  isCorrect: boolean;
  onAnswer: (index: number) => void;
  onNext: () => void;
}

export function QuizQuestion({
  question,
  userAnswer,
  showResult,
  isCorrect,
  onAnswer,
  onNext
}: QuizQuestionProps) {
  const getOptionStyle = (index: number) => {
    if (!showResult) {
      return "w-full p-4 text-left border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-colors cursor-pointer";
    }

    if (index === question.correctAnswer) {
      return "w-full p-4 text-left border-2 border-green-500 bg-green-50 rounded-lg cursor-pointer";
    }

    if (index === userAnswer && index !== question.correctAnswer) {
      return "w-full p-4 text-left border-2 border-red-500 bg-red-50 rounded-lg cursor-pointer";
    }

    return "w-full p-4 text-left border border-gray-300 rounded-lg bg-gray-50 cursor-pointer";
  };

  const getOptionIcon = (index: number) => {
    if (!showResult) return null;

    if (index === question.correctAnswer) {
      return (
        <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
          <span className="text-white text-sm">✓</span>
        </div>
      );
    }

    if (index === userAnswer && index !== question.correctAnswer) {
      return (
        <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center flex-shrink-0">
          <span className="text-white text-sm">✗</span>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="space-y-6">
      {/* Question Header */}
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          What does &ldquo;{question.word}&rdquo; mean?
        </h2>
        <p className="text-gray-600">
          Choose the correct definition from the options below.
        </p>
      </div>

      {/* Options */}
      <div className="space-y-3">
        {question.options.map((option, index) => (
          <button
            key={index}
            onClick={() => onAnswer(index)}
            disabled={showResult}
            className={getOptionStyle(index)}
          >
            <div className="flex items-start space-x-3">
              {getOptionIcon(index)}
              <div className="flex-1">
                <div className="flex items-center space-x-2 mb-1">
                  <span className="font-medium text-gray-700">
                    {String.fromCharCode(65 + index)}.
                  </span>
                </div>
                <p className="text-gray-800 leading-relaxed">{option}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Result Section */}
      {showResult && (
        <div className="space-y-4">
          {/* Result Message */}
          <div className={`p-4 rounded-lg ${
            isCorrect 
              ? 'bg-green-50 border border-green-200' 
              : 'bg-red-50 border border-red-200'
          }`}>
            <div className="flex items-center space-x-2">
              {isCorrect ? (
                <>
                  <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm">✓</span>
                  </div>
                  <h3 className="text-lg font-semibold text-green-800">
                    Correct!
                  </h3>
                </>
              ) : (
                <>
                  <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm">✗</span>
                  </div>
                  <h3 className="text-lg font-semibold text-red-800">
                    Not quite right
                  </h3>
                </>
              )}
            </div>
            <p className={`mt-2 ${isCorrect ? 'text-green-700' : 'text-red-700'}`}>
              {isCorrect 
                ? 'Great job! You got it right.' 
                : `The correct answer was: ${question.options[question.correctAnswer]}`
              }
            </p>
          </div>

          {/* Explanation */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="font-semibold text-blue-800 mb-2">Explanation:</h4>
            <p className="text-blue-700 mb-3">{question.explanation}</p>
            
            {question.examples.length > 0 && (
              <div>
                <h5 className="font-medium text-blue-800 mb-2">Examples:</h5>
                <ul className="list-disc list-inside space-y-1">
                  {question.examples.map((example, index) => (
                    <li key={index} className="text-blue-700 italic">
                      &ldquo;{example}&rdquo;
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Next Button */}
          <div className="text-center">
            <button
              onClick={onNext}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors font-medium cursor-pointer"
            >
              Next Question
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


