'use client';

interface QuizInterfaceProps {
  onStartStudy: () => void;
}

export function QuizInterface({ onStartStudy }: QuizInterfaceProps) {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center py-12">
        <h2 className="text-3xl font-bold text-gray-900 mb-6">Ready to Test Your Vocabulary?</h2>
        <p className="text-lg text-gray-700 mb-8">
          Study 200 words and 50 phrases, then select 50 for testing!
        </p>
        <button
          onClick={onStartStudy}
          className="px-8 py-4 bg-blue-600 text-white text-lg font-semibold rounded-lg hover:bg-blue-700 transition-colors cursor-pointer"
        >
          Start Study Session
        </button>
      </div>
    </div>
  );
}


