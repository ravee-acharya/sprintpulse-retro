/**
 * Pure domain rules - no I/O. Used by resolvers (authoritative) and unit tests,
 * and safe to import from the UI for optimistic updates.
 */
import { emptyMoodCounts, MOODS } from './catalog';
import type {
  AccountId,
  CardGroup,
  CardView,
  FacilitatorState,
  MoodCheckin,
  MoodKey,
  MoodSummary,
  RetroBoard,
  RetroCard,
  RetroPhase,
  RetroSettings,
  RetroSummary,
  VoteBallot,
  VoteSummary,
} from './types';
import { PHASE_ORDER } from './types';

export class RuleError extends Error {
  constructor(
    public readonly code: 'PHASE' | 'VOTE_LIMIT' | 'VOTE_TARGET_LIMIT' | 'NO_VOTES' | 'BAD_REQUEST' | 'FORBIDDEN',
    message: string,
  ) {
    super(message);
  }
}

/* ---------------------------- visibility ---------------------------- */

/** Masking applies to everyone but the author until the facilitator reveals cards. */
export function isCardMasked(card: Pick<RetroCard, 'authorId'>, fac: FacilitatorState, viewer: AccountId | null): boolean {
  if (fac.revealed) return false;
  return card.authorId !== viewer;
}

/**
 * Project a stored card into what `viewer` may see. Pass `viewer = null` for the
 * public projection broadcast over realtime.
 */
export function toCardView(card: RetroCard, board: Pick<RetroBoard, 'facilitator'>, viewer: AccountId | null): CardView {
  const isMine = viewer !== null && card.authorId === viewer;
  const masked = isCardMasked(card, board.facilitator, viewer);
  const { authorId, text, ...rest } = card;
  return {
    ...rest,
    authorId: card.anonymous && !isMine ? null : authorId,
    text: masked ? '' : text,
    gifId: masked ? null : card.gifId,
    reactions: masked ? {} : card.reactions,
    comments: masked ? [] : card.comments,
    tags: masked ? [] : card.tags,
    masked,
    maskedLength: masked ? text.length : 0,
    isMine,
  };
}

/* ------------------------------ phases ------------------------------ */

export function phaseIndex(p: RetroPhase): number {
  return PHASE_ORDER.indexOf(p);
}

export function canCreateCards(fac: FacilitatorState, isFacilitator: boolean): boolean {
  if (isFacilitator) return fac.phase !== 'closed';
  return fac.phase === 'brainstorm' || fac.phase === 'group';
}

export function canGroup(fac: FacilitatorState, isFacilitator: boolean): boolean {
  if (fac.phase === 'group') return true;
  return isFacilitator && (fac.phase === 'brainstorm' || fac.phase === 'vote' || fac.phase === 'actions');
}

export function canReactOrComment(fac: FacilitatorState): boolean {
  return fac.revealed && fac.phase !== 'closed';
}

/**
 * Apply side-effects of entering a phase. Moving past brainstorm always reveals;
 * entering voting reopens it; leaving voting closes it.
 */
export function transitionPhase(fac: FacilitatorState, next: RetroPhase): FacilitatorState {
  const out: FacilitatorState = { ...fac, phase: next, spotlight: null };
  if (phaseIndex(next) > phaseIndex('brainstorm')) out.revealed = true;
  if (next === 'brainstorm' && phaseIndex(fac.phase) < phaseIndex('brainstorm')) out.revealed = false;
  if (next === 'vote') out.votingClosed = false;
  if (phaseIndex(next) > phaseIndex('vote')) out.votingClosed = true;
  if (next === 'closed') {
    out.timer = null;
    out.music = { ...out.music, playing: false, startedAt: null };
  }
  return out;
}

/* ------------------------------ voting ------------------------------ */

export function votesHidden(board: Pick<RetroBoard, 'settings' | 'facilitator'>): boolean {
  return board.settings.hideVotesUntilClosed && !board.facilitator.votingClosed;
}

/** Votes spent, counting only targets that still exist. */
export function votesSpent(votes: Record<string, number>, validTargets?: ReadonlySet<string>): number {
  let n = 0;
  for (const [target, count] of Object.entries(votes)) {
    if (!validTargets || validTargets.has(target)) n += count;
  }
  return n;
}

export function applyVote(
  ballot: Record<string, number>,
  targetId: string,
  delta: 1 | -1,
  settings: Pick<RetroSettings, 'voteLimit' | 'maxVotesPerTarget'>,
  validTargets: ReadonlySet<string>,
): Record<string, number> {
  if (!validTargets.has(targetId)) throw new RuleError('BAD_REQUEST', 'That card or group no longer exists.');
  const current = ballot[targetId] ?? 0;
  const next = { ...ballot };
  if (delta === 1) {
    if (votesSpent(ballot, validTargets) >= settings.voteLimit) {
      throw new RuleError('VOTE_LIMIT', `You have used all ${settings.voteLimit} votes.`);
    }
    if (current >= settings.maxVotesPerTarget) {
      throw new RuleError('VOTE_TARGET_LIMIT', `At most ${settings.maxVotesPerTarget} votes per item.`);
    }
    next[targetId] = current + 1;
  } else {
    if (current <= 0) throw new RuleError('NO_VOTES', 'You have no votes on that item.');
    if (current === 1) delete next[targetId];
    else next[targetId] = current - 1;
  }
  return next;
}

