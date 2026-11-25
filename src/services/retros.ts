import { FilterConditions, Filter } from '@forge/kvs';
import { BUILT_IN_TEMPLATES, DEFAULT_SETTINGS, ICEBREAKER_DECK, LIMITS, TRACK_IDS } from '../shared/catalog';
import {
  buildRetroSummary,
  buildVoteSummary,
  summariseMood,
  toCardView,
  transitionPhase,
  voteTargets,
} from '../shared/rules';
import type {
  ColumnColor,
  FacilitatorState,
  RetroBoard,
  RetroColumn,
  RetroListItem,
  RetroPhase,
  RetroSettings,
  RetroSnapshot,
  RetroTemplate,
  SprintRef,
  ThemeKey,
} from '../shared/types';
import { retroChannel } from '../shared/events';
import { AppError } from '../lib/errors';
import { newId, type ReqContext } from '../lib/context';
import { actions, ballots, boards, cards, groups, INDEX, keys, moods, templates } from '../storage/entities';
import type { QueryFilter, StoredRecord } from '../storage/store';
import { publishProject, publishRetro, subscribeToken } from '../realtime/publisher';

export const COLUMN_COLORS: readonly ColumnColor[] = ['green', 'red', 'blue', 'yellow', 'purple', 'teal', 'orange', 'gray'];
export const THEMES: readonly ThemeKey[] = ['aurora', 'sunset', 'ocean', 'forest', 'sailboat', 'midnight', 'paper'];

/* ----------------------------- helpers ------------------------------ */

export async function loadBoard(ctx: ReqContext, retroId: string): Promise<RetroBoard> {
  return boards.require(keys.board(ctx.projectId, retroId), 'Retrospective');
}

export function isFacilitator(board: RetroBoard, accountId: string): boolean {
  return board.facilitatorIds.includes(accountId);
}

export function requireFacilitator(board: RetroBoard, accountId: string): void {
  if (!isFacilitator(board, accountId)) throw new AppError('FORBIDDEN', 'Only a facilitator can do that.');
}

export function requireOpen(board: RetroBoard): void {
  if (board.status !== 'active') throw new AppError('PHASE', 'This retrospective is closed.');
}

/**
 * Facilitator-only board mutation with optimistic locking + realtime broadcast.
 * `refetch` tells clients the change alters what they may see (phase/reveal/vote visibility).
 */
export async function facilitatorUpdate(
  ctx: ReqContext,
  retroId: string,
  mutate: (b: RetroBoard) => RetroBoard | void,
  opts: { refetch?: boolean; allowClosed?: boolean } = {},
): Promise<RetroBoard> {
  const updated = await boards.update(
    keys.board(ctx.projectId, retroId),
    (b) => {
      requireFacilitator(b, ctx.accountId);
      if (!opts.allowClosed) requireOpen(b);
      return mutate(b) ?? b;
    },
    'Retrospective',
  );
  await publishRetro(ctx.projectId, retroId, ctx.accountId, { type: 'board.updated', board: updated, refetch: !!opts.refetch });
  return updated;
}

function columnsFromTemplate(t: Pick<RetroTemplate, 'columns'>): RetroColumn[] {
  return t.columns.map((c, i) => ({ ...c, id: newId(), order: i }));
}

export function sanitizeColumns(raw: unknown, keepIds = false): RetroColumn[] {
  if (!Array.isArray(raw) || raw.length < LIMITS.columnsMin || raw.length > LIMITS.columnsMax) {
    throw new AppError('BAD_REQUEST', `A board needs ${LIMITS.columnsMin}-${LIMITS.columnsMax} columns.`);
  }
  return raw.map((c: Record<string, unknown>, i) => {
    const title = typeof c?.title === 'string' ? c.title.trim() : '';
    if (!title || title.length > LIMITS.columnTitleMax) throw new AppError('BAD_REQUEST', 'Every column needs a title (max 40 chars).');
    const color = COLUMN_COLORS.includes(c.color as ColumnColor) ? (c.color as ColumnColor) : 'gray';
    const id = keepIds && typeof c.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(c.id) ? c.id : newId();
    return {
      id,
      title,
      prompt: typeof c.prompt === 'string' ? c.prompt.trim().slice(0, 120) : '',
      color,
      emoji: typeof c.emoji === 'string' ? c.emoji.slice(0, 8) : '',
      order: i,
    };
  });
}

