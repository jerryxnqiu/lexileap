'use client';

import { useState, useEffect } from 'react';
import { EmailAuth } from '@/app/components/EmailAuth';
import { QuizInterface } from '@/app/components/QuizInterface';
import { Header } from '@/app/components/Header';
import { User } from '@/types/user';

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [wordnetSummary, setWordnetSummary] = useState<string | null>(null);

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

  const handleLogin = (email: string, name?: string) => {
    const userData: User = { 
      email, 
      name,
      lastLoginAt: new Date()
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
              <div className="mx-auto mb-3 text-5xl">
                🐸✨
              </div>
              <h1 className="text-5xl font-extrabold text-gray-900 mb-3 tracking-tight">
                LexiLeap
              </h1>
              <p className="text-lg text-gray-700 mb-2">
                Learn new words with fun quizzes!
              </p>
              <p className="text-sm text-gray-500">
                Safe sign-in • Kid‑friendly • Quick to start
              </p>
            </div>
            
            <EmailAuth onLogin={handleLogin} />

            <div className="mt-4 p-4 bg-white/70 backdrop-blur rounded-xl border border-emerald-200 shadow-sm">
              <p className="text-center text-emerald-800 font-semibold mb-2">
                How it works
              </p>
              <ol className="space-y-2 text-emerald-900 text-sm">
                <li>1️⃣ Type your email</li>
                <li>2️⃣ We send a 6‑digit code</li>
                <li>3️⃣ Enter the code and start playing!</li>
              </ol>
              <p className="mt-3 text-xs text-emerald-700 text-center">
                🔒 Secure email sign‑in. Sessions expire after 24 hours.
              </p>
            </div>

            {/* Admin link removed; access controlled elsewhere */}
            
            <div className="mt-12 text-center">
              <h2 className="text-2xl font-extrabold text-gray-800 mb-4">
                Why kids love LexiLeap 💚
              </h2>
              <div className="space-y-3 text-left">
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
          <QuizInterface user={user} />
        )}
      </main>
    </div>
  );
}