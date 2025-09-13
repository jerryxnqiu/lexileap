'use client';

import { useState, useEffect } from 'react';
import { EmailAuth } from '@/app/components/EmailAuth';
import { QuizInterface } from '@/app/components/QuizInterface';
import { Header } from '@/app/components/Header';
import { User } from '@/types/user';
import { VocabularyList } from '@/app/components/VocabularyList';
import { WordData } from '@/types/wordnet';

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // removed unused wordnetSummary
  const [view, setView] = useState<'menu' | 'quiz' | 'list' | 'scores'>('menu');
  const [wordnetData, setWordnetData] = useState<Record<string, WordData> | null>(null);
  const [isWordnetLoading, setIsWordnetLoading] = useState(false);

  useEffect(() => {
    // Check if user is already logged in (from localStorage)
    const savedUser = localStorage.getItem('lexileapUser');
    if (savedUser) {
      try {
        const userData = JSON.parse(savedUser);
        // Check if the session is still valid (less than 24 hours old)
        if (userData.lastLoginAt) {
          const lastLogin = new Date(userData.lastLoginAt);
          const now = new Date();
          const hoursSinceLogin = (now.getTime() - lastLogin.getTime()) / (1000 * 60 * 60);
          
          if (hoursSinceLogin < 24) {
            setUser(userData);
          } else {
            // Session expired, clear localStorage
            localStorage.removeItem('lexileapUser');
          }
        } else {
          setUser(userData);
        }
      } catch (error) {
        // Invalid data in localStorage, clear it
        localStorage.removeItem('lexileapUser');
        console.error('Invalid user data in localStorage:', error);
      }
    }
    setIsLoading(false);
  }, []);

  const handleLogin = (email: string, name?: string, isAdmin?: boolean) => {
    const userData: User = { 
      email, 
      name,
      lastLoginAt: new Date(),
      isAdmin
    };
    setUser(userData);
    localStorage.setItem('lexileapUser', JSON.stringify(userData));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('lexileapUser');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-sky-50 to-indigo-100">
      <Header user={user} onLogout={handleLogout} />
      
      <main className="container mx-auto px-4 py-8">
        {!user ? (
          <div className="max-w-md mx-auto">
            <div className="text-center mb-8">
              <div className="mx-auto mb-3">
                <img 
                  src="/LexiLeap-logo.png" 
                  alt="LexiLeap Logo" 
                  className="h-20 w-auto mx-auto"
                />
              </div>
              <p className="text-sm text-gray-500">
                Safe sign-in • Kid‑friendly • Quick to start
              </p>
            </div>
            
            <EmailAuth onLogin={(email, name, isAdmin) => handleLogin(email, name, isAdmin)} />

            <div className="mt-4 p-4 bg-white/70 backdrop-blur rounded-xl border border-emerald-200 shadow-sm">
              <p className="text-center text-emerald-800 font-semibold mb-2">
                How it works
              </p>
              <ol className="space-y-2 text-emerald-900 text-sm">
                <li>1️⃣ Type your email</li>
                <li>2️⃣ We send a 6‑digit code</li>
                <li>3️⃣ Enter the code and start playing!</li>
                <li>🔒 Secure email sign‑in. Sessions expire after 24 hours.</li>
              </ol>
            </div>

            {/* Admin link removed; access controlled elsewhere */}
            
            <div className="mt-12 text-center">
              <h2 className="text-2xl font-extrabold text-gray-800 mb-4">
                My daughters loves LexiLeap 💖
              </h2>
              <div className="space-y-1.5 text-left">
                <div className="flex items-start space-x-3">
                  <span className="text-2xl">📚</span>
                  <p className="text-gray-700"><strong>Lots of words</strong> to explore and learn</p>
                </div>
                <div className="flex items-start space-x-3">
                  <span className="text-2xl">🎯</span>
                  <p className="text-gray-700"><strong>Fun quizzes</strong> with simple choices</p>
                </div>
                <div className="flex items-start space-x-3">
                  <span className="text-2xl">🔒</span>
                  <p className="text-gray-700"><strong>No passwords</strong> — just a quick code</p>
                </div>
                <div className="flex items-start space-x-3">
                  <span className="text-2xl">🚀</span>
                  <p className="text-gray-700"><strong>Grows with you</strong> as you improve</p>
                </div>
                <div className="flex items-start space-x-3">
                  <span className="text-2xl">🛡️</span>
                  <p className="text-gray-700"><strong>Privacy‑first</strong> — safe and gentle by design</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto">
            {view === 'menu' && (
              <div className="min-h-[60vh] flex items-center justify-center">
                <div className="w-full max-w-2xl grid gap-4 sm:grid-cols-2">
                  <button
                    onClick={() => setView('quiz')}
                    className="rounded-3xl bg-gradient-to-br from-blue-600 to-indigo-600 px-6 py-6 text-white shadow-md ring-1 ring-black/5 hover:shadow-lg hover:brightness-110 transition-all duration-200 flex items-center justify-center gap-2"
                  >
                    <span className="text-xl">🎯</span>
                    <span className="text-lg font-semibold">Start testing your vocabulary</span>
                  </button>
                  <button
                    onClick={async () => {
                      setView('list');
                      if (!wordnetData && !isWordnetLoading) {
                        try {
                          setIsWordnetLoading(true);
                          const resp = await fetch('/api/wordnet/file?full=1', { cache: 'no-store' });
                          const text = await resp.text();
                          if (!resp.ok || !text) {
                            setWordnetData({} as Record<string, WordData>);
                          } else {
                            const parsed = JSON.parse(text) as Record<string, WordData>;
                            // Allow either object map or pre-sliced array of keys
                            setWordnetData(parsed);
                          }
                        } catch {
                          setWordnetData({} as Record<string, WordData>);
                        } finally {
                          setIsWordnetLoading(false);
                        }
                      }
                    }}
                    className="rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-600 px-6 py-6 text-white shadow-md ring-1 ring-black/5 hover:shadow-lg hover:brightness-110 transition-all duration-200 flex items-center justify-center gap-2"
                  >
                    <span className="text-xl">📚</span>
                    <span className="text-lg font-semibold">Review all vocabulary</span>
                  </button>
                  <button
                    onClick={() => setView('scores')}
                    className="rounded-3xl bg-gradient-to-br from-indigo-600 to-violet-600 px-6 py-6 text-white shadow-md ring-1 ring-black/5 hover:shadow-lg hover:brightness-110 transition-all duration-200 flex items-center justify-center gap-2 sm:col-span-2"
                  >
                    <span className="text-xl">📈</span>
                    <span className="text-lg font-semibold">Review your past scores</span>
                  </button>
                  {user.isAdmin && (
                    <a
                      href="/admin"
                      className="rounded-3xl bg-gradient-to-br from-purple-600 to-fuchsia-600 px-6 py-6 text-white shadow-md ring-1 ring-black/5 hover:shadow-lg hover:brightness-110 transition-all duration-200 flex items-center justify-center gap-2 sm:col-span-2 text-center"
                    >
                      <span className="text-xl">🛠️</span>
                      <span className="text-lg font-semibold">Admin Dashboard</span>
                    </a>
                  )}
                </div>
              </div>
            )}

            {view === 'quiz' && (
              <div>
                <div className="mb-4">
                  <button onClick={() => setView('menu')} className="text-sm text-gray-600 hover:text-gray-800">← Back</button>
                </div>
                <QuizInterface user={user} />
              </div>
            )}

            {view === 'list' && (
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <button onClick={() => setView('menu')} className="text-sm text-gray-600 hover:text-gray-800">← Back</button>
                  {isWordnetLoading && <span className="text-sm text-gray-500">Loading...</span>}
                </div>
                <VocabularyList />
              </div>
            )}

            {view === 'scores' && (
              <div>
                <div className="mb-4">
                  <button onClick={() => setView('menu')} className="text-sm text-gray-600 hover:text-gray-800">← Back</button>
                </div>
                <div className="bg-white rounded-lg shadow p-6 text-center text-gray-600">
                  Coming soon: your past scores and progress.
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}