export function sanitizeSettings(raw: Record<string, unknown> | undefined, base: RetroSettings = DEFAULT_SETTINGS): RetroSettings {
  const s = { ...base };
  if (!raw) return s;
  if (typeof raw.anonymousByDefault === 'boolean') s.anonymousByDefault = raw.anonymousByDefault;
  if (typeof raw.allowAuthorToggleAnonymity === 'boolean') s.allowAuthorToggleAnonymity = raw.allowAuthorToggleAnonymity;
  if (typeof raw.hideVotesUntilClosed === 'boolean') s.hideVotesUntilClosed = raw.hideVotesUntilClosed;
  if (raw.defaultViewMode === 'board' || raw.defaultViewMode === 'focus') s.defaultViewMode = raw.defaultViewMode;
  if (Number.isInteger(raw.voteLimit)) s.voteLimit = Math.min(LIMITS.voteLimitMax, Math.max(1, raw.voteLimit as number));
  if (Number.isInteger(raw.maxVotesPerTarget)) s.maxVotesPerTarget = Math.max(1, raw.maxVotesPerTarget as number);
  s.maxVotesPerTarget = Math.min(s.maxVotesPerTarget, s.voteLimit);
  return s;
}

function initialFacilitatorState(): FacilitatorState {
  return {
    phase: 'icebreaker',
    revealed: false,
    votingClosed: false,
    spotlight: null,
    timer: null,
    music: { trackId: null, playing: false, startedAt: null, volume: 0.4 },
    icebreaker: null,
  };
}

function toListItem(b: RetroBoard): RetroListItem {
  return {
    id: b.id,
    title: b.title,
    status: b.status,
    templateId: b.templateId,
    sprintName: b.sprint?.name ?? null,
    phase: b.facilitator.phase,
    createdAt: b.createdAt,
    createdBy: b.createdBy,
    summary: b.summary,
  };
}

/* ----------------------------- templates ---------------------------- */

export async function listTemplates(ctx: ReqContext): Promise<RetroTemplate[]> {
  const custom = await templates.queryAll(INDEX.templatesByProject, [ctx.projectId], { max: 100 });
  return [...BUILT_IN_TEMPLATES, ...custom];
}

export async function resolveTemplate(ctx: ReqContext, templateId: string): Promise<RetroTemplate> {
  const builtIn = BUILT_IN_TEMPLATES.find((t) => t.id === templateId);
  if (builtIn) return builtIn;
  return templates.require(keys.template(ctx.projectId, templateId), 'Template');
}

export async function saveTemplate(
  ctx: ReqContext,
  input: { id?: string | null; name: string; description: string; theme: ThemeKey; columns: unknown },
): Promise<RetroTemplate> {
  const columns = sanitizeColumns(input.columns).map(({ id: _id, order: _order, ...c }) => c);
  const now = Date.now();
  if (input.id) {
    return templates.update(
      keys.template(ctx.projectId, input.id),
      (t) => ({ ...t, name: input.name, description: input.description, theme: input.theme, columns }),
      'Template',
    );
  }
  return templates.create({
    id: newId(),
    name: input.name,
    description: input.description,
    theme: input.theme,
    columns,
    builtIn: false,
    projectId: ctx.projectId,
    createdBy: ctx.accountId,
    createdAt: now,
  });
}

export async function deleteTemplate(ctx: ReqContext, templateId: string): Promise<void> {
  const t = await templates.require(keys.template(ctx.projectId, templateId), 'Template');
  if (t.createdBy !== ctx.accountId) throw new AppError('FORBIDDEN', 'Only the template author can delete it.');
  await templates.delete(keys.template(ctx.projectId, templateId));
}

/* ------------------------------ retros ------------------------------ */

export async function createRetro(
  ctx: ReqContext,
  input: { title?: string; templateId: string; sprint: SprintRef | null; settings?: Record<string, unknown>; columns?: unknown; theme?: ThemeKey },
): Promise<RetroBoard> {
  const template = await resolveTemplate(ctx, input.templateId);
  const now = Date.now();
  const title =
    input.title?.trim() ||
    (input.sprint ? `${input.sprint.name} Retrospective` : `Retrospective - ${new Date(now).toISOString().slice(0, 10)}`);
  const board: RetroBoard = {
    id: newId(),
    projectId: ctx.projectId,
    projectKey: ctx.projectKey,
    title: title.slice(0, LIMITS.titleMax),
    templateId: template.id,
    theme: input.theme ?? template.theme,
    columns: input.columns ? sanitizeColumns(input.columns) : columnsFromTemplate(template),
    sprint: input.sprint,
    settings: sanitizeSettings(input.settings),
    facilitator: initialFacilitatorState(),
    facilitatorIds: [ctx.accountId],
    status: 'active',
    createdAt: now,
    createdBy: ctx.accountId,
    updatedAt: now,
    version: 0,
    summary: null,
  };
  await boards.create(board, now);
  await publishProject(ctx.projectId, board.id);
  return board;
}

