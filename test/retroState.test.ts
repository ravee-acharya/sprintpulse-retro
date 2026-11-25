import { describe, expect, it } from 'vitest';
import { mergeCard, retroReducer } from '../static/retro-ui/src/lib/retroState';
import type { CardView, RetroSnapshot } from '../src/shared/types';
import { DEFAULT_SETTINGS } from '../src/shared/catalog';

const view = (over: Partial<CardView> = {}): CardView => ({
  id: 'c1',
  retroId: 'r',
  columnId: 'a',
  authorId: 'me',
  anonymous: true,
  text: 'my secret',
  gifId: null,
  groupId: null,
  order: 0,
  reactions: {},
  comments: [],
  tags: ['x'],
  createdAt: 0,
  updatedAt: 0,
  version: 1,
  masked: false,
  maskedLength: 0,
  isMine: true,
  ...over,
});

const publicMasked = (over: Partial<CardView> = {}) =>
  view({ authorId: null, text: '', tags: [], masked: true, maskedLength: 9, isMine: false, ...over });

describe('mergeCard', () => {
  it('keeps my own text when a masked public echo of my card arrives', () => {
    const merged = mergeCard(view(), publicMasked({ version: 2, columnId: 'b' }));
    expect(merged).toMatchObject({ text: 'my secret', masked: false, isMine: true, authorId: 'me', columnId: 'b', version: 2, tags: ['x'] });
  });

  it('keeps my authorship on revealed anonymous echoes', () => {
    const merged = mergeCard(view(), view({ authorId: null, isMine: false, version: 3, reactions: { '👍': ['you'] } }));
    expect(merged).toMatchObject({ isMine: true, authorId: 'me', reactions: { '👍': ['you'] } });
  });

  it('ignores stale echoes', () => {
    expect(mergeCard(view({ version: 5 }), publicMasked({ version: 4 }))).toMatchObject({ version: 5, text: 'my secret' });
  });

  it("takes other people's cards as-is", () => {
    const other = publicMasked({ id: 'c2' });
    expect(mergeCard(view({ id: 'c2', isMine: false, authorId: null, text: '' }), other)).toBe(other);
  });
});

describe('retroReducer', () => {
  const snap = {
    board: { version: 2, facilitatorIds: ['fac'] },
    cards: [view()],
    groups: [],
    votes: { limit: 5, maxPerTarget: 3, myVotes: { c1: 2 }, myRemaining: 3, totals: null, votersCount: 1, hidden: true },
    mood: { counts: { great: 0, good: 1, okay: 0, meh: 0, rough: 0 }, average: 4, total: 1, mine: 'good' },
    actions: [],
    viewer: { accountId: 'me', isFacilitator: false },
  } as unknown as RetroSnapshot;

  it('keeps my votes and mood when public summaries arrive', () => {
    let s = retroReducer(snap, { type: 'event', viewer: 'me', event: { type: 'votes.updated', totals: { c1: 4 }, votersCount: 2 } })!;
    expect(s.votes).toMatchObject({ myVotes: { c1: 2 }, totals: { c1: 4 }, hidden: false, votersCount: 2 });
    s = retroReducer(s, { type: 'event', viewer: 'me', event: { type: 'mood.updated', mood: { counts: snap.mood.counts, average: 3, total: 2 } } })!;
    expect(s.mood).toMatchObject({ mine: 'good', total: 2 });
  });

  it('recomputes facilitator rights from board updates and drops stale boards', () => {
    const board: RetroSnapshot['board'] = { ...snap.board, version: 3, facilitatorIds: ['fac', 'me'], settings: DEFAULT_SETTINGS };
    const s = retroReducer(snap, { type: 'event', viewer: 'me', event: { type: 'board.updated', board, refetch: false } })!;
    expect(s.viewer.isFacilitator).toBe(true);
    const stale = retroReducer(s, { type: 'event', viewer: 'me', event: { type: 'board.updated', board: { ...board, version: 1, facilitatorIds: [] }, refetch: false } })!;
    expect(stale.viewer.isFacilitator).toBe(true);
  });
});
