/** Searchable archive of past retrospectives. */
import { useCallback, useEffect, useState } from 'react';
import { Archive, ArchiveRestore, Search, Users } from 'lucide-react';
import { MOODS } from '@shared/catalog';
import type { RetroBoard, RetroListItem } from '@shared/types';
import { call } from '../lib/api';
import { useToast } from './toast';
import { Button, cx, Spinner } from './ui';

type Status = 'all' | 'active' | 'closed' | 'archived';
const STATUS_STYLE: Record<RetroListItem['status'], string> = {
  active: 'bg-emerald-50 text-emerald-700',
  closed: 'bg-slate-100 text-slate-700',
  archived: 'bg-amber-50 text-amber-800',
};

export function HistoryView({ onOpen }: { onOpen: (id: string) => void }) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const [items, setItems] = useState<RetroListItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  const fetchPage = useCallback(
    (after: string | null) => call<{ items: RetroListItem[]; cursor: string | null }>('retros.list', { query: debounced || undefined, status, limit: 25, ...(after ? { cursor: after } : {}) }),
    [debounced, status],
  );

  useEffect(() => {
    let alive = true;
    setItems(null);
    fetchPage(null)
      .then((r) => alive && (setItems(r.items), setCursor(r.cursor)))
      .catch((e) => alive && (toast('error', e.message), setItems([])));
    return () => {
      alive = false;
    };
  }, [fetchPage, toast]);

  const more = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const r = await fetchPage(cursor);
      setItems((xs) => [...(xs ?? []), ...r.items]);
      setCursor(r.cursor);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const archive = async (r: RetroListItem, archived: boolean) => {
    try {
      const b = await call<RetroBoard>('retros.archive', { retroId: r.id, archived });
      setItems((xs) => (status === 'all' ? xs?.map((x) => (x.id === r.id ? { ...x, status: b.status } : x)) : xs?.filter((x) => x.id !== r.id)) ?? null);
      toast('success', archived ? 'Archived' : 'Restored');
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold">Retro history</h2>
        <label className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-2 size-4 text-slate-400" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title..." aria-label="Search retros" className="h-9 w-64 rounded-md border border-[var(--sp-border)] pr-2 pl-8 text-sm" />
        </label>
        <div className="flex rounded-md border border-[var(--sp-border)] p-0.5" role="group" aria-label="Status filter">
          {(['all', 'active', 'closed', 'archived'] as const).map((st) => (
            <button key={st} type="button" aria-pressed={status === st} onClick={() => setStatus(st)} className={cx('rounded px-2.5 py-1 text-xs font-medium capitalize', status === st ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50')}>
              {st}
            </button>
          ))}
        </div>
      </div>

      {items === null ? (
        <div className="flex items-center gap-2 text-slate-500"><Spinner /> Loading...</div>
      ) : !items.length ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">{debounced ? `No retros match "${debounced}".` : 'No retros here yet.'}</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--sp-border)] bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Retro</th>
                <th className="px-2 py-2 font-medium">Date</th>
                <th className="px-2 py-2 font-medium">Mood</th>
                <th className="px-2 py-2 font-medium">Participation</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const mood = r.summary?.moodAverage != null ? MOODS.reduce((b, m) => (Math.abs(m.score - r.summary!.moodAverage!) < Math.abs(b.score - r.summary!.moodAverage!) ? m : b)) : null;
                return (
                  <tr key={r.id} className="border-t border-[var(--sp-border)] hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <button type="button" onClick={() => onOpen(r.id)} className="text-left font-medium text-brand-700 hover:underline">{r.title}</button>
                      {r.sprintName && <div className="text-xs text-slate-500">{r.sprintName}</div>}
                    </td>
                    <td className="px-2 text-slate-600 tabular-nums">{new Date(r.createdAt).toLocaleDateString()}</td>
                    <td className="px-2">{mood ? <span title={`${r.summary!.moodAverage!.toFixed(2)} / 5`}>{mood.emoji} {r.summary!.moodAverage!.toFixed(1)}</span> : <span className="text-slate-400">-</span>}</td>
                    <td className="px-2 text-xs text-slate-600">
                      {r.summary ? (
                        <span className="flex items-center gap-2"><span className="flex items-center gap-1"><Users className="size-3.5" />{r.summary.participantCount}</span>{r.summary.cardCount} cards · {r.summary.actionCount} actions</span>
                      ) : (
                        <span className="text-slate-400">In progress</span>
                      )}
                    </td>
                    <td className="px-2"><span className={cx('rounded-full px-2 py-0.5 text-[11px] font-medium capitalize', STATUS_STYLE[r.status])}>{r.status}</span></td>
                    <td className="px-2 text-right">
                      {r.status === 'archived' ? (
                        <button type="button" aria-label={`Restore ${r.title}`} title="Restore" onClick={() => archive(r, false)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><ArchiveRestore className="size-4" /></button>
                      ) : (
                        <button type="button" aria-label={`Archive ${r.title}`} title="Archive (facilitators only)" onClick={() => archive(r, true)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Archive className="size-4" /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {cursor && (
            <div className="border-t border-[var(--sp-border)] p-2 text-center">
              <Button size="sm" variant="ghost" onClick={more} disabled={loadingMore}>{loadingMore && <Spinner />} Load more</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
