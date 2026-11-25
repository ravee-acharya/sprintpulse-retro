/** Mood / vibe check-in shown when a participant joins (and on demand). */
import { useState } from 'react';
import { GIF_PACK, MOODS } from '@shared/catalog';
import type { MoodKey, MoodSummary } from '@shared/types';
import { Button, cx, Modal, Sticker } from '../ui';
import { useRetro } from './RetroContext';

export function MoodCheckin({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { s, run, patch } = useRetro();
  const [mood, setMood] = useState<MoodKey | null>(s.mood.mine);
  const [gif, setGif] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!mood) return;
    setBusy(true);
    const res = await run<MoodSummary>('mood.set', { retroId: s.board.id, mood, gifId: gif, note: '' });
    setBusy(false);
    if (res) {
      patch({ mood: res });
      onClose();
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="How are you feeling about this sprint?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Skip</Button>
          <Button variant="primary" disabled={!mood || busy} onClick={submit}>Check in</Button>
        </>
      }
    >
      <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Mood">
        {MOODS.map((m) => (
          <button
            key={m.key}
            type="button"
            role="radio"
            aria-checked={mood === m.key}
            aria-label={m.label}
            onClick={() => setMood(m.key)}
            className={cx('flex flex-col items-center gap-1 rounded-xl border p-3 transition', mood === m.key ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100' : 'border-[var(--sp-border)] hover:bg-slate-50')}
          >
            <span className={cx('text-3xl', mood === m.key && 'sp-anim-pop')}>{m.emoji}</span>
            <span className="text-xs font-medium">{m.label}</span>
          </button>
        ))}
      </div>
      <div className="mt-4">
        <div className="mb-2 text-xs font-semibold text-slate-500">Add a reaction GIF (optional)</div>
        <div className="grid grid-cols-6 gap-1.5">
          {GIF_PACK.map((g) => (
            <button key={g.id} type="button" aria-label={g.label} aria-pressed={gif === g.id} onClick={() => setGif(gif === g.id ? null : g.id)} className={cx('rounded-lg', gif === g.id && 'ring-2 ring-brand-500')}>
              <Sticker id={g.id} size="sm" />
            </button>
          ))}
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">Moods are shown to the team as totals only.</p>
    </Modal>
  );
}
