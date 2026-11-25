import { useState, type CSSProperties } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Edit3, ListPlus, Lock, MoreHorizontal, Spotlight, Trash2, Ungroup, UserRound, UserX } from 'lucide-react';
import { canGroup } from '@shared/rules';
import type { CardView } from '@shared/types';
import { Markdown } from '../../lib/markdown';
import { Avatar, Button, cx, Popover, Sticker } from '../ui';
import { CardEditor } from './Composer';
import { CommentThread, CommentToggle, Reactions, VoteControl } from './CardParts';
import { useRetro } from './RetroContext';

export function useCardDnd(card: CardView) {
  const { s, isFac } = useRetro();
  const f = s.board.facilitator;
  const draggable = s.board.status === 'active' && (canGroup(f, isFac) || (card.isMine && f.phase === 'brainstorm'));
  const drag = useDraggable({ id: `card:${card.id}`, disabled: !draggable, data: { type: 'card', card } });
  const drop = useDroppable({ id: `drop-card:${card.id}`, disabled: !canGroup(f, isFac), data: { type: 'card', card } });
  return { drag, drop, draggable };
}

export function CardItem({ card, inGroup, isVoteTarget = !inGroup }: { card: CardView; inGroup?: boolean; isVoteTarget?: boolean }) {
  const { s, isFac, user, runCard, removeCard, run, refresh, openLink, openActions } = useRetro();
  const { drag, drop, draggable } = useCardDnd(card);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [thread, setThread] = useState(false);
  const f = s.board.facilitator;
  const retroId = s.board.id;
  const author = card.authorId ? user(card.authorId) : null;
  const spotlighted = f.spotlight?.targetType === 'card' && f.spotlight.targetId === card.id;

  const setRef = (el: HTMLElement | null) => {
    drag.setNodeRef(el);
    drop.setNodeRef(el);
  };
  const style: CSSProperties = drag.isDragging ? { opacity: 0.35 } : {};

  return (
    <article
      ref={setRef}
      style={style}
      {...drag.attributes}
      {...drag.listeners}
      aria-roledescription={draggable ? 'draggable card' : undefined}
      className={cx(
        'sp-enter group/card relative rounded-lg border bg-white p-2.5 text-sm shadow-sm transition',
        draggable && 'cursor-grab active:cursor-grabbing',
        drop.isOver && !drag.isDragging ? 'border-brand-400 ring-2 ring-brand-200' : 'border-[var(--sp-border)]',
        spotlighted && 'ring-2 ring-amber-400',
        inGroup && 'shadow-none',
      )}
    >
      {card.masked ? (
        <MaskedBody card={card} authorName={author?.displayName ?? null} />
      ) : editing ? (
        <CardEditor card={card} onDone={() => setEditing(false)} />
      ) : (
        <>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs text-slate-500">
            {/* Anonymous cards read "Anonymous" even to their author, so screen-sharing never gives them away. */}
            <Avatar user={author} id={card.authorId} size={18} anonymous={card.anonymous || !card.authorId} />
            <span className="truncate">{card.anonymous || !card.authorId ? 'Anonymous' : card.isMine ? 'You' : (author?.displayName ?? '…')}</span>
            {card.isMine && !f.revealed && <Lock className="size-3 text-slate-400" aria-label="Only you can see this until reveal" />}
            <div className="relative ml-auto" onPointerDown={(e) => e.stopPropagation()}>
              <button type="button" aria-label="Card actions" onClick={() => setMenu((m) => !m)} className="rounded p-0.5 opacity-0 group-hover/card:opacity-100 hover:bg-slate-100 focus:opacity-100">
                <MoreHorizontal className="size-4" />
              </button>
              <Popover open={menu} onClose={() => setMenu(false)} className="top-6 right-0 w-48 p-1">
                {card.isMine && (
                  <MenuItem icon={<Edit3 className="size-3.5" />} onClick={() => (setMenu(false), setEditing(true))}>Edit</MenuItem>
                )}
                {card.isMine && s.board.settings.allowAuthorToggleAnonymity && (
                  <MenuItem icon={card.anonymous ? <UserRound className="size-3.5" /> : <UserX className="size-3.5" />} onClick={() => (setMenu(false), runCard('cards.edit', { retroId, cardId: card.id, anonymous: !card.anonymous }))}>
                    {card.anonymous ? 'Show my name' : 'Make anonymous'}
                  </MenuItem>
                )}
                {f.revealed && s.board.status !== 'archived' && (
                  <MenuItem icon={<ListPlus className="size-3.5" />} onClick={() => (setMenu(false), openActions({ title: card.text.replace(/[#*_`~>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120), sourceCardId: card.id }))}>
                    Create action item
                  </MenuItem>
                )}
                {isFac && f.revealed && (
                  <MenuItem icon={<Spotlight className="size-3.5" />} onClick={() => (setMenu(false), run('facilitator.spotlight', { retroId, target: { type: 'card', id: card.id } }))}>Spotlight for everyone</MenuItem>
                )}
                {inGroup && canGroup(f, isFac) && (
                  <MenuItem icon={<Ungroup className="size-3.5" />} onClick={() => (setMenu(false), runCard('cards.ungroup', { retroId, cardId: card.id }))}>Remove from group</MenuItem>
                )}
                {(card.isMine || isFac) && (
                  <MenuItem
                    danger
                    icon={<Trash2 className="size-3.5" />}
                    onClick={async () => {
                      setMenu(false);
                      removeCard(card.id);
                      if ((await run('cards.delete', { retroId, cardId: card.id })) === null) void refresh();
                    }}
                  >
                    Delete
                  </MenuItem>
                )}
              </Popover>
            </div>
          </div>
          {card.text && <Markdown text={card.text} onLink={openLink} />}
          {card.gifId && <div className="mt-2"><Sticker id={card.gifId} /></div>}
          {!!card.tags.length && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {card.tags.map((t) => <span key={t} className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-600">#{t}</span>)}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
            <Reactions card={card} />
            <CommentToggle card={card} open={thread} onToggle={() => setThread((t) => !t)} />
            {isVoteTarget && <div className="ml-auto"><VoteControl targetId={card.id} /></div>}
          </div>
          {thread && <div onPointerDown={(e) => e.stopPropagation()}><CommentThread card={card} /></div>}
        </>
      )}
    </article>
  );
}

function MaskedBody({ card, authorName }: { card: CardView; authorName: string | null }) {
  const lines = Math.min(4, Math.max(1, Math.ceil(card.maskedLength / 38)));
  return (
    <div aria-label="Hidden card">
      <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-500">
        <Lock className="size-3" /> {authorName ? `${authorName}'s card` : 'Hidden card'} · revealed later
      </div>
      <div className="space-y-1.5" aria-hidden>
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="sp-masked-line h-2.5 rounded" style={{ width: i === lines - 1 && lines > 1 ? '60%' : '100%' }} />
        ))}
      </div>
    </div>
  );
}

function MenuItem({ icon, children, onClick, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className={cx('w-full justify-start', danger && 'text-red-600 hover:bg-red-50')}>
      {icon} {children}
    </Button>
  );
}
