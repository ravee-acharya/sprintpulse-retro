import { GIF_IDS } from '../shared/catalog';
import { applyVote, buildVoteSummary, summariseMood, tallyVotes, voteTargets, votesHidden } from '../shared/rules';
import type { MoodKey, MoodSummary, VoteBallot, VoteSummary } from '../shared/types';
import { AppError } from '../lib/errors';
import type { ReqContext } from '../lib/context';
import { ballots, cards, groups, INDEX, keys, moods } from '../storage/entities';
import { publishRetro } from '../realtime/publisher';
import { loadBoard, requireOpen } from './retros';

/**
 * Cast (+1) or retract (-1) a vote. Each voter owns a single ballot record, so votes from
 * different people never contend; the voter's own rapid clicks are serialised by the
 * ballot's optimistic lock, which also makes the vote limit check atomic.
 */
export async function castVote(ctx: ReqContext, retroId: string, targetId: string, delta: 1 | -1): Promise<VoteSummary> {
  const board = await loadBoard(ctx, retroId);
  requireOpen(board);
  if (board.facilitator.phase !== 'vote' || board.facilitator.votingClosed) throw new AppError('PHASE', 'Voting is not open.');

  const [cardList, groupList] = await Promise.all([cards.queryAll(INDEX.byRetro, [retroId]), groups.queryAll(INDEX.byRetro, [retroId])]);
  const targets = voteTargets(cardList, groupList);

  await ballots.mutate(keys.ballot(retroId, ctx.accountId), (cur) => {
    const base: VoteBallot = cur ?? { retroId, accountId: ctx.accountId, votes: {}, updatedAt: Date.now(), version: 0 };
    base.votes = applyVote(base.votes, targetId, delta, board.settings, targets);
    return base;
  });

  const all = await ballots.queryAll(INDEX.byRetro, [retroId]);
  const { totals, votersCount } = tallyVotes(all, targets);
  await publishRetro(ctx.projectId, retroId, ctx.accountId, {
    type: 'votes.updated',
    totals: votesHidden(board) ? null : totals,
    votersCount,
  });
  return buildVoteSummary(board, all, ctx.accountId, targets);
}

export async function getVoteSummary(ctx: ReqContext, retroId: string): Promise<VoteSummary> {
  const board = await loadBoard(ctx, retroId);
  const [cardList, groupList, all] = await Promise.all([
    cards.queryAll(INDEX.byRetro, [retroId]),
    groups.queryAll(INDEX.byRetro, [retroId]),
    ballots.queryAll(INDEX.byRetro, [retroId]),
  ]);
  return buildVoteSummary(board, all, ctx.accountId, voteTargets(cardList, groupList));
}

/** Facilitator: wipe all ballots (e.g. to re-run a vote). */
export async function resetVotes(ctx: ReqContext, retroId: string): Promise<void> {
  const board = await loadBoard(ctx, retroId);
  if (!board.facilitatorIds.includes(ctx.accountId)) throw new AppError('FORBIDDEN', 'Only a facilitator can reset votes.');
  const all = await ballots.queryAll(INDEX.byRetro, [retroId]);
  await Promise.all(all.map((b) => ballots.delete(keys.ballot(retroId, b.accountId))));
  await publishRetro(ctx.projectId, retroId, ctx.accountId, { type: 'votes.updated', totals: votesHidden(board) ? null : {}, votersCount: 0 });
}

export async function setMood(ctx: ReqContext, retroId: string, input: { mood: MoodKey; gifId: string | null; note: string }): Promise<MoodSummary> {
  const board = await loadBoard(ctx, retroId);
  requireOpen(board);
  if (input.gifId && !GIF_IDS.has(input.gifId)) throw new AppError('BAD_REQUEST', 'Unknown GIF.');
  await moods.mutate(keys.mood(retroId, ctx.accountId), (cur) => ({
    retroId,
    projectId: ctx.projectId,
    accountId: ctx.accountId,
    mood: input.mood,
    gifId: input.gifId,
    note: input.note,
    at: cur?.at ?? Date.now(),
  }));
  const all = await moods.queryAll(INDEX.byRetro, [retroId]);
  const summary = summariseMood(all, ctx.accountId);
  const { mine: _mine, ...publicSummary } = summary;
  await publishRetro(ctx.projectId, retroId, ctx.accountId, { type: 'mood.updated', mood: publicSummary });
  return summary;
}
