'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Header } from '@/app/components/Header';
import { User } from '@/types/user';

type AttemptDetail = {
  sessionId: string;
  userId: string;
  startTime?: string | Date;
  endTime?: string | Date;
  score?: number;
  totalQuestions: number;
  questions: Array<{
    word: string;
    options: string[];
    correctIndex: number;
    userAnswer: number | null;
    isCorrect: boolean;
  }>;
}

export default function AttemptDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedUser = localStorage.getItem('lexileapUser');
    setUser(savedUser ? JSON.parse(savedUser) : null);
  }, []);

  useEffect(() => {
    const id = (params?.id as string) || '';
    if (!id) return;
    (async () => {
      try {
        const res = await fetch(`/api/quiz/attempt/${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error('Failed to load attempt');
        const data = await res.json();
        setAttempt(data);
      } catch {
        alert('Failed to load attempt');
        router.push('/dashboard');
      } finally {
        setLoading(false);
      }
    })();
  }, [params, router]);

  const formatDateTime = (d?: string | Date) => d ? new Date(d).toLocaleString() : 'N/A';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!attempt) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-sky-50 to-indigo-100">
      <Header user={user} onLogout={() => { localStorage.removeItem('lexileapUser'); router.push('/'); }} />
      <main className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <button onClick={() => router.push('/dashboard')} className="text-gray-600 hover:text-gray-800">← Back to Dashboard</button>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Attempt {attempt.sessionId}</h1>
          <p className="text-gray-600">{formatDateTime(attempt.startTime)} → {formatDateTime(attempt.endTime)}</p>
          <p className="text-gray-700 mt-2">Score: <span className="font-bold">{attempt.score ?? 'N/A'}</span> / {attempt.totalQuestions}</p>
        </div>

        <div className="space-y-4">
          {attempt.questions.map((q, idx) => (
            <div key={idx} className="bg-white rounded-lg shadow p-4">
              <div className="mb-2">
                <span className="text-sm text-gray-500">Q{idx + 1}</span>
                <h2 className="text-lg font-semibold text-gray-900">{q.word}</h2>
              </div>
              <ul className="space-y-2">
                {q.options.map((opt, i) => {
                  const isCorrect = i === q.correctIndex;
                  const isUser = q.userAnswer === i;
                  const base = 'px-3 py-2 rounded border';
                  const correctCls = 'border-green-500 bg-green-50 text-green-700';
                  const wrongCls = 'border-red-500 bg-red-50 text-red-700';
                  const neutralCls = 'border-gray-200';
                  let cls = neutralCls;
                  if (isCorrect) cls = correctCls;
                  if (isUser && !isCorrect) cls = wrongCls;
                  return (
                    <li key={i} className={`${base} ${cls}`}>
                      <span className="font-medium">{String.fromCharCode(65 + i)}.</span> {opt}
                      {isUser && <span className="ml-2 text-xs text-gray-500">(your choice)</span>}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}


