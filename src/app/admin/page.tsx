'use client';

import { useState } from 'react';

export default function AdminPage() {
  const [wordnetSummary, setWordnetSummary] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <main className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Admin Dashboard</h1>

        <div className="grid gap-4 sm:grid-cols-2">
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

          <button
            onClick={async () => {
              try {
                setWordnetSummary('Loading...');
                const resp = await fetch('/api/wordnet/file', { cache: 'no-store' });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const start = performance.now();
                const data = await resp.json();
                const durationMs = Math.round(performance.now() - start);
                const keys = Object.keys(data);
                const wordsList = keys.join(', ');
                const summary = `Loaded ${keys.length} words in ${durationMs} ms. Words: ${wordsList}`;
                setWordnetSummary(summary);
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
          <p className="mt-4 text-sm text-gray-700">{wordnetSummary}</p>
        )}
      </main>
    </div>
  );
}


