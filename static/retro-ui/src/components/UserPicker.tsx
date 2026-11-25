/** Assignee picker backed by Jira's assignable-user search for this project. */
import { useEffect, useRef, useState } from 'react';
import { UserRound, X } from 'lucide-react';
import type { JiraUser } from '@shared/types';
import { call } from '../lib/api';
import { primeUsers } from '../hooks/useUsers';
import { Avatar, cx, Spinner } from './ui';

export function UserPicker({ value, valueUser, onChange, compact }: { value: string | null; valueUser: JiraUser | null; onChange: (u: JiraUser | null) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<JiraUser[] | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setResults(null);
    const t = window.setTimeout(() => {
      call<JiraUser[]>('jira.searchUsers', { query: q })
        .then((users) => {
          primeUsers(users);
          setResults(users);
        })
        .catch(() => setResults([]));
    }, 200);
    return () => window.clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cx('flex w-full items-center gap-1.5 rounded-md border border-[var(--sp-border)] bg-white text-left text-sm hover:bg-slate-50', compact ? 'h-7 px-1.5' : 'h-9 px-2')}
      >
        {value ? <Avatar user={valueUser} id={value} size={18} /> : <UserRound className="size-4 text-slate-400" />}
        <span className={cx('flex-1 truncate', !value && 'text-slate-500')}>{value ? (valueUser?.displayName ?? '…') : 'Unassigned'}</span>
        {value && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear assignee"
            onClick={(e) => (e.stopPropagation(), onChange(null))}
            onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), onChange(null))}
            className="rounded p-0.5 text-slate-400 hover:bg-black/5"
          >
            <X className="size-3" />
          </span>
        )}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-56 rounded-lg border border-[var(--sp-border)] bg-white p-1 shadow-xl">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people..." aria-label="Search people" className="mb-1 w-full rounded border border-[var(--sp-border)] px-2 py-1 text-sm" />
          <ul role="listbox" className="max-h-56 overflow-y-auto">
            {results === null ? (
              <li className="flex items-center gap-2 px-2 py-1.5 text-sm text-slate-500"><Spinner /> Searching...</li>
            ) : !results.length ? (
              <li className="px-2 py-1.5 text-sm text-slate-500">No assignable users found</li>
            ) : (
              results.map((u) => (
                <li key={u.accountId}>
                  <button type="button" role="option" aria-selected={u.accountId === value} onClick={() => (onChange(u), setOpen(false))} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50">
                    <Avatar user={u} id={u.accountId} size={20} /> {u.displayName}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
