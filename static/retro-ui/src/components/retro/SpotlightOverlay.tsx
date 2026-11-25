/** Spotlight / focus mode: the facilitator highlights one card or group on everyone's screen. */
import { useEffect, useState } from 'react';
import { ChevronRight, Layers, Spotlight, X } from 'lucide-react';
import { voteTargets } from '@shared/rules';
import type { CardView } from '@shared/types';
import { Markdown } from '../../lib/markdown';
import { Avatar, Button, Sticker } from '../ui';
import { CommentThread, Reactions, VoteControl } from './CardParts';
import { useRetro } from './RetroContext';

export function SpotlightOverlay() {
  const { s, isFac, run, user, openLink } = useRetro();
  const sp = s.board.facilitator.spotlight;
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  useEffect(() => setDismissedAt(null), [sp?.at]);
  if (!sp || dismissedAt === sp.at) return null;

  const group = sp.targetType === 'group' ? s.groups.find((g) => g.id === sp.targetId) : undefined;
  const cards: CardView[] = group ? s.cards.filter((c) => c.groupId === group.id) : s.cards.filter((c) => c.id === sp.targetId);
  if (!cards.length) return null;
  const column = s.board.columns.find((c) => c.id === (group?.columnId ?? cards[0]!.columnId));

  // "Next" walks vote targets in descending vote order (or board order when hidden).
  const totals = s.votes.totals ?? {};
  const ordered = [...voteTargets(s.cards, s.groups)].sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0));
  const idx = ordered.indexOf(sp.targetId);
  const nextId = ordered[(idx + 1) % ordered.length];
  const next = () => {
    if (!nextId) return;
    const type = s.groups.some((g) => g.id === nextId) ? 'group' : 'card';
    void run('facilitator.spotlight', { retroId: s.board.id, target: { type, id: nextId } });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Spotlight">
      <div className="sp-enter max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-[var(--sp-border)] px-5 py-3">
          <Spotlight className="size-4 text-amber-500" />
          <span className="text-sm font-semibold">Spotlight</span>
          {column && <span className="text-sm text-slate-500">· {column.emoji} {column.title}</span>}
          <div className="ml-auto flex items-center gap-2">
            <VoteControl targetId={sp.targetId} />
            {!isFac && <button type="button" aria-label="Hide spotlight for me" onClick={() => setDismissedAt(sp.at)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>}
          </div>
        </div>
        <div className="space-y-4 p-6">
          {group && <h2 className="flex items-center gap-2 text-2xl font-bold"><Layers className="size-6 text-slate-400" /> {group.title}</h2>}
          {cards.map((c) => (
            <div key={c.id} className={group ? 'rounded-lg border border-[var(--sp-border)] p-3' : ''}>
              {/* Spotlight is usually screen-shared: anonymous cards stay anonymous even for their author. */}
              <div className="mb-2 flex items-center gap-2 text-sm text-slate-500">
                <Avatar user={user(c.authorId)} id={c.authorId} anonymous={c.anonymous || !c.authorId} size={22} />
                {c.anonymous || !c.authorId ? 'Anonymous' : user(c.authorId)?.displayName}
              </div>
              <Markdown text={c.text} onLink={openLink} className={group ? 'text-base' : 'text-xl leading-relaxed'} />
              {c.gifId && <div className="mt-2 max-w-xs"><Sticker id={c.gifId} /></div>}
              <div className="mt-3"><Reactions card={c} /></div>
              <CommentThread card={c} />
            </div>
          ))}
        </div>
        {isFac && (
          <div className="flex justify-between border-t border-[var(--sp-border)] px-5 py-3">
            <Button onClick={() => run('facilitator.spotlight', { retroId: s.board.id, target: null })}>End spotlight</Button>
            {ordered.length > 1 && <Button variant="primary" onClick={next}>Next topic <ChevronRight className="size-4" /></Button>}
          </div>
        )}
      </div>
    </div>
  );
}
