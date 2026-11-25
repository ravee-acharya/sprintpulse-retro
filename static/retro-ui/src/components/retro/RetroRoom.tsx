import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Columns3, Download, LayoutPanelTop, ListTodo, Radio, RefreshCw, WifiOff } from 'lucide-react';
import { MOODS } from '@shared/catalog';
import type { CardView, RetroBoard } from '@shared/types';
import { useRetroSync } from '../../hooks/useRetroSync';
import { usePresence } from '../../hooks/usePresence';
import { useUsers } from '../../hooks/useUsers';
import { call, openUrl, RpcError } from '../../lib/api';
import { useToast } from '../toast';
import { Avatar, Button, cx, Modal, Spinner } from '../ui';
import { ActionItemsDrawer, type ActionPrefill } from './ActionItems';
import { Board } from './Board';
import { ExportDialog } from './ExportDialog';
import { FacilitatorToolbar, PHASE_META } from './FacilitatorToolbar';
import { IcebreakerPanel } from './Icebreaker';
import { MoodCheckin } from './MoodCheckin';
import { RetroContext, useRetro, type RetroCtx } from './RetroContext';
import { SpotlightOverlay } from './SpotlightOverlay';

const VIEW_KEY = 'sprintpulse-view-mode';

export function RetroRoom({ retroId, me, siteUrl, onBack }: { retroId: string; me: string; siteUrl: string | null; onBack: () => void }) {
  const toast = useToast();
  const { snapshot: s, status, error, clockOffset, refresh, applyMine, removeCard, patch } = useRetroSync(retroId, me);
  const online = usePresence(retroId, me);
  const [moodOpen, setMoodOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [prefill, setPrefill] = useState<ActionPrefill | null>(null);
  const lastPhase = useRef<string | null>(null);
  const [viewMode, setViewMode] = useState<'board' | 'focus' | null>(() => {
    try {
      return (localStorage.getItem(VIEW_KEY) as 'board' | 'focus' | null) ?? null;
    } catch {
      return null;
    }
  });
  const promptedMood = useRef(false);

  const ids = useMemo(() => {
    if (!s) return [];
    const out: Array<string | null> = [...online, ...s.board.facilitatorIds];
    for (const c of s.cards) {
      out.push(c.authorId);
      for (const cm of c.comments) out.push(cm.authorId);
      for (const who of Object.values(c.reactions)) out.push(...who);
    }
    for (const a of s.actions) out.push(a.createdBy, a.assigneeAccountId);
    return out;
  }, [s, online]);
  const user = useUsers(ids);

  // Ask for a mood check-in once, on joining an open retro.
  useEffect(() => {
    if (s && !promptedMood.current && s.board.status === 'active' && !s.mood.mine) {
      promptedMood.current = true;
      setMoodOpen(true);
    }
  }, [s]);

  // The drawer docks open automatically when the facilitator moves to the Actions phase.
  const phase = s?.board.facilitator.phase ?? null;
  useEffect(() => {
    if (phase === 'actions' && lastPhase.current && lastPhase.current !== 'actions') setActionsOpen(true);
    if (phase && lastPhase.current === null && phase === 'actions') setActionsOpen(true);
    lastPhase.current = phase;
  }, [phase]);

  const openActions = useCallback((p?: ActionPrefill) => {
    setPrefill(p ?? null);
    setActionsOpen(true);
  }, []);

  const run = useCallback(
    async <T,>(fn: string, payload?: Record<string, unknown>): Promise<T | null> => {
      try {
        return await call<T>(fn, payload);
      } catch (e) {
        toast('error', e instanceof RpcError ? e.message : 'Something went wrong');
        if (e instanceof RpcError && (e.code === 'CONFLICT' || e.code === 'PHASE' || e.code === 'NOT_FOUND')) void refresh();
        return null;
      }
    },
    [toast, refresh],
  );

  const runCard = useCallback(
    async (fn: string, payload: Record<string, unknown>) => {
      const card = await run<CardView>(fn, payload);
      if (card) applyMine(card);
      return card;
    },
    [run, applyMine],
  );

  const openLink = useCallback((url: string) => void openUrl(url, siteUrl), [siteUrl]);

  if (!s) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-slate-500">
        {status === 'error' ? (
          <div className="text-center">
            <p className="mb-3 text-red-600">{error}</p>
            <Button onClick={onBack}><ArrowLeft className="size-4" /> Back to retros</Button>
          </div>
        ) : (
          <>
            <Spinner /> Loading retro...
          </>
        )}
      </div>
    );
  }

  const mode = viewMode ?? s.board.settings.defaultViewMode;
  const f = s.board.facilitator;
  const ctx: RetroCtx = { s, me, isFac: s.viewer.isFacilitator, user, run, runCard, removeCard, patch, refresh, clockOffset, openLink, viewMode: mode, openActions };
  const setMode = (m: 'board' | 'focus') => {
    setViewMode(m);
    try {
      localStorage.setItem(VIEW_KEY, m);
    } catch {
      /* ignore */
    }
  };
  const avgMood = s.mood.average !== null ? MOODS.reduce((best, m) => (Math.abs(m.score - s.mood.average!) < Math.abs(best.score - s.mood.average!) ? m : best)) : null;

  return (
    <RetroContext.Provider value={ctx}>
      <div className={cx('sp-theme flex h-full flex-col', `sp-theme-${s.board.theme}`)}>
        <header className="flex flex-wrap items-center gap-3 border-b border-[var(--sp-border)] bg-white/90 px-4 py-2 backdrop-blur">
          <Button variant="ghost" size="sm" aria-label="Back to retros" onClick={onBack}><ArrowLeft className="size-4" /></Button>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{s.board.title}</h1>
            <p className="text-xs text-slate-500">
              {PHASE_META[f.phase].emoji} {PHASE_META[f.phase].label}
              {s.board.sprint && ` · ${s.board.sprint.name}`}
              {s.board.status !== 'active' && ` · ${s.board.status}`}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <button type="button" onClick={() => setMoodOpen(true)} className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200" title="Team mood">
              {avgMood ? avgMood.emoji : '🙂'} <span className="tabular-nums">{s.mood.total}</span>
            </button>
            <div className="flex -space-x-1.5" aria-label={`${online.length} online`}>
              {online.slice(0, 6).map((id) => (
                <span key={id} className="rounded-full ring-2 ring-white"><Avatar user={user(id)} id={id} size={26} /></span>
              ))}
              {online.length > 6 && <span className="grid size-[26px] place-items-center rounded-full bg-slate-200 text-[10px] ring-2 ring-white">+{online.length - 6}</span>}
            </div>
            <SyncBadge status={status} onRetry={refresh} />
            <Button size="sm" onClick={() => setExportOpen(true)} aria-label="Export retro"><Download className="size-3.5" /> Export</Button>
            <Button size="sm" onClick={() => (actionsOpen ? setActionsOpen(false) : openActions())} aria-pressed={actionsOpen} className={cx(actionsOpen && 'border-brand-300 bg-brand-50 text-brand-700')}>
              <ListTodo className="size-3.5" /> Actions <span className="tabular-nums">{s.actions.length}</span>
            </Button>
            <div className="flex rounded-md border border-[var(--sp-border)] bg-white p-0.5" role="group" aria-label="View mode">
              <button type="button" aria-pressed={mode === 'board'} title="Column board" onClick={() => setMode('board')} className={cx('rounded p-1', mode === 'board' ? 'bg-brand-50 text-brand-700' : 'text-slate-500')}><Columns3 className="size-4" /></button>
              <button type="button" aria-pressed={mode === 'focus'} title="Focus view (one column at a time)" onClick={() => setMode('focus')} className={cx('rounded p-1', mode === 'focus' ? 'bg-brand-50 text-brand-700' : 'text-slate-500')}><LayoutPanelTop className="size-4" /></button>
            </div>
          </div>
        </header>

        <FacilitatorToolbar onCloseRetro={() => setCloseOpen(true)} />
        <PhaseHint />

        <div className="flex min-h-0 flex-1">
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
            {f.phase === 'icebreaker' ? <IcebreakerPanel onCheckIn={() => setMoodOpen(true)} /> : <Board />}
          </main>
          <ActionItemsDrawer open={actionsOpen} onClose={() => setActionsOpen(false)} prefill={prefill} onPrefillUsed={() => setPrefill(null)} />
        </div>

        <SpotlightOverlay />
        <MoodCheckin key={String(moodOpen)} open={moodOpen} onClose={() => setMoodOpen(false)} />
        <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} siteUrl={siteUrl} />
        <CloseRetroDialog
          open={closeOpen}
          onClose={() => setCloseOpen(false)}
          onClosed={(b) => {
            setCloseOpen(false);
            patch({ board: b });
            toast('success', 'Retro closed - summary saved');
          }}
        />
      </div>
    </RetroContext.Provider>
  );
}

