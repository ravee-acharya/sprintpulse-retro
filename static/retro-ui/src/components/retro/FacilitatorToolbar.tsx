import { useState } from 'react';
import { Check, ChevronRight, Columns3, Eye, EyeOff, Flag, Lock, Settings2, UserX, Vote } from 'lucide-react';
import { PHASE_ORDER, type RetroPhase } from '@shared/types';
import { Button, cx, Popover, Toggle } from '../ui';
import { MusicControl } from './Music';
import { useRetro } from './RetroContext';
import { TimerWidget } from './Timer';
import { EditColumnsDialog } from './EditColumnsDialog';

export const PHASE_META: Record<RetroPhase, { label: string; hint: string; emoji: string }> = {
  icebreaker: { label: 'Icebreaker', hint: 'Warm up and check in with your mood.', emoji: '🧊' },
  brainstorm: { label: 'Brainstorm', hint: 'Add cards privately - nobody sees them until the facilitator reveals.', emoji: '💡' },
  group: { label: 'Group', hint: 'Drag related cards onto each other to stack them into themes.', emoji: '🧩' },
  vote: { label: 'Vote', hint: 'Spend your dots on what matters most.', emoji: '🗳️' },
  actions: { label: 'Actions', hint: 'Agree on action items for the top topics.', emoji: '✅' },
  closed: { label: 'Closed', hint: 'This retro is wrapped up.', emoji: '🏁' },
};

export function PhaseStepper() {
  const { s, isFac, run } = useRetro();
  const current = s.board.facilitator.phase;
  const ci = PHASE_ORDER.indexOf(current);
  const steps = PHASE_ORDER.filter((p) => p !== 'closed');
  return (
    <ol className="flex items-center gap-0.5 overflow-x-auto" aria-label="Retro phases">
      {steps.map((p, i) => {
        const done = i < ci;
        const active = p === current;
        return (
          <li key={p} className="flex items-center">
            <button
              type="button"
              disabled={!isFac || active || s.board.status !== 'active'}
              onClick={() => run('facilitator.setPhase', { retroId: s.board.id, phase: p })}
              aria-current={active ? 'step' : undefined}
              className={cx(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap transition',
                active ? 'bg-brand-500 text-white shadow' : done ? 'text-brand-700 hover:bg-brand-50' : 'text-slate-500 hover:bg-slate-100',
                (!isFac || s.board.status !== 'active') && !active && 'cursor-default hover:bg-transparent',
              )}
            >
              <span className={cx('grid size-4 place-items-center rounded-full text-[10px]', active ? 'bg-white/25' : done ? 'bg-brand-100' : 'bg-slate-200')}>
                {done ? <Check className="size-3" /> : i + 1}
              </span>
              {PHASE_META[p].label}
            </button>
            {i < steps.length - 1 && <ChevronRight className="size-3.5 shrink-0 text-slate-300" />}
          </li>
        );
      })}
    </ol>
  );
}

export function FacilitatorToolbar({ onCloseRetro }: { onCloseRetro: () => void }) {
  const { s, isFac, run } = useRetro();
  const f = s.board.facilitator;
  const settings = s.board.settings;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const retroId = s.board.id;
  const open = s.board.status === 'active';
  const next = PHASE_ORDER[PHASE_ORDER.indexOf(f.phase) + 1];

  const updateSettings = (patch: Record<string, unknown>) => run('retros.update', { retroId, settings: { ...settings, ...patch } });

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--sp-border)] bg-white/80 px-4 py-2 backdrop-blur">
      <PhaseStepper />
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <TimerWidget />
        {isFac && open && (
          <>
            {(f.phase === 'brainstorm' || f.phase === 'icebreaker') && (
              <Button onClick={() => run('facilitator.reveal', { retroId, revealed: !f.revealed })} className={cx(f.revealed && 'border-emerald-300 bg-emerald-50 text-emerald-700')}>
                {f.revealed ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                {f.revealed ? 'Revealed' : 'Reveal cards'}
              </Button>
            )}
            {f.phase === 'vote' && (
              <Button onClick={() => run('facilitator.closeVoting', { retroId, closed: !f.votingClosed })} className={cx(f.votingClosed && 'border-emerald-300 bg-emerald-50 text-emerald-700')}>
                {f.votingClosed ? <Check className="size-4" /> : <Lock className="size-4" />}
                {f.votingClosed ? 'Votes revealed' : 'End voting'}
              </Button>
            )}
          </>
        )}
        <MusicControl />
        {isFac && (
          <div className="relative">
            <Button variant="ghost" aria-label="Retro settings" onClick={() => setSettingsOpen((o) => !o)}>
              <Settings2 className="size-4" />
            </Button>
            <Popover open={settingsOpen} onClose={() => setSettingsOpen(false)} className="top-11 right-0 w-72 space-y-3">
              <div className="text-xs font-semibold text-slate-500">Privacy</div>
              <Toggle checked={settings.anonymousByDefault} onChange={(v) => updateSettings({ anonymousByDefault: v })} label={<span className="flex items-center gap-1"><UserX className="size-3.5" /> Anonymous by default</span>} />
              <Toggle checked={settings.allowAuthorToggleAnonymity} onChange={(v) => updateSettings({ allowAuthorToggleAnonymity: v })} label="Let authors choose per card" />
              <div className="border-t border-[var(--sp-border)] pt-3 text-xs font-semibold text-slate-500">Voting</div>
              <Toggle checked={settings.hideVotesUntilClosed} onChange={(v) => updateSettings({ hideVotesUntilClosed: v })} label="Private voting (hide totals)" />
              <label className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1"><Vote className="size-3.5" /> Votes per person</span>
                <select value={settings.voteLimit} onChange={(e) => updateSettings({ voteLimit: Number(e.target.value) })} className="rounded border border-[var(--sp-border)] px-1">
                  {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n}>{n}</option>)}
                </select>
              </label>
              <label className="flex items-center justify-between text-sm">
                Max per item
                <select value={settings.maxVotesPerTarget} onChange={(e) => updateSettings({ maxVotesPerTarget: Number(e.target.value) })} className="rounded border border-[var(--sp-border)] px-1">
                  {[1, 2, 3, 4, 5].filter((n) => n <= settings.voteLimit).map((n) => <option key={n}>{n}</option>)}
                </select>
              </label>
              {f.phase === 'vote' && (
                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => run('votes.reset', { retroId })}>Reset all votes</Button>
              )}
              <div className="flex gap-2 border-t border-[var(--sp-border)] pt-3">
                <Button size="sm" disabled={!open} onClick={() => (setSettingsOpen(false), setColumnsOpen(true))}><Columns3 className="size-3.5" /> Edit columns</Button>
                {open && <Button size="sm" variant="danger" onClick={() => (setSettingsOpen(false), onCloseRetro())}><Flag className="size-3.5" /> Close retro</Button>}
              </div>
            </Popover>
          </div>
        )}
        {isFac && open && next && next !== 'closed' && (
          <Button variant="primary" onClick={() => run('facilitator.setPhase', { retroId, phase: next })}>
            Next: {PHASE_META[next].label} <ChevronRight className="size-4" />
          </Button>
        )}
        {isFac && open && f.phase === 'actions' && (
          <Button variant="primary" onClick={onCloseRetro}><Flag className="size-4" /> Finish retro</Button>
        )}
      </div>
      <EditColumnsDialog open={columnsOpen} onClose={() => setColumnsOpen(false)} />
    </div>
  );
}
