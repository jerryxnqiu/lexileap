'use client';

import { useEffect, useState } from 'react';
import { Header } from '@/app/components/Header';
import { User } from '@/types/user';

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [mounted, setMounted] = useState(false);

  const getAuthToken = async (targetUrl: string) => {
    const res = await fetch('/api/auth-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUrl })
    });
    const data = await res.json();
    return data.token;
  };

  useEffect(() => {
    try {
      const stored = localStorage.getItem('lexileapUser');
      setUser(stored ? JSON.parse(stored) : null);
    } catch {
      setUser(null);
    } finally {
      setMounted(true);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <Header user={user} onLogout={() => { localStorage.removeItem('lexileapUser'); window.location.href = '/'; }} />
      <main className="container mx-auto px-4 py-8">
        {!mounted ? null : (
        <>
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Admin Dashboard</h1>

        <div className="max-w-md mx-auto">
          <button
            onClick={async () => {
              try {
                // Get the data-processing instance URL from config
                const configRes = await fetch('/api/config')
                const config = await configRes.json()
                const dataUrl = config.dataUrl
                
                if (!dataUrl) {
                  alert('Data processing service not configured')
                  return
                }
                
                // Call the data-processing instance directly
                const res = await fetch(`${dataUrl}/api/wordnet/generate`, { 
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${await getAuthToken(dataUrl)}`
                  }
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
        </>
        )}
      </main>
    </div>
  );
}