function PhaseHint() {
  const { s, isFac } = useRetro();
  const f = s.board.facilitator;
  if (s.board.status !== 'active') return <div className="bg-slate-800 px-4 py-1.5 text-center text-xs text-white">This retrospective is {s.board.status}. It's read-only.</div>;
  let text = PHASE_META[f.phase].hint;
  if (f.phase === 'brainstorm' && f.revealed) text = 'Cards are revealed. Keep adding thoughts, react and comment.';
  if (f.phase === 'vote') text = f.votingClosed ? 'Voting has ended - results are in.' : `You have ${s.votes.myRemaining} of ${s.votes.limit} votes left (max ${s.votes.maxPerTarget} per item). ${s.votes.hidden ? 'Totals stay hidden until voting ends.' : ''}`;
  if (f.phase === 'actions') text = 'Discuss the top items and capture action items - push them to Jira from the Actions drawer.';
  return (
    <div className="flex items-center justify-center gap-2 bg-brand-50/90 px-4 py-1.5 text-center text-xs text-brand-700">
      <span>{text}</span>
      {f.phase === 'vote' && !f.votingClosed && <span className="font-medium">· {s.votes.votersCount} voted so far</span>}
      {isFac && f.phase === 'brainstorm' && !f.revealed && <span className="font-medium">· {s.cards.length} cards so far</span>}
    </div>
  );
}

