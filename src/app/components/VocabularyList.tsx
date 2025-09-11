'use client';

import { useMemo, useState } from 'react';
import { WordData } from '@/types/wordnet';

interface Props {
  data: Record<string, WordData> | string[] | null;
}

export function VocabularyList({ data }: Props) {
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const words = useMemo(() => {
    if (!data) return [] as string[];
    if (Array.isArray(data)) return data as string[];
    return Object.keys(data as Record<string, WordData>);
  }, [data]);
  const totalPages = Math.max(1, Math.ceil(words.length / pageSize));
  const start = (page - 1) * pageSize;
  const slice = words.slice(start, start + pageSize);

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-800">Vocabulary List</h3>
        <div className="text-sm text-gray-500">{words.length} words</div>
      </div>
      {slice.length === 0 ? (
        <p className="text-sm text-gray-500">No data loaded.</p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {slice.map((w) => (
            <li key={w} className="p-2 border border-gray-200 rounded">
              <span className="font-medium text-gray-900">{w}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between mt-4">
        <button
          className="px-3 py-1 rounded border text-sm disabled:opacity-50"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
        >
          Prev
        </button>
        <div className="text-sm text-gray-600">Page {page} / {totalPages}</div>
        <button
          className="px-3 py-1 rounded border text-sm disabled:opacity-50"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page === totalPages}
        >
          Next
        </button>
      </div>
    </div>
  );
}


