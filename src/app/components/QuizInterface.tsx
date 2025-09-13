'use client';

import { useRouter } from 'next/navigation';
import { User } from '@/types/user';

export function QuizInterface({ user }: { user: User }) {
  const router = useRouter();

  const startQuiz = () => {
    router.push('/quiz');
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center py-12">
        <h2 className="text-3xl font-bold text-gray-900 mb-6">Ready to Test Your Vocabulary?</h2>
        <p className="text-lg text-gray-700 mb-8">
          Take a comprehensive quiz with 50 questions to test your vocabulary knowledge!
        </p>
        <button
          onClick={startQuiz}
          className="px-8 py-4 bg-blue-600 text-white text-lg font-semibold rounded-lg hover:bg-blue-700 transition-colors"
        >
          Start Quiz
        </button>
      </div>
    </div>
  );
}


