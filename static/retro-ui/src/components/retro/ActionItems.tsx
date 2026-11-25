/**
 * Action Items drawer: capture actions, assign them (Jira assignable users), push them to
 * Jira in one click, and keep key / status / assignee synced back from Jira.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, CheckSquare, ListTodo, Plus, RefreshCw, Square, Trash2, X } from 'lucide-react';
import type { ActionItem, JiraIssueType, SprintRef } from '@shared/types';
import { call } from '../../lib/api';
import { JiraBadge } from '../JiraBadge';
import { UserPicker } from '../UserPicker';
import { Button, cx, Spinner } from '../ui';
import { useRetro } from './RetroContext';

export interface ActionPrefill {
  title: string;
  sourceCardId: string | null;
}

/* Issue types / sprints are per project and rarely change: cache for the session. */
let issueTypesCache: Promise<JiraIssueType[]> | null = null;
let sprintsCache: Promise<SprintRef[]> | null = null;
const issueTypes = () =>
  (issueTypesCache ??= call<JiraIssueType[]>('jira.issueTypes').catch((e: unknown) => {
    issueTypesCache = null; // allow a retry after a failure
    throw e instanceof Error ? e : new Error(String(e));
  }));
const sprints = () => (sprintsCache ??= call<SprintRef[]>('jira.sprints').catch(() => []));

export function ActionItemsDrawer({ open, onClose, prefill, onPrefillUsed }: { open: boolean; onClose: () => void; prefill: ActionPrefill | null; onPrefillUsed: () => void }) {
  const { s, run, patch } = useRetro();
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const actionsRef = useRef(s.actions);
  actionsRef.current = s.actions;

  const sync = useCallback(async () => {
    if (!actionsRef.current.some((a) => a.jira)) return;
    setSyncing(true);
    const fresh = await run<ActionItem[]>('actions.sync', { retroId: s.board.id });
    setSyncing(false);
    if (fresh) {
      patch({ actions: fresh.filter((a) => a.retroId === s.board.id) });
      setLastSync(Date.now());
    }
  }, [run, patch, s.board.id]);

  // Pull live Jira status when the drawer opens and every minute while it stays open.
  useEffect(() => {
    if (!open) return;
    void sync();
    const id = window.setInterval(() => void sync(), 60_000);
    return () => window.clearInterval(id);
  }, [open, sync]);

  if (!open) return null;
  const sorted = [...s.actions].sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || a.createdAt - b.createdAt);
  const done = s.actions.filter((a) => a.status === 'done').length;

  return (
    <aside aria-label="Action items" className="sp-enter flex w-[min(400px,100vw)] shrink-0 flex-col border-l border-[var(--sp-border)] bg-white shadow-xl">
      <header className="flex items-center gap-2 border-b border-[var(--sp-border)] px-4 py-3">
        <ListTodo className="size-4 text-brand-600" />
        <h2 className="font-semibold">Action items</h2>
        <span className="text-xs text-slate-500 tabular-nums">{done}/{s.actions.length} done</span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={sync} disabled={syncing || !s.actions.some((a) => a.jira)} title={lastSync ? `Synced ${new Date(lastSync).toLocaleTimeString()}` : 'Sync status from Jira'}>
            <RefreshCw className={cx('size-3.5', syncing && 'animate-spin')} /> Sync
          </Button>
          <button type="button" aria-label="Close action items" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-4" /></button>
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {s.board.status !== 'archived' && <NewAction key={prefill ? `p-${prefill.sourceCardId}` : 'blank'} prefill={prefill} onUsed={onPrefillUsed} />}
        {!sorted.length && <p className="px-1 py-6 text-center text-sm text-slate-500">No action items yet. Capture what the team commits to - you can push each one to Jira.</p>}
        {sorted.map((a) => <ActionRow key={a.id} action={a} />)}
      </div>
    </aside>
  );
}