export async function listRetros(
  ctx: ReqContext,
  opts: { query?: string; status?: RetroBoard['status'] | 'all'; cursor?: string; limit?: number },
): Promise<{ items: RetroListItem[]; cursor: string | null }> {
  let filter: QueryFilter<RetroBoard> | undefined;
  const q = opts.query?.trim().toLowerCase();
  if (q || (opts.status && opts.status !== 'all')) {
    let f = new Filter<StoredRecord<RetroBoard>>().and(
      q ? 'titleLower' : 'status',
      q ? FilterConditions.contains(q) : FilterConditions.equalTo(opts.status as string),
    );
    if (q && opts.status && opts.status !== 'all') f = f.and('status', FilterConditions.equalTo(opts.status));
    filter = f;
  }
  const page = await boards.queryPage(INDEX.boardsByProject, [ctx.projectId], {
    sort: 'DESC',
    limit: opts.limit ?? 25,
    cursor: opts.cursor,
    filter,
  });
  return { items: page.items.map(toListItem), cursor: page.cursor };
}

export async function getSnapshot(ctx: ReqContext, retroId: string): Promise<RetroSnapshot> {
  const board = await loadBoard(ctx, retroId);
  const [cardList, groupList, ballotList, moodList, actionList, token] = await Promise.all([
    cards.queryAll(INDEX.byRetro, [retroId]),
    groups.queryAll(INDEX.byRetro, [retroId]),
    ballots.queryAll(INDEX.byRetro, [retroId]),
    moods.queryAll(INDEX.byRetro, [retroId]),
    actions.queryAll('by-retro', [retroId]),
    subscribeToken(ctx.projectId, retroId),
  ]);
  const targets = voteTargets(cardList, groupList);
  return {
    board,
    cards: cardList.map((c) => toCardView(c, board, ctx.accountId)),
    groups: groupList,
    votes: buildVoteSummary(board, ballotList, ctx.accountId, targets),
    mood: summariseMood(moodList, ctx.accountId),
    actions: actionList,
    viewer: { accountId: ctx.accountId, isFacilitator: isFacilitator(board, ctx.accountId) },
    realtime: { channel: retroChannel(retroId), token },
    serverTime: Date.now(),
  };
}

/* ------------------------- facilitator controls --------------------- */

const VISIBILITY_PHASES: ReadonlySet<RetroPhase> = new Set(['brainstorm', 'group', 'vote', 'actions']);

export async function setPhase(ctx: ReqContext, retroId: string, phase: RetroPhase): Promise<RetroBoard> {
  return facilitatorUpdate(
    ctx,
    retroId,
    (b) => {
      b.facilitator = transitionPhase(b.facilitator, phase);
    },
    { refetch: VISIBILITY_PHASES.has(phase) },
  );
}

export async function setRevealed(ctx: ReqContext, retroId: string, revealed: boolean): Promise<RetroBoard> {
  return facilitatorUpdate(ctx, retroId, (b) => void (b.facilitator.revealed = revealed), { refetch: true });
}

export async function setVotingClosed(ctx: ReqContext, retroId: string, closed: boolean): Promise<RetroBoard> {
  return facilitatorUpdate(ctx, retroId, (b) => void (b.facilitator.votingClosed = closed), { refetch: true });
}

export type TimerCommand = { op: 'start'; durationSec: number } | { op: 'pause' } | { op: 'resume' } | { op: 'reset' } | { op: 'add'; seconds: number };

export async function controlTimer(ctx: ReqContext, retroId: string, cmd: TimerCommand): Promise<RetroBoard> {
  return facilitatorUpdate(ctx, retroId, (b) => {
    const now = Date.now();
    const t = b.facilitator.timer;
    switch (cmd.op) {
      case 'start': {
        const d = Math.min(LIMITS.timerMaxSec, Math.max(5, Math.round(cmd.durationSec)));
        b.facilitator.timer = { durationSec: d, endsAt: now + d * 1000, pausedRemainingSec: null, startedBy: ctx.accountId };
        break;
      }
      case 'pause':
        if (t?.endsAt) b.facilitator.timer = { ...t, endsAt: null, pausedRemainingSec: Math.max(0, Math.round((t.endsAt - now) / 1000)) };
        break;
      case 'resume':
        if (t && t.pausedRemainingSec !== null) b.facilitator.timer = { ...t, endsAt: now + t.pausedRemainingSec * 1000, pausedRemainingSec: null };
        break;
      case 'add':
        if (t?.endsAt) b.facilitator.timer = { ...t, endsAt: Math.max(now, t.endsAt) + cmd.seconds * 1000, durationSec: t.durationSec + cmd.seconds };
        else if (t && t.pausedRemainingSec !== null) b.facilitator.timer = { ...t, pausedRemainingSec: t.pausedRemainingSec + cmd.seconds };
        break;
      case 'reset':
        b.facilitator.timer = null;
        break;
    }
  });
}

