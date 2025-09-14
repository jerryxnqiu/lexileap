'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/app/components/Header';
import { User } from '@/types/user';
import { OverviewStats, DailyStats, WordAnalytics, RecentActivity } from '@/types/analytics';

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState(30);
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);
  const [wordAnalytics, setWordAnalytics] = useState<WordAnalytics | null>(null);
  const [recentActivity, setRecentActivity] = useState<RecentActivity | null>(null);
  const [activeTab, setActiveTab] = useState<'data' | 'analytics'>('data');
  const router = useRouter();

  useEffect(() => {
    try {
      const stored = localStorage.getItem('lexileapUser');
      const userData = stored ? JSON.parse(stored) : null;
      setUser(userData);
      setMounted(true);
      setLoading(false);
    } catch {
      setUser(null);
      setMounted(true);
      setLoading(false);
    }
  }, []);

  const fetchAllAnalytics = async (days: number) => {
    try {
      const [overviewRes, dailyRes, wordRes, recentRes] = await Promise.all([
        fetch(`/api/quiz/analytics?type=overview&days=${days}`),
        fetch(`/api/quiz/analytics?type=daily&days=${days}`),
        fetch(`/api/quiz/analytics?type=word-analytics&days=${days}`),
        fetch(`/api/quiz/analytics?type=recent&days=${days}`)
      ]);

      if (overviewRes.ok) {
        const data = await overviewRes.json();
        setOverview(data.overview);
      }

      if (dailyRes.ok) {
        const data = await dailyRes.json();
        setDailyStats(data.daily);
      }

      if (wordRes.ok) {
        const data = await wordRes.json();
        setWordAnalytics(data.wordAnalytics);
      }

      if (recentRes.ok) {
        const data = await recentRes.json();
        setRecentActivity(data.recent);
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
    }
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString();
  };

  const formatDateTime = (date: Date | string) => {
    return new Date(date).toLocaleString();
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'easy': return 'text-green-600 bg-green-100';
      case 'medium': return 'text-yellow-600 bg-yellow-100';
      case 'hard': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <Header user={user} onLogout={() => { localStorage.removeItem('lexileapUser'); window.location.href = '/'; }} />
      <main className="container mx-auto px-4 py-8">
        {!mounted ? null : (
        <>
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Admin Dashboard</h1>

        {/* Tab Navigation */}
        <div className="mb-8">
          <div className="flex space-x-2">
            <button
              onClick={() => setActiveTab('data')}
              className={`px-6 py-3 rounded-lg font-medium ${
                activeTab === 'data'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              Data Management
            </button>
            <button
              onClick={() => {
                setActiveTab('analytics');
                fetchAllAnalytics(timeRange);
              }}
              className={`px-6 py-3 rounded-lg font-medium ${
                activeTab === 'analytics'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              Analytics Dashboard
            </button>
          </div>
        </div>

        {/* Data Management Tab */}
        {activeTab === 'data' && (
          <div className="max-w-md mx-auto">
            <button
              onClick={async () => {
                try {
                  // Call the local proxy endpoint which handles authentication to data-processing instance
                  const res = await fetch('/api/wordnet/generate', { 
                    method: 'POST'
                  })
                  
                  if (!res.ok) {
                    const data = await res.json().catch(() => ({}))
                    alert(`Generation failed: ${data.error || res.statusText}`)
                  } else {
                    alert('WordNet generation triggered. Check Firebase Storage for output.')
                  }
                } catch (error) {
                  alert(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
                }
              }}
              className="w-full rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 text-white font-semibold hover:from-blue-700 hover:to-indigo-700 shadow-lg hover:shadow-xl transition-all duration-200"
            >
              Prepare WordNet Data
            </button>
          </div>
        )}

        {/* Analytics Dashboard Tab */}
        {activeTab === 'analytics' && (
          <div>
            {/* Time Range Selector */}
            <div className="mb-8">
              <div className="flex space-x-2">
                {[7, 30, 90, 0].map((days) => (
                  <button
                    key={days}
                    onClick={() => {
                      setTimeRange(days);
                      fetchAllAnalytics(days);
                    }}
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

            {/* Overview Stats */}
            {overview && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
                <div className="bg-white rounded-lg shadow-lg p-6">
                  <div className="text-3xl font-bold text-blue-600 mb-2">{overview.totalUsers}</div>
                  <div className="text-gray-600">Total Users</div>
                </div>
                
                <div className="bg-white rounded-lg shadow-lg p-6">
                  <div className="text-3xl font-bold text-green-600 mb-2">{overview.totalQuizzes}</div>
                  <div className="text-gray-600">Total Quizzes</div>
                </div>
                
                <div className="bg-white rounded-lg shadow-lg p-6">
                  <div className="text-3xl font-bold text-purple-600 mb-2">{overview.averageScore}</div>
                  <div className="text-gray-600">Avg Score</div>
                </div>
                
                <div className="bg-white rounded-lg shadow-lg p-6">
                  <div className="text-3xl font-bold text-orange-600 mb-2">{overview.averagePercentage}%</div>
                  <div className="text-gray-600">Avg Percentage</div>
                </div>
                
                <div className="bg-white rounded-lg shadow-lg p-6">
                  <div className="text-3xl font-bold text-indigo-600 mb-2">{overview.totalQuestions}</div>
                  <div className="text-gray-600">Total Questions</div>
                </div>
              </div>
            )}

            {/* Daily Stats */}
            {dailyStats && (
              <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-4">Daily Statistics</h2>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-4">Date</th>
                        <th className="text-left py-3 px-4">Users</th>
                        <th className="text-left py-3 px-4">Quizzes</th>
                        <th className="text-left py-3 px-4">Avg Score</th>
                        <th className="text-left py-3 px-4">Avg %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyStats.dailyStats.slice(0, 10).map((day) => (
                        <tr key={day.date} className="border-b hover:bg-gray-50">
                          <td className="py-3 px-4">{formatDate(day.date)}</td>
                          <td className="py-3 px-4">{day.totalUsers}</td>
                          <td className="py-3 px-4">{day.totalQuizzes}</td>
                          <td className="py-3 px-4">{day.averageScore}</td>
                          <td className="py-3 px-4">{day.averagePercentage}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Word Analytics */}
            {wordAnalytics && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                {/* Difficulty Distribution */}
                <div className="bg-white rounded-lg shadow-lg p-6">
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">Word Difficulty Distribution</h2>
                  <div className="space-y-3">
                    {Object.entries(wordAnalytics.difficultyStats).map(([difficulty, count]) => (
                      <div key={difficulty} className="flex justify-between items-center">
                        <span className={`px-3 py-1 rounded-full text-sm font-medium ${getDifficultyColor(difficulty)}`}>
                          {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
                        </span>
                        <span className="font-bold">{count} words</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Most/Least Accurate Words */}
                <div className="bg-white rounded-lg shadow-lg p-6">
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">Word Performance</h2>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h3 className="font-bold text-green-600 mb-2">Most Accurate</h3>
                      <div className="space-y-1">
                        {wordAnalytics.mostAccurate.slice(0, 5).map((word) => (
                          <div key={word.word} className="text-sm">
                            <span className="font-medium">{word.word}</span>
                            <span className="text-green-600 ml-2">{word.accuracy}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h3 className="font-bold text-red-600 mb-2">Least Accurate</h3>
                      <div className="space-y-1">
                        {wordAnalytics.leastAccurate.slice(0, 5).map((word) => (
                          <div key={word.word} className="text-sm">
                            <span className="font-medium">{word.word}</span>
                            <span className="text-red-600 ml-2">{word.accuracy}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Recent Activity */}
            {recentActivity && (
              <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-4">Recent Activity</h2>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-4">Time</th>
                        <th className="text-left py-3 px-4">User</th>
                        <th className="text-left py-3 px-4">Score</th>
                        <th className="text-left py-3 px-4">Percentage</th>
                        <th className="text-left py-3 px-4">Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentActivity.recentSessions.map((session) => (
                        <tr key={session.sessionId} className="border-b hover:bg-gray-50">
                          <td className="py-3 px-4">{formatDateTime(session.endTime)}</td>
                          <td className="py-3 px-4">{session.userId}</td>
                          <td className="py-3 px-4">{session.score}/{session.totalQuestions}</td>
                          <td className="py-3 px-4">{session.percentage}%</td>
                          <td className="py-3 px-4">{session.duration ? `${session.duration}m` : 'N/A'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
        </>
        )}
      </main>
    </div>
  );
}


