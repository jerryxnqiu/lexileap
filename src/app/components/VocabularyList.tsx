'use client';

import { useEffect, useState } from 'react';

export function VocabularyList() {
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [total, setTotal] = useState<number>(0);
  const [items, setItems] = useState<Array<{ word: string; definition?: string; pos?: string; examples?: string[]; synonyms?: string[]; antonyms?: string[] }>>([]);
  const [loading, setLoading] = useState(false);

  const getPartOfSpeech = (pos?: string): string => {
    if (!pos) return '-';
    switch (pos.toLowerCase()) {
      case 'n': return 'noun';
      case 'v': return 'verb';
      case 'a': return 'adjective';
      case 'r': return 'adverb';
      default: return pos;
    }
  };

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      try {
        const resp = await fetch(`/api/wordnet/file?page=${page}&pageSize=${pageSize}`, { cache: 'no-store' });
        const text = await resp.text();
        if (!resp.ok || !text) throw new Error('Failed to load');
        const payload = JSON.parse(text) as { total: number; page: number; pageSize: number; items: Array<{ word: string; definition?: string; pos?: string; examples?: string[]; synonyms?: string[]; antonyms?: string[] }> };
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
  }, [page]);

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
                <th className="py-2 px-3 border-b">Meaning</th>
                <th className="py-2 px-3 border-b">Part of Speech</th>
                <th className="py-2 px-3 border-b">Examples</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.word} className="odd:bg-white even:bg-gray-50">
                  <td className="py-2 px-3 font-medium text-gray-900 align-top">{it.word}</td>
                  <td className="py-2 px-3 text-gray-800 align-top">{it.definition || '-'}</td>
                  <td className="py-2 px-3 text-gray-700 align-top">{getPartOfSpeech(it.pos)}</td>
                  <td className="py-2 px-3 text-gray-700 align-top">
                    {it.examples && it.examples.length ? (
                      <div>
                        <div>{it.examples.join('; ')}</div>
                        {it.synonyms && it.synonyms.length > 0 && (
                          <div className="text-xs text-blue-600 mt-1">
                            <strong>Synonyms:</strong> {it.synonyms.join(', ')}
                          </div>
                        )}
                        {it.antonyms && it.antonyms.length > 0 && (
                          <div className="text-xs text-red-600 mt-1">
                            <strong>Antonyms:</strong> {it.antonyms.join(', ')}
                          </div>
                        )}
                      </div>
                    ) : '-'}
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
            className="px-3 py-1 rounded border text-sm text-gray-800 hover:bg-gray-50"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </button>
        ) : (
          <div></div>
        )}
        <div className="text-sm text-gray-600">Page {page} / {totalPages} ({total} words)</div>
        <button
          className="px-3 py-1 rounded border text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page === totalPages}
        >
          Next
        </button>
      </div>
    </div>
  );
}


