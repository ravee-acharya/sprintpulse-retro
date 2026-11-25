import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/catalog';
import {
  applyVote,
  buildRetroSummary,
  buildVoteSummary,
  RuleError,
  summariseMood,
  tallyVotes,
  toCardView,
  transitionPhase,
  voteTargets,
} from '../src/shared/rules';
import type { FacilitatorState, RetroCard, VoteBallot } from '../src/shared/types';

const fac = (over: Partial<FacilitatorState> = {}): FacilitatorState => ({
  phase: 'brainstorm',
  revealed: false,
  votingClosed: false,
  spotlight: null,
  timer: null,
  music: { trackId: null, playing: false, startedAt: null, volume: 0.4 },
  icebreaker: null,
  ...over,
});

const card = (over: Partial<RetroCard> = {}): RetroCard => ({
  id: 'c1',
  retroId: 'r1',
  columnId: 'col1',
  authorId: 'alice',
  anonymous: true,
  text: 'Deploys are slow',
  gifId: 'party',
  groupId: null,
  order: 1,
  reactions: { '👍': ['bob'] },
  comments: [{ id: 'm1', authorId: 'bob', text: 'agreed', createdAt: 1 }],
  tags: ['ci'],
  createdAt: 1,
  updatedAt: 1,
  version: 1,
  ...over,
});

describe('card visibility', () => {
  it('masks other people’s cards before reveal, but never the author’s own', () => {
    const others = toCardView(card(), { facilitator: fac() }, 'bob');
    expect(others).toMatchObject({ masked: true, text: '', gifId: null, reactions: {}, comments: [], tags: [], maskedLength: 16, isMine: false });

    const mine = toCardView(card(), { facilitator: fac() }, 'alice');
    expect(mine).toMatchObject({ masked: false, text: 'Deploys are slow', isMine: true, authorId: 'alice' });
  });

  it('public (realtime) projection is masked and anonymous', () => {
    const pub = toCardView(card(), { facilitator: fac() }, null);
    expect(pub.masked).toBe(true);
    expect(pub.authorId).toBeNull();
    expect(JSON.stringify(pub)).not.toContain('Deploys are slow');
    expect(JSON.stringify(pub)).not.toContain('alice');
  });

  it('reveals text after reveal but keeps anonymous authors hidden', () => {
    const v = toCardView(card(), { facilitator: fac({ revealed: true }) }, 'bob');
    expect(v).toMatchObject({ masked: false, text: 'Deploys are slow', authorId: null });
    const named = toCardView(card({ anonymous: false }), { facilitator: fac({ revealed: true }) }, 'bob');
    expect(named.authorId).toBe('alice');
  });
});

describe('phase transitions', () => {
  it('moving past brainstorm reveals; entering vote opens voting; leaving vote closes it', () => {
    const g = transitionPhase(fac(), 'group');
    expect(g.revealed).toBe(true);
    const v = transitionPhase({ ...g, votingClosed: true }, 'vote');
    expect(v.votingClosed).toBe(false);
    const a = transitionPhase(v, 'actions');
    expect(a.votingClosed).toBe(true);
  });

  it('clears spotlight on every phase change and stops timer/music on close', () => {
    const s = fac({
      spotlight: { targetType: 'card', targetId: 'c1', setBy: 'x', at: 1 },
      timer: { durationSec: 60, endsAt: 5, pausedRemainingSec: null, startedBy: 'x' },
      music: { trackId: 'cafe', playing: true, startedAt: 1, volume: 0.5 },
    });
    expect(transitionPhase(s, 'group').spotlight).toBeNull();
    const closed = transitionPhase(s, 'closed');
    expect(closed.timer).toBeNull();
    expect(closed.music.playing).toBe(false);
  });

  it('going back from icebreaker into brainstorm starts masked', () => {
    expect(transitionPhase(fac({ phase: 'icebreaker', revealed: true }), 'brainstorm').revealed).toBe(false);
  });
});

