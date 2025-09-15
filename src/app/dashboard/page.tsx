'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/app/components/Header';
import { User } from '@/types/user';
import { UserStats } from '@/types/analytics';
import { logger } from '@/libs/utils/logger';

export default function UserDashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState(30);
  const router = useRouter();

  useEffect(() => {
    // Check if user is logged in
    const savedUser = localStorage.getItem('lexileapUser');
    if (savedUser) {
      try {
        const userData = JSON.parse(savedUser);
        setUser(userData);
        fetchUserStats(userData.email, timeRange);
      } catch (error) {
        logger.error('Invalid user data:', error instanceof Error ? error : new Error(String(error)));
        router.push('/');
      }
    } else {
      router.push('/');
    }
  }, [router, timeRange]);

  const fetchUserStats = async (userId: string, days: number) => {
    try {
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
      }
    } catch (error) {
      logger.error('Error fetching user stats:', error instanceof Error ? error : new Error(String(error)));
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('lexileapUser');
    router.push('/');
  };

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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  logger.info(`Current stats state: ${JSON.stringify(stats)}`);
  logger.info(`Stats is null? ${stats === null}`);
  logger.info(`Stats is undefined? ${stats === undefined}`);

  if (!stats) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-sky-50 to-indigo-100">
        <Header user={user} onLogout={handleLogout} />
        <main className="container mx-auto px-4 py-8">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">Your Progress Dashboard</h1>
            <div className="bg-white rounded-lg shadow-lg p-8">
              <p className="text-lg text-gray-600 mb-4">No quiz data found yet.</p>
              <p className="text-gray-500 mb-6">Take your first quiz to see your progress here!</p>
              <button
                onClick={() => router.push('/quiz')}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Take Your First Quiz
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-sky-50 to-indigo-100">
      <Header user={user} onLogout={handleLogout} />
      
      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Your Progress Dashboard</h1>
          <p className="text-lg text-gray-600">Track your vocabulary learning journey</p>
        </div>

        {/* Time Range Selector */}
        <div className="mb-8">
          <div className="flex space-x-2">
            {[7, 30, 90, 0].map((days) => (
              <button
                key={days}
                onClick={() => setTimeRange(days)}
                className={`px-4 py-2 rounded-lg font-medium ${
                  timeRange === days
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {days === 0 ? 'All Time' : `${days} Days`}
              </button>
            ))}
          </div>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="text-3xl font-bold text-blue-600 mb-2">{stats.totalQuizzes}</div>
            <div className="text-gray-600">Total Quizzes</div>
          </div>
          
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="text-3xl font-bold text-green-600 mb-2">{stats.overallAverageScore}</div>
            <div className="text-gray-600">Average Score</div>
          </div>
          
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="text-3xl font-bold text-purple-600 mb-2">{stats.bestScore}</div>
            <div className="text-gray-600">Best Score</div>
          </div>
          
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className={`text-3xl font-bold mb-2 ${stats.improvement >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {stats.improvement >= 0 ? '+' : ''}{stats.improvement}
            </div>
            <div className="text-gray-600">Improvement</div>
          </div>
        </div>

        {/* Recent Performance */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Recent Quizzes */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Recent Quizzes</h2>
            <div className="space-y-3">
              {stats.recentAttempts.slice(0, 5).map((attempt) => (
                <div key={attempt.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                  <div>
                    <div className="font-medium">{formatDate(attempt.completedAt)}</div>
                    <div className="text-sm text-gray-600">{attempt.totalQuestions} questions</div>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold ${getScoreColor(attempt.score, attempt.totalQuestions)}`}>
                      {attempt.score}/{attempt.totalQuestions}
                    </div>
                    <div className="text-sm text-gray-600">{attempt.percentage}%</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Performance Trends */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Performance Trends</h2>
            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-gray-600">Overall Average:</span>
                <span className="font-bold text-green-600">{stats.overallAverageScore}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Recent Average:</span>
                <span className="font-bold text-blue-600">{stats.recentAverageScore}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Best Score:</span>
                <span className="font-bold text-purple-600">{stats.bestScore}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Worst Score:</span>
                <span className="font-bold text-red-600">{stats.worstScore}</span>
              </div>
            </div>
          </div>
        </div>

        {/* All Quiz History */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Quiz History</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4">Date</th>
                  <th className="text-left py-3 px-4">Score</th>
                  <th className="text-left py-3 px-4">Percentage</th>
                  <th className="text-left py-3 px-4">Questions</th>
                </tr>
              </thead>
              <tbody>
                {stats.allAttempts.slice(0, 50).map((attempt) => (
                  <tr key={attempt.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/dashboard/attempt/${encodeURIComponent(attempt.id)}`)}>
                    <td className="py-3 px-4">{formatDate(attempt.completedAt)}</td>
                    <td className={`py-3 px-4 font-medium ${getScoreColor(attempt.score, attempt.totalQuestions)}`}>
                      {attempt.score}/{attempt.totalQuestions}
                    </td>
                    <td className="py-3 px-4">{attempt.percentage}%</td>
                    <td className="py-3 px-4">{attempt.totalQuestions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-8 flex justify-center space-x-4">
          <button
            onClick={() => router.push('/')}
            className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
          >
            Back to Home
          </button>
          <button
            onClick={() => router.push('/quiz')}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Take Another Quiz
          </button>
        </div>
      </main>
    </div>
  );
}
