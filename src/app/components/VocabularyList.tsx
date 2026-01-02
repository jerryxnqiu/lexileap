'use client';

import { useEffect, useState } from 'react';

export function VocabularyList() {
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [total, setTotal] = useState<number>(0);
  const [items, setItems] = useState<Array<{ 
    word: string; 
    definition?: string; 
    synonyms?: string[];
    antonyms?: string[];
    frequency?: number;
    rank?: number;
    lastUpdated?: string | null;
  }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      try {
        const resp = await fetch(`/api/quiz/questions?page=${page}&pageSize=${pageSize}`, { cache: 'no-store' });
        if (!resp.ok) throw new Error('Failed to load');
        const payload = await resp.json() as { 
          total: number; 
          page: number; 
          pageSize: number; 
          items: Array<{ 
            word: string; 
            definition?: string; 
            synonyms?: string[];
            antonyms?: string[];
            frequency?: number;
            rank?: number;
            lastUpdated?: string | null;
          }> 
        };
        setTotal(payload.total || 0);
        setItems(Array.isArray(payload.items) ? payload.items : []);
      } catch {
        setTotal(0);
        setItems([]);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-800">Vocabulary List</h3>
        <div className="text-sm text-gray-500">{items.length} words on this page</div>
      </div>
      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500">No data loaded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="py-2 px-3 border-b">Word</th>
                <th className="py-2 px-3 border-b">Definition</th>
                <th className="py-2 px-3 border-b">Additional Info</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={`${it.word}-${idx}`} className="odd:bg-white even:bg-gray-50">
                  <td className="py-2 px-3 font-medium text-gray-900 align-top">{it.word}</td>
                  <td className="py-2 px-3 text-gray-800 align-top">{it.definition || '-'}</td>
                  <td className="py-2 px-3 text-gray-700 align-top text-sm">
                    <div className="space-y-1">
                      {it.synonyms && it.synonyms.length > 0 && (
                      <div>
                          <span className="font-semibold text-blue-600">Synonyms:</span>{' '}
                          <span className="text-gray-600">{it.synonyms.join(', ')}</span>
                          </div>
                        )}
                        {it.antonyms && it.antonyms.length > 0 && (
                        <div>
                          <span className="font-semibold text-red-600">Antonyms:</span>{' '}
                          <span className="text-gray-600">{it.antonyms.join(', ')}</span>
                        </div>
                      )}
                      {it.frequency !== undefined && it.frequency > 0 && (
                        <div className="text-gray-500 text-xs mt-1">
                          Frequency: {it.frequency.toLocaleString()}
                          {it.rank !== undefined && (
                            <span className="ml-2 text-gray-500">
                              (Rank: #{it.rank.toLocaleString()})
                            </span>
                          )}
                        </div>
                      )}
                      {it.lastUpdated && (
                        <div className="text-gray-500 text-xs mt-1">
                          Last updated: {new Date(it.lastUpdated).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between mt-4">
        {page > 1 ? (
          <button
            className="px-3 py-1 rounded border text-sm text-gray-800 hover:bg-gray-50 cursor-pointer"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </button>
        ) : (
          <div></div>
        )}
        <div className="text-sm text-gray-600">Page {page} / {totalPages} ({total} words)</div>
        <button
          className="px-3 py-1 rounded border text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page === totalPages}
        >
          Next
        </button>
      </div>
    </div>
  );
}