export async function setSpotlight(ctx: ReqContext, retroId: string, target: { type: 'card' | 'group'; id: string } | null): Promise<RetroBoard> {
  if (target) {
    const exists =
      target.type === 'card' ? await cards.get(keys.card(retroId, target.id)) : await groups.get(keys.group(retroId, target.id));
    if (!exists) throw new AppError('NOT_FOUND', 'Nothing to spotlight - it was removed.');
  }
  return facilitatorUpdate(ctx, retroId, (b) => {
    b.facilitator.spotlight = target ? { targetType: target.type, targetId: target.id, setBy: ctx.accountId, at: Date.now() } : null;
  });
}

export async function setMusic(ctx: ReqContext, retroId: string, music: { trackId: string | null; playing: boolean; volume?: number }): Promise<RetroBoard> {
  if (music.trackId && !TRACK_IDS.has(music.trackId)) throw new AppError('BAD_REQUEST', 'Unknown track.');
  return facilitatorUpdate(ctx, retroId, (b) => {
    const prev = b.facilitator.music;
    const sameTrack = prev.trackId === music.trackId;
    b.facilitator.music = {
      trackId: music.trackId,
      playing: music.playing && !!music.trackId,
      startedAt: music.playing ? (sameTrack && prev.playing ? prev.startedAt : Date.now()) : null,
      volume: music.volume === undefined ? prev.volume : Math.min(1, Math.max(0, music.volume)),
    };
  });
}

export async function setIcebreaker(
  ctx: ReqContext,
  retroId: string,
  input: { mode: 'random' | 'custom' | 'clear'; question?: string; customQuestions?: string[] },
): Promise<RetroBoard> {
  return facilitatorUpdate(ctx, retroId, (b) => {
    const custom = (input.customQuestions ?? b.facilitator.icebreaker?.customQuestions ?? []).slice(0, LIMITS.customIcebreakers);
    if (input.mode === 'clear') {
      b.facilitator.icebreaker = null;
      return;
    }
    if (input.mode === 'custom') {
      const q = input.question?.trim();
      if (!q) throw new AppError('BAD_REQUEST', 'Enter a question.');
      b.facilitator.icebreaker = { question: q.slice(0, 300), deckIndex: null, customQuestions: custom };
      return;
    }
    // random: draw from curated deck + custom questions, avoiding the current one
    const pool: Array<{ q: string; i: number | null }> = [...ICEBREAKER_DECK.map((q, i) => ({ q, i })), ...custom.map((q) => ({ q, i: null }))];
    const current = b.facilitator.icebreaker?.question;
    const choices = pool.length > 1 ? pool.filter((p) => p.q !== current) : pool;
    const pick = choices[Math.floor(Math.random() * choices.length)]!;
    b.facilitator.icebreaker = { question: pick.q, deckIndex: pick.i, customQuestions: custom };
  });
}

export async function updateBoardMeta(
  ctx: ReqContext,
  retroId: string,
  input: { title?: string; theme?: ThemeKey; settings?: Record<string, unknown>; facilitatorIds?: string[] },
): Promise<RetroBoard> {
  return facilitatorUpdate(
    ctx,
    retroId,
    (b) => {
      if (input.title !== undefined) {
        const t = input.title.trim();
        if (!t) throw new AppError('BAD_REQUEST', 'Title cannot be empty.');
        b.title = t.slice(0, LIMITS.titleMax);
      }
      if (input.theme) b.theme = input.theme;
      if (input.settings) b.settings = sanitizeSettings(input.settings, b.settings);
      if (input.facilitatorIds) {
        const ids = [...new Set(input.facilitatorIds)].slice(0, LIMITS.facilitatorsMax);
        if (!ids.length) throw new AppError('BAD_REQUEST', 'A retro needs at least one facilitator.');
        b.facilitatorIds = ids;
      }
    },
    { refetch: !!input.settings },
  );
}

