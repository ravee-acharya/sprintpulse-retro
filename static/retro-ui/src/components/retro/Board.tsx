/**
 * Board: column view or tabbed focus view, with @dnd-kit drag-and-drop.
 *   - drop a card on a card   -> stack them into a new group
 *   - drop a card on a group  -> join that group
 *   - drop a card on a column -> move it there (and out of its group)
 *   - drop a group on a column -> move the whole stack
 */
import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { ArrowDownWideNarrow, Check, Layers, Pencil, Plus, Spotlight } from 'lucide-react';
import { canCreateCards, canGroup } from '@shared/rules';
import type { CardGroup, CardView, RetroColumn } from '@shared/types';
import { Button, COLUMN_STYLES, cx } from '../ui';
import { CardItem } from './CardItem';
import { VoteControl } from './CardParts';
import { Composer } from './Composer';
import { useRetro } from './RetroContext';

type Item = { kind: 'group'; group: CardGroup; cards: CardView[] } | { kind: 'card'; card: CardView };

/** Prefer card/group targets under the pointer over the column behind them. */
const collision: CollisionDetection = (args) => {
  const activeId = String(args.active.id);
  const hits = pointerWithin(args).filter((h) => !String(h.id).endsWith(activeId.split(':')[1]!) || String(h.id).startsWith('col:'));
  const specific = hits.filter((h) => !String(h.id).startsWith('col:'));
  if (specific.length) return specific;
  if (hits.length) return hits;
  return rectIntersection(args).filter((h) => String(h.id).startsWith('col:'));
};

export function useColumnItems(sortByVotes: boolean) {
  const { s } = useRetro();
  return useMemo(() => {
    const totals = s.votes.totals ?? {};
    const groupIds = new Set(s.groups.map((g) => g.id));
    const byColumn = new Map<string, Item[]>();
    for (const col of s.board.columns) byColumn.set(col.id, []);
    for (const g of s.groups) {
      const cards = s.cards.filter((c) => c.groupId === g.id).sort((a, b) => a.order - b.order);
      if (cards.length) byColumn.get(g.columnId)?.push({ kind: 'group', group: g, cards });
    }
    for (const c of s.cards) if (!c.groupId || !groupIds.has(c.groupId)) byColumn.get(c.columnId)?.push({ kind: 'card', card: c });
    const order = (i: Item) => (i.kind === 'group' ? Math.min(i.group.order, ...i.cards.map((c) => c.createdAt)) : i.card.createdAt);
    const votes = (i: Item) => totals[i.kind === 'group' ? i.group.id : i.card.id] ?? 0;
    for (const list of byColumn.values()) list.sort((a, b) => (sortByVotes ? votes(b) - votes(a) : 0) || order(a) - order(b));
    return byColumn;
  }, [s.cards, s.groups, s.board.columns, s.votes.totals, sortByVotes]);
}