describe('dot voting', () => {
  const settings = { voteLimit: 3, maxVotesPerTarget: 2 };
  const targets = new Set(['a', 'b', 'c']);

  it('enforces total and per-target limits', () => {
    let b = applyVote({}, 'a', 1, settings, targets);
    b = applyVote(b, 'a', 1, settings, targets);
    expect(() => applyVote(b, 'a', 1, settings, targets)).toThrowError(expect.objectContaining({ code: 'VOTE_TARGET_LIMIT' }));
    b = applyVote(b, 'b', 1, settings, targets);
    expect(() => applyVote(b, 'c', 1, settings, targets)).toThrowError(expect.objectContaining({ code: 'VOTE_LIMIT' }));
    expect(b).toEqual({ a: 2, b: 1 });
  });

  it('retracts votes and rejects retracting from nothing', () => {
    expect(applyVote({ a: 1 }, 'a', -1, settings, targets)).toEqual({});
    expect(() => applyVote({}, 'a', -1, settings, targets)).toThrow(RuleError);
  });

  it('ignores votes on deleted targets when computing the remaining budget', () => {
    // 3 votes were on a card that has since been merged into a group.
    expect(applyVote({ gone: 3 }, 'a', 1, settings, targets)).toEqual({ gone: 3, a: 1 });
  });

  it('rejects unknown targets', () => {
    expect(() => applyVote({}, 'zzz', 1, settings, targets)).toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }));
  });

  it('hides totals until voting closes when configured', () => {
    const ballots: VoteBallot[] = [
      { retroId: 'r', accountId: 'u1', votes: { a: 2, b: 1 }, updatedAt: 0, version: 1 },
      { retroId: 'r', accountId: 'u2', votes: { a: 1 }, updatedAt: 0, version: 1 },
      { retroId: 'r', accountId: 'u3', votes: {}, updatedAt: 0, version: 1 },
    ];
    expect(tallyVotes(ballots, targets)).toEqual({ totals: { a: 3, b: 1 }, votersCount: 2 });

    const open = buildVoteSummary({ settings: DEFAULT_SETTINGS, facilitator: fac({ phase: 'vote' }) }, ballots, 'u1', targets);
    expect(open).toMatchObject({ hidden: true, totals: null, myVotes: { a: 2, b: 1 }, myRemaining: DEFAULT_SETTINGS.voteLimit - 3 });

    const closed = buildVoteSummary({ settings: DEFAULT_SETTINGS, facilitator: fac({ phase: 'vote', votingClosed: true }) }, ballots, 'u2', targets);
    expect(closed).toMatchObject({ hidden: false, totals: { a: 3, b: 1 } });
  });

  it('vote targets are groups plus ungrouped cards', () => {
    const t = voteTargets(
      [
        { id: 'c1', groupId: 'g1' },
        { id: 'c2', groupId: 'g1' },
        { id: 'c3', groupId: null },
        { id: 'c4', groupId: 'deleted-group' },
      ],
      [{ id: 'g1' }],
    );
    expect([...t].sort()).toEqual(['c3', 'c4', 'g1']);
  });
});

describe('mood + summary', () => {
  it('averages mood scores', () => {
    const m = summariseMood(
      [
        { retroId: 'r', projectId: 'p', accountId: 'a', mood: 'great', gifId: null, note: '', at: 1 },
        { retroId: 'r', projectId: 'p', accountId: 'b', mood: 'rough', gifId: null, note: '', at: 1 },
      ],
      'b',
    );
    expect(m).toMatchObject({ average: 3, total: 2, mine: 'rough' });
    expect(m.counts.great).toBe(1);
  });

  it('builds a retro summary with participants and recurring topics', () => {
    const s = buildRetroSummary({
      cards: [card({ authorId: 'a', tags: ['CI', '#flaky tests'] }), card({ id: 'c2', authorId: 'b', tags: ['ci'] })],
      groups: [{ id: 'g', retroId: 'r', columnId: 'x', title: 'The flaky pipeline', order: 0, createdBy: 'a', createdAt: 0, version: 1 }],
      ballots: [{ retroId: 'r', accountId: 'c', votes: { g: 2 }, updatedAt: 0, version: 1 }],
      moods: [{ retroId: 'r', projectId: 'p', accountId: 'd', mood: 'good', gifId: null, note: '', at: 0 }],
      actionCount: 2,
      now: 99,
    });
    expect(s).toMatchObject({ cardCount: 2, groupCount: 1, participantCount: 4, voteCount: 2, actionCount: 2, moodAverage: 4, closedAt: 99 });
    expect(s.topicCounts).toEqual({ ci: 2, 'flaky-tests': 1, 'flaky pipeline': 1 });
  });
});
