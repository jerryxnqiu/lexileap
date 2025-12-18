'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { User } from '@/types/user';
import { UserStats } from '@/types/analytics';
import { logger } from '@/libs/utils/logger';

interface DashboardProps {
  user: User;
  onAttemptClick: (attemptId: string) => void;
}

// Helper functions
const formatDate = (date: Date | null) => {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString();
};

const getScoreColor = (score: number, total: number) => {
  const percentage = (score / total) * 100;
  if (percentage >= 80) return 'text-green-600';
  if (percentage >= 60) return 'text-yellow-600';
  return 'text-red-600';
};

// Sub-components
function TimeRangeSelector({ timeRange, onTimeRangeChange }: { timeRange: number; onTimeRangeChange: (days: number) => void }) {
  return (
    <div className="mb-8">
      <div className="flex space-x-2">
        {[7, 30, 90, 0].map((days) => (
          <button
            key={days}
            onClick={() => onTimeRangeChange(days)}
            className={`px-4 py-2 rounded-lg font-medium ${
              timeRange === days
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-800 hover:bg-gray-50'
            }`}
          >
            {days === 0 ? 'All Time' : `${days} Days`}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatsOverview({ stats }: { stats: UserStats }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="text-3xl font-bold text-blue-600 mb-2">{stats.totalQuizzes}</div>
        <div className="text-gray-800">Total Quizzes</div>
      </div>
      
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="text-3xl font-bold text-green-600 mb-2">{stats.overallAverageScore}</div>
        <div className="text-gray-800">Average Score</div>
      </div>
      
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="text-3xl font-bold text-purple-600 mb-2">{stats.bestScore}</div>
        <div className="text-gray-800">Best Score</div>
      </div>
      
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className={`text-3xl font-bold mb-2 ${stats.improvement >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {stats.improvement >= 0 ? '+' : ''}{stats.improvement}
        </div>
        <div className="text-gray-800">Improvement</div>
      </div>
    </div>
  );
}

function RecentQuizzes({ attempts }: { attempts: UserStats['recentAttempts'] }) {
  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">Recent Quizzes</h2>
      <div className="space-y-3">
        {attempts.slice(0, 5).map((attempt) => (
          <div key={attempt.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
            <div>
              <div className="font-medium text-gray-900">{formatDate(attempt.completedAt)}</div>
              <div className="text-sm text-gray-700">{attempt.totalQuestions} questions</div>
            </div>
            <div className="text-right">
              <div className={`font-bold ${getScoreColor(attempt.score, attempt.totalQuestions)}`}>
                {attempt.score}/{attempt.totalQuestions}
              </div>
              <div className="text-sm text-gray-700">{attempt.percentage}%</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PerformanceTrends({ stats }: { stats: UserStats }) {
  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">Performance Trends</h2>
      <div className="space-y-4">
        <div className="flex justify-between">
          <span className="text-gray-800">Overall Average:</span>
          <span className="font-bold text-green-600">{stats.overallAverageScore}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-800">Recent Average:</span>
          <span className="font-bold text-blue-600">{stats.recentAverageScore}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-800">Best Score:</span>
          <span className="font-bold text-purple-600">{stats.bestScore}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-800">Worst Score:</span>
          <span className="font-bold text-red-600">{stats.worstScore}</span>
        </div>
      </div>
    </div>
  );
}

function QuizHistory({ attempts, onAttemptClick }: { attempts: UserStats['allAttempts']; onAttemptClick: (attemptId: string) => void }) {
  const handleClick = (attemptId: string) => {
    onAttemptClick(attemptId);
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">Quiz History</h2>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left py-3 px-4 text-gray-900 font-semibold">Date</th>
              <th className="text-left py-3 px-4 text-gray-900 font-semibold">Score</th>
              <th className="text-left py-3 px-4 text-gray-900 font-semibold">Percentage</th>
              <th className="text-left py-3 px-4 text-gray-900 font-semibold">Questions</th>
            </tr>
          </thead>
          <tbody>
            {attempts.slice(0, 50).map((attempt) => (
              <tr 
                key={attempt.id} 
                className="border-b hover:bg-gray-50 cursor-pointer" 
                onClick={() => handleClick(attempt.id)}
              >
                <td className="py-3 px-4 text-gray-900">{formatDate(attempt.completedAt)}</td>
                <td className={`py-3 px-4 font-medium ${getScoreColor(attempt.score, attempt.totalQuestions)}`}>
                  {attempt.score}/{attempt.totalQuestions}
                </td>
                <td className="py-3 px-4 text-gray-900">{attempt.percentage}%</td>
                <td className="py-3 px-4 text-gray-900">{attempt.totalQuestions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DashboardEmptyState() {
  const router = useRouter();

  return (
    <div className="text-center">
      <h1 className="text-4xl font-bold text-gray-900 mb-4">Your Progress Dashboard</h1>
      <div className="bg-white rounded-lg shadow-lg p-8">
        <p className="text-lg text-gray-600 mb-4">No quiz data found yet.</p>
        <p className="text-gray-500 mb-6">Take your first quiz to see your progress here!</p>
        <button
          onClick={() => router.push('/quiz')}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer"
        >
          Take Your First Quiz
        </button>
      </div>
    </div>
  );
}

function DashboardLoadingState() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
    </div>
  );
}

// Main Dashboard component
export function Dashboard({ user, onAttemptClick }: DashboardProps) {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState(30);

  useEffect(() => {
    fetchUserStats(user.email, timeRange);
  }, [user.email, timeRange]);

  const fetchUserStats = async (userId: string, days: number) => {
    try {
      setLoading(true);
      logger.info(`Fetching user stats for: ${userId}, days: ${days}`);
      const response = await fetch(`/api/quiz/analytics?type=user&userId=${userId}&days=${days}`);
      logger.info(`Response status: ${response.status}`);
      
      if (response.ok) {
        const data = await response.json();
        logger.info('User stats data:', data);
        logger.info('data.user:', data.user);
        logger.info('Setting stats to:', data.user);
        setStats(data.user);
      } else {
        const errorText = await response.text();
        logger.error('API error:', errorText);
        setStats(null);
      }
    } catch (error) {
      logger.error('Error fetching user stats:', error instanceof Error ? error : new Error(String(error)));
      setStats(null);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <DashboardLoadingState />;
  }

  if (!stats) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <DashboardEmptyState />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">Your Progress Dashboard</h1>
        <p className="text-lg text-gray-800">Track your vocabulary learning journey</p>
      </div>

      <TimeRangeSelector timeRange={timeRange} onTimeRangeChange={setTimeRange} />

      <StatsOverview stats={stats} />

      {/* Recent Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        <RecentQuizzes attempts={stats.recentAttempts} />
        <PerformanceTrends stats={stats} />
      </div>

      <QuizHistory attempts={stats.allAttempts} onAttemptClick={onAttemptClick} />

      {/* Action Buttons */}
      <div className="mt-8 flex justify-center space-x-4">
        <a
          href="/quiz"
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer inline-block text-center"
        >
          Take Another Quiz
        </a>
      </div>
    </div>
  );
}