function SyncBadge({ status, onRetry }: { status: string; onRetry: () => void }) {
  if (status === 'live') return <span className="flex items-center gap-1 text-xs text-emerald-600" title="Connected via Forge Realtime"><Radio className="size-3.5" /> Live</span>;
  if (status === 'polling') {
    return (
      <button type="button" onClick={onRetry} className="flex items-center gap-1 text-xs text-amber-600" title="Realtime unavailable - refreshing every few seconds">
        <WifiOff className="size-3.5" /> Polling <RefreshCw className="size-3" />
      </button>
    );
  }
  return null;
}

function CloseRetroDialog({ open, onClose, onClosed }: { open: boolean; onClose: () => void; onClosed: (b: RetroBoard) => void }) {
  const { s, run } = useRetro();
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Close this retrospective?"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const b = await run<RetroBoard>('retros.close', { retroId: s.board.id });
              setBusy(false);
              if (b) onClosed(b);
            }}
          >
            {busy && <Spinner />} Close retro
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        Closing stops the timer and music, makes the board read-only, and saves a summary (mood, participation, recurring topics) for team analytics. Action items stay open and keep syncing with Jira. You can reopen it later.
      </p>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-lg bg-slate-50 p-2"><dt className="text-xs text-slate-500">Cards</dt><dd className="text-lg font-semibold">{s.cards.length}</dd></div>
        <div className="rounded-lg bg-slate-50 p-2"><dt className="text-xs text-slate-500">Check-ins</dt><dd className="text-lg font-semibold">{s.mood.total}</dd></div>
        <div className="rounded-lg bg-slate-50 p-2"><dt className="text-xs text-slate-500">Actions</dt><dd className="text-lg font-semibold">{s.actions.length}</dd></div>
      </dl>
    </Modal>
  );
}