function NewAction({ prefill, onUsed }: { prefill: ActionPrefill | null; onUsed: () => void }) {
  const { s, run, patch, user } = useRetro();
  const [title, setTitle] = useState(prefill?.title ?? '');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [due, setDue] = useState('');
  const [expanded, setExpanded] = useState(!!prefill);
  const [busy, setBusy] = useState(false);
  const source = prefill?.sourceCardId ? s.cards.find((c) => c.id === prefill.sourceCardId) : null;

  async function add() {
    const t = title.trim();
    if (!t) return;
    setBusy(true);
    const a = await run<ActionItem>('actions.create', {
      retroId: s.board.id,
      title: t,
      description: source?.text ? `From retro card: ${source.text}` : '',
      assigneeAccountId: assignee,
      sourceCardId: prefill?.sourceCardId ?? null,
      dueDate: due || null,
    });
    setBusy(false);
    if (a) {
      patch({ actions: [...s.actions.filter((x) => x.id !== a.id), a] });
      setTitle('');
      setAssignee(null);
      setDue('');
      setExpanded(false);
      onUsed();
    }
  }

  return (
    <form
      className={cx('rounded-lg border p-2', expanded ? 'border-brand-300 ring-2 ring-brand-100' : 'border-dashed border-slate-300')}
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <div className="flex items-center gap-2">
        <Plus className="size-4 shrink-0 text-slate-400" />
        <input
          value={title}
          autoFocus={!!prefill}
          onFocus={() => setExpanded(true)}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={255}
          placeholder="Add an action item..."
          aria-label="New action item"
          className="min-w-0 flex-1 border-0 bg-transparent text-sm focus:outline-none"
        />
      </div>
      {expanded && (
        <div className="mt-2 space-y-2 pl-6">
          {source && <p className="line-clamp-2 rounded bg-slate-50 px-2 py-1 text-xs text-slate-500">From card: {source.text.replace(/[*_`~>]/g, '')}</p>}
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <UserPicker value={assignee} valueUser={user(assignee)} onChange={(u) => setAssignee(u?.accountId ?? null)} compact />
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" className="h-7 rounded-md border border-[var(--sp-border)] px-1.5 text-xs" />
          </div>
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => (setExpanded(false), setTitle(''), onUsed())}>Cancel</Button>
            <Button size="sm" variant="primary" type="submit" disabled={!title.trim() || busy}>{busy && <Spinner />} Add action</Button>
          </div>
        </div>
      )}
    </form>
  );
}

function ActionRow({ action: a }: { action: ActionItem }) {
  const { s, run, patch, user, openLink } = useRetro();
  const [pushing, setPushing] = useState(false);
  const [types, setTypes] = useState<JiraIssueType[] | null>(null);
  const [sprintList, setSprintList] = useState<SprintRef[]>([]);
  const [typeId, setTypeId] = useState('');
  const [sprintId, setSprintId] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(a.title);

  const replace = (next: ActionItem) => patch({ actions: s.actions.map((x) => (x.id === next.id ? next : x)) });
  const update = async (fields: Record<string, unknown>) => {
    const next = await run<ActionItem>('actions.update', { actionId: a.id, ...fields });
    if (next) replace(next);
  };

  async function startPush() {
    setPushing(true);
    try {
      const [t, sp] = await Promise.all([issueTypes(), sprints()]);
      setTypes(t);
      setTypeId(t.find((x) => x.name === 'Task')?.id ?? t[0]?.id ?? '');
      setSprintList(sp.filter((x) => x.state !== 'closed'));
    } catch {
      setPushing(false);
      void run('jira.issueTypes'); // surfaces the error toast
    }
  }

  async function push() {
    setBusy(true);
    const next = await run<ActionItem>('actions.createIssue', { actionId: a.id, issueTypeId: typeId, sprintId: sprintId || null });
    setBusy(false);
    if (next) {
      replace(next);
      setPushing(false);
    }
  }

  const done = a.status === 'done';
  return (
    <div className={cx('rounded-lg border border-[var(--sp-border)] p-2.5 transition', done && 'bg-slate-50')}>
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label={done ? 'Mark as open' : 'Mark as done'}
          disabled={!!a.jira}
          title={a.jira ? 'Status follows the Jira issue' : undefined}
          onClick={() => update({ status: done ? 'open' : 'done' })}
          className="mt-0.5 text-slate-400 hover:text-brand-600 disabled:cursor-default disabled:hover:text-slate-400"
        >
          {done ? <CheckSquare className="size-4 text-emerald-600" /> : <Square className="size-4" />}
        </button>
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <input
              autoFocus
              value={title}
              maxLength={255}
              aria-label="Action title"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                setEditingTitle(false);
                if (title.trim() && title.trim() !== a.title) void update({ title: title.trim() });
                else setTitle(a.title);
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="w-full rounded border border-[var(--sp-border)] px-1 text-sm"
            />
          ) : (
            <button type="button" onClick={() => setEditingTitle(true)} className={cx('text-left text-sm', done && 'text-slate-500 line-through')}>{a.title}</button>
          )}
          <div className="mt-1.5 grid grid-cols-[1fr_auto] items-center gap-2">
            <UserPicker value={a.assigneeAccountId} valueUser={user(a.assigneeAccountId)} onChange={(u) => update({ assigneeAccountId: u?.accountId ?? null })} compact />
            <label className="flex items-center gap-1 text-xs text-slate-500">
              <CalendarDays className="size-3.5" />
              <input type="date" value={a.dueDate ?? ''} onChange={(e) => update({ dueDate: e.target.value || null })} aria-label="Due date" className="h-7 rounded border border-[var(--sp-border)] px-1" />
            </label>
          </div>
          <div className="mt-2 flex items-center gap-2">
            {a.jira ? (
              <JiraBadge jira={a.jira} onOpen={() => openLink(a.jira!.url)} />
            ) : !pushing ? (
              <Button size="sm" onClick={startPush}>
                <img alt="" aria-hidden className="size-3.5" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%232684FF' d='M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 0 0-.84-.84H11.53z'/%3E%3Cpath fill='%232684FF' d='M6.77 6.8a4.36 4.36 0 0 0 4.34 4.34h1.8v1.72a4.36 4.36 0 0 0 4.34 4.34V7.63a.84.84 0 0 0-.83-.83H6.77z'/%3E%3Cpath fill='%232684FF' d='M2 11.6c0 2.4 1.95 4.34 4.35 4.34h1.78v1.72c0 2.39 1.94 4.33 4.34 4.34v-9.57a.84.84 0 0 0-.84-.84H2z'/%3E%3C/svg%3E" />
                Create Jira issue
              </Button>
            ) : null}
            <button type="button" aria-label="Delete action" onClick={async () => (await run('actions.delete', { actionId: a.id })) && patch({ actions: s.actions.filter((x) => x.id !== a.id) })} className="ml-auto rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600">
              <Trash2 className="size-3.5" />
            </button>
          </div>
          {pushing && !a.jira && (
            <div className="mt-2 space-y-2 rounded-md bg-slate-50 p-2">
              {types === null ? (
                <span className="flex items-center gap-2 text-xs text-slate-500"><Spinner /> Loading issue types...</span>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-slate-600">
                      Type
                      <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className="mt-0.5 w-full rounded border border-[var(--sp-border)] bg-white px-1 py-1 text-sm">
                        {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-slate-600">
                      Add to
                      <select value={sprintId} onChange={(e) => setSprintId(e.target.value ? Number(e.target.value) : '')} className="mt-0.5 w-full rounded border border-[var(--sp-border)] bg-white px-1 py-1 text-sm">
                        <option value="">Backlog</option>
                        {sprintList.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}{sp.state === 'active' ? ' (active)' : ''}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setPushing(false)}>Cancel</Button>
                    <Button size="sm" variant="primary" disabled={!typeId || busy} onClick={push}>{busy && <Spinner />} Create in {s.board.projectKey}</Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
