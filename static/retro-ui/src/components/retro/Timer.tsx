/**
 * Shared countdown. The board stores only `endsAt` / `pausedRemainingSec`; every client
 * renders the countdown locally (corrected by the server clock offset), so there are no
 * per-second network ticks. The chime plays on every client when it reaches zero.
 */
import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Plus, RotateCcw, Timer as TimerIcon } from 'lucide-react';
import { playChime } from '../../lib/audio';
import { Button, cx, Popover } from '../ui';
import { useRetro } from './RetroContext';

export function useRemainingSeconds(): number | null {
  const { s, clockOffset } = useRetro();
  const t = s.board.facilitator.timer;
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  useEffect(() => {
    if (!t?.endsAt) return;
    const id = window.setInterval(() => setNow(Date.now() + clockOffset), 250);
    return () => window.clearInterval(id);
  }, [t?.endsAt, clockOffset]);
  if (!t) return null;
  if (t.pausedRemainingSec !== null) return t.pausedRemainingSec;
  return Math.max(0, Math.ceil(((t.endsAt ?? 0) - now) / 1000));
}

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const PRESETS = [60, 180, 300, 600];

export function TimerWidget() {
  const { s, isFac, run } = useRetro();
  const t = s.board.facilitator.timer;
  const remaining = useRemainingSeconds();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const chimedFor = useRef<number | null>(null);
  const running = !!t?.endsAt;

  // Chime once per timer run, only if this client watched it count down.
  const sawRunning = useRef(false);
  useEffect(() => {
    if (running && remaining !== null && remaining > 0) sawRunning.current = true;
    if (running && remaining === 0 && sawRunning.current && chimedFor.current !== t?.endsAt) {
      chimedFor.current = t?.endsAt ?? null;
      sawRunning.current = false;
      playChime();
    }
  }, [running, remaining, t?.endsAt]);

  const timer = (payload: Record<string, unknown>) => run('facilitator.timer', { retroId: s.board.id, ...payload });
  const urgent = remaining !== null && running && remaining <= 10;
  const done = remaining === 0 && running;

  return (
    <div className="relative flex items-center gap-1">
      <button
        type="button"
        disabled={!isFac}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'flex h-9 min-w-[5.5rem] items-center justify-center gap-1.5 rounded-md border px-2 font-mono text-sm tabular-nums transition',
          done ? 'animate-pulse border-red-300 bg-red-50 text-red-700' : urgent ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-[var(--sp-border)] bg-white',
          !isFac && 'cursor-default',
        )}
        aria-label="Timer"
      >
        <TimerIcon className="size-4" />
        {remaining === null ? (isFac ? 'Timer' : '--:--') : done ? "Time's up" : fmt(remaining)}
      </button>
      {isFac && t && (
        <>
          {running ? (
            <Button size="sm" variant="ghost" aria-label="Pause timer" onClick={() => timer({ op: 'pause' })}><Pause className="size-3.5" /></Button>
          ) : t.pausedRemainingSec !== null ? (
            <Button size="sm" variant="ghost" aria-label="Resume timer" onClick={() => timer({ op: 'resume' })}><Play className="size-3.5" /></Button>
          ) : null}
          <Button size="sm" variant="ghost" aria-label="Add one minute" onClick={() => timer({ op: 'add', seconds: 60 })}><Plus className="size-3.5" />1m</Button>
          <Button size="sm" variant="ghost" aria-label="Reset timer" onClick={() => timer({ op: 'reset' })}><RotateCcw className="size-3.5" /></Button>
        </>
      )}
      <Popover open={open} onClose={() => setOpen(false)} className="top-11 left-0 w-56">
        <div className="mb-2 text-xs font-semibold text-slate-500">Start a timer for everyone</div>
        <div className="grid grid-cols-4 gap-1">
          {PRESETS.map((p) => (
            <Button key={p} size="sm" onClick={() => (setOpen(false), timer({ op: 'start', durationSec: p }))}>
              {p / 60}m
            </Button>
          ))}
        </div>
        <form
          className="mt-2 flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const mins = Number(custom);
            if (mins > 0 && mins <= 60) {
              setOpen(false);
              void timer({ op: 'start', durationSec: Math.round(mins * 60) });
            }
          }}
        >
          <input value={custom} onChange={(e) => setCustom(e.target.value)} inputMode="decimal" placeholder="Minutes" aria-label="Custom minutes" className="w-full rounded border border-[var(--sp-border)] px-2 text-sm" />
          <Button size="sm" variant="primary" type="submit">Go</Button>
        </form>
      </Popover>
    </div>
  );
}