export function Board() {
  const { s, isFac, viewMode, run, runCard, patch } = useRetro();
  const f = s.board.facilitator;
  const [sortByVotes, setSortByVotes] = useState(false);
  const [focusCol, setFocusCol] = useState<string | null>(null);
  const [dragging, setDragging] = useState<Item | null>(null);
  const items = useColumnItems(sortByVotes || f.phase === 'actions' || f.phase === 'closed');
  const columns = [...s.board.columns].sort((a, b) => a.order - b.order);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const retroId = s.board.id;

  function onDragStart(e: DragStartEvent) {
    const d = e.active.data.current as { type: 'card'; card: CardView } | { type: 'group'; group: CardGroup; cards: CardView[] };
    setDragging(d.type === 'card' ? { kind: 'card', card: d.card } : { kind: 'group', group: d.group, cards: d.cards });
  }

  async function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const over = e.over ? String(e.over.id) : null;
    const active = String(e.active.id);
    if (!over) return;
    const [kind, id] = active.split(':') as ['card' | 'group', string];
    const [overKind, overId] = over.split(':') as [string, string];

    if (kind === 'card') {
      const card = s.cards.find((c) => c.id === id);
      if (!card) return;
      const grouping = canGroup(f, isFac);
      if (overKind === 'drop-card' && overId !== id) {
        const target = s.cards.find((c) => c.id === overId);
        if (!target) return;
        if (!grouping) return void moveCard(card, target.columnId);
        if (target.groupId && target.groupId === card.groupId) return;
        const res = await run<{ group: CardGroup; cards: CardView[] }>('cards.group', { retroId, cardId: id, target: { type: 'card', id: overId } });
        if (res) applyGroupResult(res);
      } else if (overKind === 'drop-group' && grouping && card.groupId !== overId) {
        const res = await run<{ group: CardGroup; cards: CardView[] }>('cards.group', { retroId, cardId: id, target: { type: 'group', id: overId } });
        if (res) applyGroupResult(res);
      } else if (overKind === 'col' && (card.columnId !== overId || card.groupId)) {
        await moveCard(card, overId);
      }
    } else if (kind === 'group' && overKind === 'col') {
      const g = s.groups.find((x) => x.id === id);
      if (!g || g.columnId === overId) return;
      patch({ groups: s.groups.map((x) => (x.id === id ? { ...x, columnId: overId } : x)), cards: s.cards.map((c) => (c.groupId === id ? { ...c, columnId: overId } : c)) });
      await run('groups.update', { retroId, groupId: id, columnId: overId });
    }
  }

  async function moveCard(card: CardView, columnId: string) {
    // Optimistic move; the server's response (or realtime echo) reconciles.
    patch({ cards: s.cards.map((c) => (c.id === card.id ? { ...c, columnId, groupId: null } : c)) });
    // Dragging a stacked card onto its own column's empty space pulls it out of the stack.
    if (card.groupId && card.columnId === columnId) await runCard('cards.ungroup', { retroId, cardId: card.id });
    else await runCard('cards.move', { retroId, cardId: card.id, columnId, order: Date.now() });
  }

  function applyGroupResult(res: { group: CardGroup; cards: CardView[] }) {
    const groups = s.groups.some((g) => g.id === res.group.id) ? s.groups : [...s.groups, res.group];
    const byId = new Map(res.cards.map((c) => [c.id, c]));
    patch({ groups, cards: s.cards.map((c) => byId.get(c.id) ?? c) });
  }

  const showSort = !!s.votes.totals && f.phase === 'vote';
  const visibleColumns = viewMode === 'focus' ? columns.filter((c) => c.id === (focusCol ?? columns[0]?.id)) : columns;

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      {viewMode === 'focus' && (
        <div className="flex gap-1 overflow-x-auto px-4 pt-3" role="tablist">
          {columns.map((c) => {
            const active = c.id === (focusCol ?? columns[0]?.id);
            const count = items.get(c.id)?.length ?? 0;
            return (
              <button key={c.id} role="tab" aria-selected={active} type="button" onClick={() => setFocusCol(c.id)} className={cx('flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap', active ? 'border-brand-500 bg-white/70' : 'border-transparent text-slate-500 hover:bg-white/40')}>
                <span>{c.emoji}</span> {c.title}
                <span className="rounded-full bg-slate-200 px-1.5 text-[11px] text-slate-600">{count}</span>
              </button>
            );
          })}
        </div>
      )}
      {showSort && (
        <div className="flex justify-end px-4 pt-2">
          <Button size="sm" variant="ghost" onClick={() => setSortByVotes((v) => !v)} className={cx(sortByVotes && 'text-brand-700')}>
            {sortByVotes ? <Check className="size-3.5" /> : <ArrowDownWideNarrow className="size-3.5" />} Sort by votes
          </Button>
        </div>
      )}
      <div className={cx('flex gap-4 p-4', viewMode === 'board' ? 'min-h-0 flex-1 items-start overflow-x-auto' : 'flex-col')}>
        {visibleColumns.map((col) => (
          <Column key={col.id} column={col} items={items.get(col.id) ?? []} wide={viewMode === 'focus'} />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="w-72 rotate-2 rounded-lg border border-brand-300 bg-white p-2.5 text-sm shadow-2xl">
            {dragging.kind === 'card' ? (
              <p className="line-clamp-3">{dragging.card.masked ? 'Hidden card' : dragging.card.text || 'GIF card'}</p>
            ) : (
              <p className="flex items-center gap-1.5 font-semibold"><Layers className="size-4" /> {dragging.group.title} ({dragging.cards.length})</p>
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function Column({ column, items, wide }: { column: RetroColumn; items: Item[]; wide: boolean }) {
  const { s, isFac } = useRetro();
  const [composing, setComposing] = useState(false);
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.id}` });
  const st = COLUMN_STYLES[column.color];
  const canAdd = s.board.status === 'active' && canCreateCards(s.board.facilitator, isFac);
  const count = items.reduce((n, i) => n + (i.kind === 'group' ? i.cards.length : 1), 0);

  return (
    <section ref={setNodeRef} aria-label={column.title} className={cx('flex shrink-0 flex-col rounded-xl border bg-white/60 backdrop-blur transition', wide ? 'w-full' : 'w-80', isOver ? `ring-2 ${st.ring}` : 'border-white/60')}>
      <header className="px-3 pt-3 pb-2">
        <div className={cx('mb-2 h-1 rounded-full', st.bar)} />
        <div className="flex items-center gap-1.5">
          <span className="text-lg">{column.emoji}</span>
          <h3 className="font-semibold">{column.title}</h3>
          <span className={cx('rounded-full px-1.5 text-xs', st.soft, st.text)}>{count}</span>
          {canAdd && !composing && (
            <button type="button" aria-label={`Add card to ${column.title}`} onClick={() => setComposing(true)} className="ml-auto rounded p-1 text-slate-500 hover:bg-black/5">
              <Plus className="size-4" />
            </button>
          )}
        </div>
        {column.prompt && <p className="mt-0.5 text-xs text-[var(--sp-text-subtle)]">{column.prompt}</p>}
      </header>
      <div className={cx('flex flex-1 flex-col gap-2 px-3 pb-3', wide && 'grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] items-start')}>
        {composing && <Composer columnId={column.id} onClose={() => setComposing(false)} />}
        {items.map((it) => (it.kind === 'group' ? <GroupStack key={it.group.id} group={it.group} cards={it.cards} /> : <CardItem key={it.card.id} card={it.card} />))}
        {!items.length && !composing && (
          <button type="button" disabled={!canAdd} onClick={() => setComposing(true)} className="rounded-lg border border-dashed border-slate-300 py-6 text-center text-xs text-slate-400 enabled:hover:bg-white/60">
            {canAdd ? '+ Add the first card' : 'No cards'}
          </button>
        )}
      </div>
    </section>
  );
}

function GroupStack({ group, cards }: { group: CardGroup; cards: CardView[] }) {
  const { s, isFac, run, patch } = useRetro();
  const f = s.board.facilitator;
  const grouping = canGroup(f, isFac) && s.board.status === 'active';
  const drag = useDraggable({ id: `group:${group.id}`, disabled: !grouping, data: { type: 'group', group, cards } });
  const drop = useDroppable({ id: `drop-group:${group.id}`, disabled: !grouping });
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(group.title);
  const [expanded, setExpanded] = useState(true);
  const spotlighted = f.spotlight?.targetType === 'group' && f.spotlight.targetId === group.id;

  const save = async () => {
    setEditing(false);
    const t = title.trim();
    if (!t || t === group.title) return setTitle(group.title);
    patch({ groups: s.groups.map((g) => (g.id === group.id ? { ...g, title: t } : g)) });
    await run('groups.update', { retroId: s.board.id, groupId: group.id, title: t });
  };

  return (
    <div
      ref={(el) => (drag.setNodeRef(el), drop.setNodeRef(el))}
      style={drag.isDragging ? { opacity: 0.35 } : undefined}
      className={cx('sp-enter rounded-xl border-2 bg-slate-50/90 p-2 transition', drop.isOver ? 'border-brand-400 bg-brand-50' : 'border-dashed border-slate-300', spotlighted && 'ring-2 ring-amber-400')}
    >
      <div className={cx('mb-2 flex items-center gap-1.5 px-1', grouping && 'cursor-grab active:cursor-grabbing')} {...drag.attributes} {...drag.listeners}>
        <Layers className="size-4 shrink-0 text-slate-500" />
        {editing ? (
          <input
            autoFocus
            value={title}
            maxLength={60}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => (e.key === 'Enter' ? void save() : e.key === 'Escape' && (setTitle(group.title), setEditing(false)))}
            aria-label="Group title"
            className="min-w-0 flex-1 rounded border border-[var(--sp-border)] px-1 text-sm font-semibold"
          />
        ) : (
          <button type="button" onClick={() => setExpanded((x) => !x)} onPointerDown={(e) => e.stopPropagation()} className="min-w-0 flex-1 truncate text-left text-sm font-semibold" title={group.title}>
            {group.title}
          </button>
        )}
        <span className="rounded-full bg-slate-200 px-1.5 text-[11px] text-slate-600">{cards.length}</span>
        <div className="flex items-center" onPointerDown={(e) => e.stopPropagation()}>
          {grouping && !editing && (
            <button type="button" aria-label="Rename group" onClick={() => setEditing(true)} className="rounded p-0.5 text-slate-400 hover:bg-black/5 hover:text-slate-600"><Pencil className="size-3.5" /></button>
          )}
          {isFac && f.revealed && (
            <button type="button" aria-label="Spotlight group" onClick={() => run('facilitator.spotlight', { retroId: s.board.id, target: { type: 'group', id: group.id } })} className="rounded p-0.5 text-slate-400 hover:bg-black/5 hover:text-amber-600"><Spotlight className="size-3.5" /></button>
          )}
        </div>
      </div>
      <div className="mb-1 flex justify-end px-1" onPointerDown={(e) => e.stopPropagation()}>
        <VoteControl targetId={group.id} />
      </div>
      {expanded ? (
        <div className="space-y-1.5">
          {cards.map((c) => <CardItem key={c.id} card={c} inGroup />)}
        </div>
      ) : (
        <button type="button" onClick={() => setExpanded(true)} className="w-full text-xs text-slate-500 hover:underline">Show {cards.length} cards</button>
      )}
    </div>
  );
}
