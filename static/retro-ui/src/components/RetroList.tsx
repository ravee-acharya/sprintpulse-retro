/** Retro hub: active and recent retros for this project. (Full searchable history: Stage 4.) */
import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Plus, Users } from 'lucide-react';
import { projectChannel } from '@shared/events';
import type { RetroBoard, RetroListItem } from '@shared/types';
import { call, subscribe } from '../lib/api';
import { CreateRetroDialog } from './CreateRetroDialog';
import { useToast } from './toast';
import { Button, cx, Spinner } from './ui';

const PHASE_LABEL: Record<string, string> = { icebreaker: 'Icebreaker', brainstorm: 'Brainstorm', group: 'Group', vote: 'Vote', actions: 'Actions', closed: 'Closed' };

export function RetroList({ projectId, onOpen }: { projectId: string | null; onOpen: (id: string) => void }) {
  const toast = useToast();
  const [items, setItems] = useState<RetroListItem[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    call<{ items: RetroListItem[] }>('retros.list', { status: 'all', limit: 30 })
      .then((r) => setItems(r.items.filter((i) => i.status !== 'archived')))
      .catch((e) => toast('error', e.message));
  }, [toast]);

  useEffect(() => {
    load();
    if (!projectId) return;
    let sub: { unsubscribe(): void } | null = null;
    let alive = true;
    void subscribe(projectChannel(projectId), null, () => load()).then((s) => (alive ? (sub = s) : s?.unsubscribe()));
    return () => {
      alive = false;
      sub?.unsubscribe();
    };
  }, [load, projectId]);

  const active = items?.filter((i) => i.status === 'active') ?? [];
  const closed = items?.filter((i) => i.status === 'closed') ?? [];

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Retrospectives</h2>
          <p className="text-sm text-[var(--sp-text-subtle)]">Run a retro for your latest sprint, then push action items straight to Jira.</p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> New retro
        </Button>
      </div>

      {items === null ? (
        <div className="flex items-center gap-2 text-slate-500"><Spinner /> Loading retros...</div>
      ) : !items.length ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center">
          <div className="mb-2 text-4xl">🌀</div>
          <h3 className="font-semibold">No retrospectives yet</h3>
          <p className="mb-4 text-sm text-slate-500">Create your first retro - SprintPulse names it after your sprint automatically.</p>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New retro
          </Button>
        </div>
      ) : (
        <>
          <Section title="In progress" items={active} onOpen={onOpen} empty="No retros in progress." />
          <Section title="Recently closed" items={closed} onOpen={onOpen} empty="Nothing closed yet." />
        </>
      )}

      <CreateRetroDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(b: RetroBoard) => {
          setCreating(false);
          onOpen(b.id);
        }}
      />
    </div>
  );
}

function Section({ title, items, onOpen, empty }: { title: string; items: RetroListItem[]; onOpen: (id: string) => void; empty: string }) {
  return (
    <section className="mb-8">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h3>
      {!items.length ? (
        <p className="text-sm text-slate-400">{empty}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((r) => (
            <button key={r.id} type="button" onClick={() => onOpen(r.id)} className="group rounded-xl border border-[var(--sp-border)] bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-semibold group-hover:text-brand-600">{r.title}</h4>
                <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', r.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600')}>
                  {PHASE_LABEL[r.phase]}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                <span className="flex items-center gap-1"><CalendarDays className="size-3.5" />{new Date(r.createdAt).toLocaleDateString()}</span>
                {r.sprintName && <span>{r.sprintName}</span>}
                {r.summary && <span className="flex items-center gap-1"><Users className="size-3.5" />{r.summary.participantCount}</span>}
                {r.summary && <span>{r.summary.cardCount} cards · {r.summary.actionCount} actions</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
