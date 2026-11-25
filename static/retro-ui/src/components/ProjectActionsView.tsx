/** Every retro action item in this project, with live Jira status. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ActionItem, RetroListItem } from '@shared/types';
import { call, openUrl } from '../lib/api';
import { useUsers } from '../hooks/useUsers';
import { JiraBadge } from './JiraBadge';
import { useToast } from './toast';
import { Avatar, Button, cx, Spinner } from './ui';

export function ProjectActionsView({ siteUrl, onOpenRetro }: { siteUrl: string | null; onOpenRetro: (id: string) => void }) {
  const toast = useToast();
  const [actions, setActions] = useState<ActionItem[] | null>(null);
  const [retros, setRetros] = useState<Map<string, string>>(new Map());
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');
  const [syncing, setSyncing] = useState(false);
  const user = useUsers(useMemo(() => (actions ?? []).map((a) => a.assigneeAccountId), [actions]));

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      setActions(await call<ActionItem[]>('actions.sync', {}));
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setSyncing(false);
    }
  }, [toast]);

  useEffect(() => {
    void sync();
    call<{ items: RetroListItem[] }>('retros.list', { status: 'all', limit: 100 })
      .then((r) => setRetros(new Map(r.items.map((i) => [i.id, i.title]))))
      .catch(() => undefined);
  }, [sync]);

  const shown = (actions ?? []).filter((a) => filter === 'all' || a.status === filter).sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || b.createdAt - a.createdAt);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="text-lg font-semibold">Action items</h2>
          <p className="text-sm text-[var(--sp-text-subtle)]">Commitments from every retro in this project. Linked issues sync their status and assignee from Jira.</p>
        </div>
        <div className="flex rounded-md border border-[var(--sp-border)] p-0.5" role="group" aria-label="Status filter">
          {(['open', 'done', 'all'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={cx('rounded px-2.5 py-1 text-xs font-medium capitalize', filter === f ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50')}>{f}</button>
          ))}
        </div>
        <Button onClick={sync} disabled={syncing}><RefreshCw className={cx('size-4', syncing && 'animate-spin')} /> Sync from Jira</Button>
      </div>
      {actions === null ? (
        <div className="flex items-center gap-2 text-slate-500"><Spinner /> Loading actions...</div>
      ) : !shown.length ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">{filter === 'open' ? 'No open action items - nice follow-through!' : 'No action items yet.'}</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--sp-border)] bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-2 py-2 font-medium">Assignee</th>
                <th className="px-2 py-2 font-medium">Jira</th>
                <th className="px-2 py-2 font-medium">Due</th>
                <th className="px-2 py-2 font-medium">From retro</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => {
                const overdue = a.status === 'open' && a.dueDate !== null && a.dueDate < today;
                return (
                  <tr key={a.id} className="border-t border-[var(--sp-border)]">
                    <td className={cx('px-4 py-2.5', a.status === 'done' && 'text-slate-500 line-through')}>{a.title}</td>
                    <td className="px-2">
                      {a.assigneeAccountId ? (
                        <span className="flex items-center gap-1.5"><Avatar user={user(a.assigneeAccountId)} id={a.assigneeAccountId} size={20} />{user(a.assigneeAccountId)?.displayName ?? '…'}</span>
                      ) : (
                        <span className="text-slate-400">Unassigned</span>
                      )}
                    </td>
                    <td className="px-2">{a.jira ? <JiraBadge jira={a.jira} onOpen={() => void openUrl(a.jira!.url, siteUrl)} /> : <span className="text-xs text-slate-400">Not in Jira</span>}</td>
                    <td className={cx('px-2 text-xs tabular-nums', overdue ? 'font-semibold text-red-700' : 'text-slate-600')}>{a.dueDate ?? '-'}{overdue && ' (overdue)'}</td>
                    <td className="px-2 text-xs">
                      <button type="button" onClick={() => onOpenRetro(a.retroId)} className="text-brand-700 hover:underline">{retros.get(a.retroId) ?? 'Open retro'}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
