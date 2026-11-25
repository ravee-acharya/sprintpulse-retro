/** Reactions, votes and comments - the interactive bits attached to cards and groups. */
import { useState } from 'react';
import { Minus, MessageSquare, Plus, SmilePlus, Trash2 } from 'lucide-react';
import type { CardView, VoteSummary } from '@shared/types';
import { canReactOrComment } from '@shared/rules';
import { Markdown } from '../../lib/markdown';
import { Avatar, cx, Popover } from '../ui';
import { useRetro } from './RetroContext';

const QUICK_EMOJI = ['👍', '❤️', '🔥', '💯', '😂', '🎉', '🤔', '😮', '👀', '🙏', '🚀', '😢'];

export function Reactions({ card }: { card: CardView }) {
  const { s, me, runCard, user } = useRetro();
  const [open, setOpen] = useState(false);
  const allowed = canReactOrComment(s.board.facilitator);
  const entries = Object.entries(card.reactions);
  if (!allowed && !entries.length) return null;
  const react = (emoji: string) => runCard('cards.react', { retroId: s.board.id, cardId: card.id, emoji });
  return (
    <div className="relative flex flex-wrap items-center gap-1">
      {entries.map(([emoji, who]) => (
        <button
          key={emoji}
          type="button"
          disabled={!allowed}
          onClick={() => react(emoji)}
          title={who.map((id) => user(id)?.displayName ?? '…').join(', ')}
          className={cx('flex h-6 items-center gap-1 rounded-full border px-1.5 text-xs transition', who.includes(me) ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-[var(--sp-border)] bg-white hover:bg-slate-50')}
        >
          <span>{emoji}</span>
          <span className="tabular-nums">{who.length}</span>
        </button>
      ))}
      {allowed && (
        <button type="button" aria-label="Add reaction" onClick={() => setOpen((o) => !o)} className="grid size-6 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <SmilePlus className="size-3.5" />
        </button>
      )}
      <Popover open={open} onClose={() => setOpen(false)} className="bottom-7 left-0 grid w-52 grid-cols-6 gap-0.5">
        {QUICK_EMOJI.map((e) => (
          <button key={e} type="button" aria-label={`React ${e}`} onClick={() => (setOpen(false), react(e))} className="rounded p-1 text-lg hover:bg-slate-100">
            {e}
          </button>
        ))}
      </Popover>
    </div>
  );
}

/** Dot-voting control for a card or group. */
export function VoteControl({ targetId, compact }: { targetId: string; compact?: boolean }) {
  const { s, run, patch } = useRetro();
  const f = s.board.facilitator;
  const mine = s.votes.myVotes[targetId] ?? 0;
  const total = s.votes.totals?.[targetId];
  const votingOpen = f.phase === 'vote' && !f.votingClosed && s.board.status === 'active';

  if (!votingOpen) {
    if (total === undefined || total === 0) return null;
    return (
      <span className="flex items-center gap-1 rounded-full bg-brand-500 px-2 py-0.5 text-xs font-semibold text-white tabular-nums" title={`${total} votes`}>
        {total} {compact ? '' : total === 1 ? 'vote' : 'votes'}
      </span>
    );
  }

  const cast = async (delta: 1 | -1) => {
    // Optimistic: reflect my dot immediately, then reconcile with the server's summary.
    const prev = s.votes;
    const myVotes = { ...prev.myVotes, [targetId]: Math.max(0, mine + delta) };
    if (!myVotes[targetId]) delete myVotes[targetId];
    patch({ votes: { ...prev, myVotes, myRemaining: prev.myRemaining - delta } });
    const res = await run<VoteSummary>('votes.cast', { retroId: s.board.id, targetId, delta });
    patch({ votes: res ?? prev });
  };

  return (
    <div className="flex items-center gap-1">
      <button type="button" aria-label="Remove vote" disabled={mine === 0} onClick={() => cast(-1)} className="grid size-6 place-items-center rounded-full border border-[var(--sp-border)] bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30">
        <Minus className="size-3" />
      </button>
      <div className="flex min-w-[2.5rem] items-center justify-center gap-0.5" aria-label={`${mine} of your votes`}>
        {Array.from({ length: Math.max(mine, 1) }).map((_, i) => (
          <span key={i} className={cx('size-2.5 rounded-full', i < mine ? 'bg-brand-500' : 'border border-slate-300')} />
        ))}
        {total !== undefined && <span className="ml-1 text-xs font-semibold text-slate-600 tabular-nums">{total}</span>}
      </div>
      <button
        type="button"
        aria-label="Add vote"
        disabled={s.votes.myRemaining <= 0 || mine >= s.votes.maxPerTarget}
        onClick={() => cast(1)}
        className="grid size-6 place-items-center rounded-full bg-brand-500 text-white hover:bg-brand-600 disabled:bg-slate-300"
      >
        <Plus className="size-3" />
      </button>
    </div>
  );
}

export function CommentToggle({ card, open, onToggle }: { card: CardView; open: boolean; onToggle: () => void }) {
  const { s } = useRetro();
  if (!canReactOrComment(s.board.facilitator) && !card.comments.length) return null;
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className={cx('flex h-6 items-center gap-1 rounded-full px-1.5 text-xs hover:bg-slate-100', open ? 'text-brand-600' : 'text-slate-500')}>
      <MessageSquare className="size-3.5" />
      {card.comments.length || ''}
    </button>
  );
}

export function CommentThread({ card }: { card: CardView }) {
  const { s, me, isFac, runCard, user, openLink } = useRetro();
  const [text, setText] = useState('');
  const allowed = canReactOrComment(s.board.facilitator);
  return (
    <div className="mt-2 space-y-2 border-t border-[var(--sp-border)] pt-2">
      {card.comments.map((c) => (
        <div key={c.id} className="group flex gap-2 text-xs">
          <Avatar user={user(c.authorId)} id={c.authorId} size={20} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span className="font-semibold">{user(c.authorId)?.displayName ?? '…'}</span>
              <span className="text-slate-400">{new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              {(c.authorId === me || isFac) && (
                <button type="button" aria-label="Delete comment" onClick={() => runCard('cards.deleteComment', { retroId: s.board.id, cardId: card.id, commentId: c.id })} className="ml-auto hidden text-slate-400 group-hover:block hover:text-red-600">
                  <Trash2 className="size-3" />
                </button>
              )}
            </div>
            <Markdown text={c.text} onLink={openLink} />
          </div>
        </div>
      ))}
      {allowed && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const t = text.trim();
            if (!t) return;
            setText('');
            const ok = await runCard('cards.comment', { retroId: s.board.id, cardId: card.id, text: t });
            if (!ok) setText(t);
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Reply..." aria-label="Add a comment" className="w-full rounded-md border border-[var(--sp-border)] px-2 py-1 text-xs" />
        </form>
      )}
    </div>
  );
}