export function tallyVotes(ballots: VoteBallot[], validTargets: ReadonlySet<string>): { totals: Record<string, number>; votersCount: number } {
  const totals: Record<string, number> = {};
  let votersCount = 0;
  for (const b of ballots) {
    let used = false;
    for (const [target, count] of Object.entries(b.votes)) {
      if (!validTargets.has(target) || count <= 0) continue;
      totals[target] = (totals[target] ?? 0) + count;
      used = true;
    }
    if (used) votersCount++;
  }
  return { totals, votersCount };
}

export function buildVoteSummary(
  board: Pick<RetroBoard, 'settings' | 'facilitator'>,
  ballots: VoteBallot[],
  viewer: AccountId,
  validTargets: ReadonlySet<string>,
): VoteSummary {
  const mine = ballots.find((b) => b.accountId === viewer)?.votes ?? {};
  const myVotes = Object.fromEntries(Object.entries(mine).filter(([t]) => validTargets.has(t)));
  const { totals, votersCount } = tallyVotes(ballots, validTargets);
  const hidden = votesHidden(board);
  return {
    limit: board.settings.voteLimit,
    maxPerTarget: board.settings.maxVotesPerTarget,
    myVotes,
    myRemaining: Math.max(0, board.settings.voteLimit - votesSpent(myVotes)),
    totals: hidden ? null : totals,
    votersCount,
    hidden,
  };
}

/** Valid vote targets: ungrouped cards plus groups (votes go on the stack, not its members). */
export function voteTargets(cards: Pick<RetroCard, 'id' | 'groupId'>[], groups: Pick<CardGroup, 'id'>[]): Set<string> {
  const groupIds = new Set(groups.map((g) => g.id));
  const out = new Set<string>(groupIds);
  for (const c of cards) if (!c.groupId || !groupIds.has(c.groupId)) out.add(c.id);
  return out;
}

/* ------------------------------- mood ------------------------------- */

const MOOD_SCORE: Record<MoodKey, number> = Object.fromEntries(MOODS.map((m) => [m.key, m.score])) as Record<MoodKey, number>;

export function summariseMood(checkins: MoodCheckin[], viewer: AccountId | null): MoodSummary {
  const counts = emptyMoodCounts();
  let sum = 0;
  for (const c of checkins) {
    counts[c.mood]++;
    sum += MOOD_SCORE[c.mood];
  }
  return {
    counts,
    total: checkins.length,
    average: checkins.length ? Math.round((sum / checkins.length) * 100) / 100 : null,
    mine: viewer ? (checkins.find((c) => c.accountId === viewer)?.mood ?? null) : null,
  };
}

/* ------------------------------ topics ------------------------------ */

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'we', 'our']);

export function normaliseTopic(raw: string): string | null {
  const t = raw
    .toLowerCase()
    .replace(/[#*_`~>[\]()!]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .join(' ')
    .trim()
    .slice(0, 40);
  return t.length >= 2 ? t : null;
}

export function normaliseTag(raw: string): string | null {
  const t = raw.toLowerCase().trim().replace(/^#/, '').replace(/\s+/g, '-').replace(/[^a-z0-9\-_]/g, '').slice(0, 32);
  return t.length >= 2 ? t : null;
}

/* ------------------------------ summary ----------------------------- */

export function buildRetroSummary(args: {
  cards: RetroCard[];
  groups: CardGroup[];
  ballots: VoteBallot[];
  moods: MoodCheckin[];
  actionCount: number;
  now: number;
}): RetroSummary {
  const { cards, groups, ballots, moods, actionCount, now } = args;
  const participants = new Set<string>();
  for (const c of cards) participants.add(c.authorId);
  for (const b of ballots) if (votesSpent(b.votes) > 0) participants.add(b.accountId);
  for (const m of moods) participants.add(m.accountId);

  const topicCounts: Record<string, number> = {};
  const bump = (t: string | null) => {
    if (t) topicCounts[t] = (topicCounts[t] ?? 0) + 1;
  };
  for (const c of cards) for (const tag of c.tags) bump(normaliseTag(tag));
  for (const g of groups) bump(normaliseTopic(g.title));

  const mood = summariseMood(moods, null);
  return {
    cardCount: cards.length,
    groupCount: groups.length,
    participantCount: participants.size,
    voteCount: ballots.reduce((n, b) => n + votesSpent(b.votes), 0),
    actionCount,
    moodAverage: mood.average,
    moodCounts: mood.counts,
    topicCounts,
    closedAt: now,
  };
}