/** Custom template builder on a live board: add / rename / reorder / recolour columns. */
export async function updateColumns(ctx: ReqContext, retroId: string, rawColumns: unknown, moveOrphansTo?: string): Promise<RetroBoard> {
  const next = sanitizeColumns(rawColumns, true);
  const nextIds = new Set(next.map((c) => c.id));
  const cardList = await cards.queryAll(INDEX.byRetro, [retroId]);
  const orphans = cardList.filter((c) => !nextIds.has(c.columnId));
  if (orphans.length) {
    if (!moveOrphansTo || !nextIds.has(moveOrphansTo)) {
      throw new AppError('BAD_REQUEST', `${orphans.length} card(s) are in a removed column - choose a column to move them to.`);
    }
  }
  const board = await facilitatorUpdate(ctx, retroId, (b) => void (b.columns = next));
  for (const c of orphans) {
    const moved = await cards.update(keys.card(retroId, c.id), (cur) => ({ ...cur, columnId: moveOrphansTo!, groupId: null }));
    await publishRetro(ctx.projectId, retroId, ctx.accountId, { type: 'card.upserted', card: toCardView(moved, board, null) });
  }
  if (orphans.length) {
    const groupList = await groups.queryAll(INDEX.byRetro, [retroId]);
    for (const g of groupList.filter((g) => !nextIds.has(g.columnId))) {
      await groups.delete(keys.group(retroId, g.id));
      await publishRetro(ctx.projectId, retroId, ctx.accountId, { type: 'group.deleted', groupId: g.id });
    }
  }
  return board;
}

export async function closeRetro(ctx: ReqContext, retroId: string): Promise<RetroBoard> {
  const [cardList, groupList, ballotList, moodList, actionList] = await Promise.all([
    cards.queryAll(INDEX.byRetro, [retroId]),
    groups.queryAll(INDEX.byRetro, [retroId]),
    ballots.queryAll(INDEX.byRetro, [retroId]),
    moods.queryAll(INDEX.byRetro, [retroId]),
    actions.queryAll('by-retro', [retroId]),
  ]);
  const summary = buildRetroSummary({
    cards: cardList,
    groups: groupList,
    ballots: ballotList,
    moods: moodList,
    actionCount: actionList.length,
    now: Date.now(),
  });
  const board = await facilitatorUpdate(
    ctx,
    retroId,
    (b) => {
      b.facilitator = transitionPhase(b.facilitator, 'closed');
      b.status = 'closed';
      b.summary = summary;
    },
    { refetch: true },
  );
  await publishProject(ctx.projectId, retroId);
  return board;
}

export async function reopenRetro(ctx: ReqContext, retroId: string): Promise<RetroBoard> {
  const board = await facilitatorUpdate(
    ctx,
    retroId,
    (b) => {
      b.status = 'active';
      b.facilitator = transitionPhase(b.facilitator, 'actions');
    },
    { refetch: true, allowClosed: true },
  );
  await publishProject(ctx.projectId, retroId);
  return board;
}

export async function archiveRetro(ctx: ReqContext, retroId: string, archived: boolean): Promise<RetroBoard> {
  const board = await facilitatorUpdate(
    ctx,
    retroId,
    (b) => {
      b.status = archived ? 'archived' : b.summary ? 'closed' : 'active';
    },
    { allowClosed: true, refetch: true },
  );
  await publishProject(ctx.projectId, retroId);
  return board;
}

/** Permanently removes a retro and everything in it (action items with Jira issues are kept). */
export async function deleteRetro(ctx: ReqContext, retroId: string): Promise<void> {
  const board = await loadBoard(ctx, retroId);
  requireFacilitator(board, ctx.accountId);
  const [cardList, groupList, ballotList, moodList, actionList] = await Promise.all([
    cards.queryAll(INDEX.byRetro, [retroId]),
    groups.queryAll(INDEX.byRetro, [retroId]),
    ballots.queryAll(INDEX.byRetro, [retroId]),
    moods.queryAll(INDEX.byRetro, [retroId]),
    actions.queryAll('by-retro', [retroId]),
  ]);
  await Promise.all([
    ...cardList.map((c) => cards.delete(keys.card(retroId, c.id))),
    ...groupList.map((g) => groups.delete(keys.group(retroId, g.id))),
    ...ballotList.map((b) => ballots.delete(keys.ballot(retroId, b.accountId))),
    ...moodList.map((m) => moods.delete(keys.mood(retroId, m.accountId))),
    ...actionList.filter((a) => !a.jira).map((a) => actions.delete(keys.action(ctx.projectId, a.id))),
  ]);
  await boards.delete(keys.board(ctx.projectId, retroId));
  await publishProject(ctx.projectId, retroId);
}

