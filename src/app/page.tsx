'use client';

import { useState, useEffect } from 'react';
import { EmailAuth } from '@/app/components/EmailAuth';
import { QuizInterface } from '@/app/components/QuizInterface';
import { Header } from '@/app/components/Header';

interface User {
  email: string;
  name?: string;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [wordnetSummary, setWordnetSummary] = useState<string | null>(null);

  useEffect(() => {
    // Check if user is already logged in (from localStorage)
    const savedUser = localStorage.getItem('lexileap_user');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
    setIsLoading(false);
  }, []);

  const handleLogin = (email: string, name?: string) => {
    const userData = { email, name };
    setUser(userData);
    localStorage.setItem('lexileap_user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('lexileap_user');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <Header user={user} onLogout={handleLogout} />
      
      <main className="container mx-auto px-4 py-8">
        {!user ? (
          <div className="max-w-md mx-auto">
            <div className="text-center mb-8">
              <h1 className="text-4xl font-bold text-gray-900 mb-4">
                LexiLeap
              </h1>
              <p className="text-lg text-gray-600 mb-2">
                Master vocabulary with intelligent quizzes
              </p>
              <p className="text-sm text-gray-500">
                Powered by WordNet&apos;s comprehensive dictionary
              </p>
            </div>
            
            <EmailAuth onLogin={handleLogin} />

            <div className="mt-6 flex justify-center">
              <button
                onClick={async () => {
                  const res = await fetch('/api/wordnet/generate', { method: 'POST' })
                  if (!res.ok) {
                    const data = await res.json().catch(() => ({}))
                    alert(`Generation failed: ${data.error || res.statusText}`)
                  } else {
                    alert('WordNet generation triggered. Check Firebase Storage for output.')
                  }
                }}
                className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
              >
                Generate WordNet Data
              </button>
            </div>

            <div className="mt-3 flex justify-center">
              <button
                onClick={async () => {
                  try {
                    setWordnetSummary('Loading...');
                    
                    // Call local API (backend handles the proxy logic)
                    const resp = await fetch('/api/wordnet/file', { cache: 'no-store' });
                    
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const start = performance.now();
                    const data = await resp.json();
                    const durationMs = Math.round(performance.now() - start);
                    const keys = Object.keys(data);
                    const wordsList = keys.join(', ');
                    const summary = `Loaded ${keys.length} words in ${durationMs} ms. Words: ${wordsList}`;
                    setWordnetSummary(summary);
                    // Log to server
                    try {
                      await fetch('/api/log', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                          severity: 'INFO',
                          event: 'wordnet_top10_loaded',
                          words: keys.length,
                          parseMs: durationMs,
                          wordsList: keys
                        })
                      });
                    } catch {}
                  } catch (e) {
                    setWordnetSummary(`Failed to load: ${(e as Error).message}`);
                  }
                }}
                className="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700"
              >
                Load WordNet JSON
              </button>
            </div>

            {wordnetSummary && (
              <p className="mt-3 text-center text-sm text-gray-600">{wordnetSummary}</p>
            )}
            
            <div className="mt-12 text-center">
              <h2 className="text-2xl font-semibold text-gray-800 mb-4">
                Why LexiLeap?
              </h2>
              <div className="space-y-3 text-left">
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-white text-sm">✓</span>
                  </div>
                  <p className="text-gray-600">
                    <strong>145,000+ words</strong> from the authoritative WordNet database
                  </p>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-white text-sm">✓</span>
                  </div>
                  <p className="text-gray-600">
                    <strong>Smart multiple choice</strong> questions with detailed explanations
                  </p>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-white text-sm">✓</span>
                  </div>
                  <p className="text-gray-600">
                    <strong>No passwords required</strong> - just your email to get started
                  </p>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-white text-sm">✓</span>
                  </div>
                  <p className="text-gray-600">
                    <strong>Adaptive learning</strong> that adjusts to your progress
                  </p>
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