import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

// Pages for the admin tables: usePaged(rows) gives the rows of the current page and the pager to show under the
// table (nothing when everything fits on one page).

export function usePaged<T>(rows: T[] | null | undefined, size = 20) {
  const [page, setPage] = useState(0);
  const total = rows?.length ?? 0;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, pages - 1);
  // Back to a valid page when the list shrinks (a search, a deletion)
  useEffect(() => { if (page > pages - 1) setPage(pages - 1); }, [page, pages]);
  return {
    rows: rows ? rows.slice(current * size, current * size + size) : [],
    pager: total > size ? <Pager page={current} pages={pages} total={total} size={size} onPage={setPage} /> : null,
    reset: () => setPage(0),
  };
}

const btn = 'min-w-8 h-8 px-2 rounded-lg border text-xs font-semibold flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export const Pager: React.FC<{ page: number; pages: number; total: number; size: number; onPage: (p: number) => void }> = ({ page, pages, total, size, onPage }) => {
  // Up to 5 page numbers around the current one
  const from = Math.max(0, Math.min(page - 2, pages - 5));
  const numbers = Array.from({ length: Math.min(5, pages) }, (_, i) => from + i);
  const idle = 'border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700';
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-t border-slate-800">
      <span className="text-[11px] text-slate-400">
        {(page * size + 1).toLocaleString('en-US')}–{Math.min(total, (page + 1) * size).toLocaleString('en-US')} من {total.toLocaleString('en-US')}
      </span>
      <div className="flex items-center gap-1">
        {/* Right to left: the first page is on the right */}
        <button type="button" className={`${btn} ${idle}`} disabled={page === 0} onClick={() => onPage(0)} aria-label="الصفحة الأولى"><ChevronsRight className="w-3.5 h-3.5" /></button>
        <button type="button" className={`${btn} ${idle}`} disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="السابقة"><ChevronRight className="w-3.5 h-3.5" /></button>
        {numbers.map(n => (
          <button key={n} type="button" onClick={() => onPage(n)} aria-current={n === page ? 'page' : undefined}
            className={`${btn} ${n === page ? 'border-amber-500/70 bg-amber-500/10 text-amber-300' : idle}`}>{n + 1}</button>
        ))}
        <button type="button" className={`${btn} ${idle}`} disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label="التالية"><ChevronLeft className="w-3.5 h-3.5" /></button>
        <button type="button" className={`${btn} ${idle}`} disabled={page >= pages - 1} onClick={() => onPage(pages - 1)} aria-label="الصفحة الأخيرة"><ChevronsLeft className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
};
