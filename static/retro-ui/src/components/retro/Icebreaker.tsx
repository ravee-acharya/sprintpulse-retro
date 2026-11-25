/** Icebreaker phase: shared question card (random deck or custom) + mood overview. */
import { useState } from 'react';
import { Plus, Shuffle, Sparkles } from 'lucide-react';
import { MOODS } from '@shared/catalog';
import { Button } from '../ui';
import { useRetro } from './RetroContext';

export function IcebreakerPanel({ onCheckIn }: { onCheckIn: () => void }) {
  const { s, isFac, run } = useRetro();
  const ib = s.board.facilitator.icebreaker;
  const [custom, setCustom] = useState('');
  const retroId = s.board.id;
  const mine = MOODS.find((m) => m.key === s.mood.mine);

  return (
    <div className="mx-auto grid max-w-4xl gap-4 p-6 md:grid-cols-[1.6fr_1fr]">
      <div className="sp-enter rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 p-6 text-white shadow-lg">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white/80">
          <Sparkles className="size-4" /> Icebreaker
        </div>
        <p className="min-h-[4.5rem] text-2xl leading-snug font-semibold">
          {ib?.question ?? (isFac ? 'Draw a question to warm the team up.' : 'Waiting for the facilitator to draw a question...')}
        </p>
        {isFac && (
          <div className="mt-5 space-y-3">
            <Button variant="secondary" onClick={() => run('facilitator.icebreaker', { retroId, mode: 'random' })}>
              <Shuffle className="size-4" /> {ib ? 'Another question' : 'Draw a question'}
            </Button>
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const q = custom.trim();
                if (!q) return;
                const customQuestions = [...(ib?.customQuestions ?? []), q].slice(-50);
                if (await run('facilitator.icebreaker', { retroId, mode: 'custom', question: q, customQuestions })) setCustom('');
              }}
            >
              <input value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={300} placeholder="Ask your own question..." aria-label="Custom icebreaker question" className="flex-1 rounded-md border-0 bg-white/15 px-3 py-1.5 text-sm text-white placeholder:text-white/60 focus:bg-white/25 focus:outline-none" />
              <Button type="submit" variant="secondary" disabled={!custom.trim()}><Plus className="size-4" /> Ask</Button>
            </form>
            {!!ib?.customQuestions.length && <p className="text-xs text-white/70">{ib.customQuestions.length} custom question(s) added to the shuffle deck.</p>}
          </div>
        )}
      </div>
      <div className="rounded-2xl border border-[var(--sp-border)] bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold">Team vibe</h3>
        <MoodBars />
        <Button className="mt-4 w-full" onClick={onCheckIn}>
          {mine ? <>You're feeling {mine.emoji} {mine.label} - change</> : 'Check in with your mood'}
        </Button>
      </div>
    </div>
  );
}

export function MoodBars() {
  const { s } = useRetro();
  const max = Math.max(1, ...Object.values(s.mood.counts));
  return (
    <div className="space-y-1.5">
      {MOODS.map((m) => (
        <div key={m.key} className="flex items-center gap-2 text-sm">
          <span className="w-6 text-center">{m.emoji}</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${(s.mood.counts[m.key] / max) * 100}%` }} />
          </div>
          <span className="w-5 text-right text-xs text-slate-500 tabular-nums">{s.mood.counts[m.key]}</span>
        </div>
      ))}
      <p className="pt-1 text-xs text-slate-500">
        {s.mood.total} check-in{s.mood.total === 1 ? '' : 's'}
        {s.mood.average !== null && ` · average ${s.mood.average.toFixed(1)} / 5`}
      </p>
    </div>
  );
}
