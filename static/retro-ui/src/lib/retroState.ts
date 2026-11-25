/**
 * Pure state merging for realtime events. Realtime payloads are *public* projections
 * (masked, anonymous), so merging must never downgrade data the viewer is entitled to:
 * their own cards keep their text, and their own vote counts are kept.
 */
import type { RetroEvent } from '@shared/events';
import type { CardView, RetroSnapshot } from '@shared/types';

export type RetroAction =
  | { type: 'snapshot'; snapshot: RetroSnapshot }
  | { type: 'event'; event: RetroEvent; viewer: string }
  | { type: 'mine'; card: CardView } // authoritative response to my own mutation
  | { type: 'removeCard'; cardId: string }
  | { type: 'patch'; patch: Partial<RetroSnapshot> };

export function mergeCard(existing: CardView | undefined, incoming: CardView): CardView {
  if (!existing) return incoming;
  if (existing.version > incoming.version) return existing; // stale echo
  if (!existing.isMine) return incoming;
  // Public projection of my own card: keep what only I may see.
  return {
    ...incoming,
    isMine: true,
    authorId: existing.authorId,
    ...(incoming.masked
      ? { masked: false, maskedLength: 0, text: existing.text, gifId: existing.gifId, tags: existing.tags, reactions: existing.reactions, comments: existing.comments }
      : {}),
  };
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const next = list.slice();
  next[i] = item;
  return next;
}

export function retroReducer(state: RetroSnapshot | null, action: RetroAction): RetroSnapshot | null {
  if (action.type === 'snapshot') return action.snapshot;
  if (!state) return state;
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.patch };
    case 'mine':
      return { ...state, cards: upsert(state.cards, mergeCard(state.cards.find((c) => c.id === action.card.id), action.card)) };
    case 'removeCard':
      return { ...state, cards: state.cards.filter((c) => c.id !== action.cardId) };
    case 'event':
      return applyEvent(state, action.event, action.viewer);
  }
}

function applyEvent(s: RetroSnapshot, e: RetroEvent, viewer: string): RetroSnapshot {
  switch (e.type) {
    case 'board.updated':
      if (e.board.version < s.board.version) return s;
      return { ...s, board: e.board, viewer: { ...s.viewer, isFacilitator: e.board.facilitatorIds.includes(viewer) } };
    case 'card.upserted': {
      const existing = s.cards.find((c) => c.id === e.card.id);
      return { ...s, cards: upsert(s.cards, mergeCard(existing, e.card)) };
    }
    case 'card.deleted':
      return { ...s, cards: s.cards.filter((c) => c.id !== e.cardId) };
    case 'group.upserted': {
      const existing = s.groups.find((g) => g.id === e.group.id);
      if (existing && existing.version > e.group.version) return s;
      return { ...s, groups: upsert(s.groups, e.group) };
    }
    case 'group.deleted':
      return { ...s, groups: s.groups.filter((g) => g.id !== e.groupId) };
    case 'votes.updated':
      return { ...s, votes: { ...s.votes, totals: e.totals, votersCount: e.votersCount, hidden: e.totals === null } };
    case 'mood.updated':
      return { ...s, mood: { ...e.mood, mine: s.mood.mine } };
    case 'action.upserted': {
      const existing = s.actions.find((a) => a.id === e.action.id);
      if (existing && existing.version > e.action.version) return s;
      return { ...s, actions: upsert(s.actions, e.action) };
    }
    case 'action.deleted':
      return { ...s, actions: s.actions.filter((a) => a.id !== e.actionId) };
  }
}
