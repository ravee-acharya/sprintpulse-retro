import type Resolver from '@forge/resolver';
import { LIMITS } from '../shared/catalog';
import { PHASE_ORDER, type SprintRef } from '../shared/types';
import { AppError } from '../lib/errors';
import { bool, id, int, obj, oneOf, optId, str, strArray } from '../lib/validate';
import * as retros from '../services/retros';
import { rpc, type Payload } from './rpc';

function sprintFrom(p: Payload): SprintRef | null {
  const s = p.sprint;
  if (s === undefined || s === null) return null;
  const o = obj(p, 'sprint');
  return {
    id: int(o, 'id', { min: 1 }),
    name: str(o, 'name', { min: 1, max: 120 }),
    state: oneOf(o, 'state', ['active', 'closed', 'future'] as const),
    boardId: int(o, 'boardId', { min: 1 }),
    ...(typeof o.startDate === 'string' ? { startDate: o.startDate } : {}),
    ...(typeof o.endDate === 'string' ? { endDate: o.endDate } : {}),
    ...(typeof o.completeDate === 'string' ? { completeDate: o.completeDate } : {}),
  };
}

export function registerRetroResolvers(r: Resolver): void {
  /* templates */
  rpc(r, 'templates.list', (_p, ctx) => retros.listTemplates(ctx));
  rpc(r, 'templates.save', (p, ctx) =>
    retros.saveTemplate(ctx, {
      id: optId(p, 'id'),
      name: str(p, 'name', { min: 1, max: 60 }),
      description: str(p, 'description', { max: 200, optional: true }) ?? '',
      theme: oneOf(p, 'theme', retros.THEMES, 'aurora'),
      columns: p.columns,
    }),
  );
  rpc(r, 'templates.delete', async (p, ctx) => {
    await retros.deleteTemplate(ctx, id(p, 'templateId'));
    return true;
  });

  /* retros */
  rpc(r, 'retros.create', (p, ctx) =>
    retros.createRetro(ctx, {
      title: str(p, 'title', { max: LIMITS.titleMax, optional: true }),
      templateId: str(p, 'templateId', { min: 1, max: 64 }),
      sprint: sprintFrom(p),
      settings: p.settings && typeof p.settings === 'object' ? (p.settings as Record<string, unknown>) : undefined,
      columns: p.columns,
      theme: p.theme === undefined ? undefined : oneOf(p, 'theme', retros.THEMES),
    }),
  );
  rpc(r, 'retros.list', (p, ctx) =>
    retros.listRetros(ctx, {
      query: str(p, 'query', { max: 80, optional: true }),
      status: oneOf(p, 'status', ['active', 'closed', 'archived', 'all'] as const, 'all'),
      cursor: str(p, 'cursor', { max: 2000, optional: true }),
      limit: int(p, 'limit', { min: 1, max: 100, fallback: 25 }),
    }),
  );
  rpc(r, 'retros.get', (p, ctx) => retros.getSnapshot(ctx, id(p, 'retroId')));
  rpc(r, 'retros.update', (p, ctx) =>
    retros.updateBoardMeta(ctx, id(p, 'retroId'), {
      title: str(p, 'title', { max: LIMITS.titleMax, optional: true }),
      theme: p.theme === undefined ? undefined : oneOf(p, 'theme', retros.THEMES),
      settings: p.settings && typeof p.settings === 'object' ? (p.settings as Record<string, unknown>) : undefined,
      facilitatorIds: p.facilitatorIds === undefined ? undefined : strArray(p, 'facilitatorIds', { maxItems: LIMITS.facilitatorsMax, maxLen: 128 }),
    }),
  );
  rpc(r, 'retros.updateColumns', (p, ctx) => retros.updateColumns(ctx, id(p, 'retroId'), p.columns, optId(p, 'moveOrphansTo') ?? undefined));
  rpc(r, 'retros.close', (p, ctx) => retros.closeRetro(ctx, id(p, 'retroId')));
  rpc(r, 'retros.reopen', (p, ctx) => retros.reopenRetro(ctx, id(p, 'retroId')));
  rpc(r, 'retros.archive', (p, ctx) => retros.archiveRetro(ctx, id(p, 'retroId'), bool(p, 'archived')));
  rpc(r, 'retros.delete', async (p, ctx) => {
    await retros.deleteRetro(ctx, id(p, 'retroId'));
    return true;
  });

  /* facilitator controls */
  rpc(r, 'facilitator.setPhase', (p, ctx) => retros.setPhase(ctx, id(p, 'retroId'), oneOf(p, 'phase', PHASE_ORDER)));
  rpc(r, 'facilitator.reveal', (p, ctx) => retros.setRevealed(ctx, id(p, 'retroId'), bool(p, 'revealed')));
  rpc(r, 'facilitator.closeVoting', (p, ctx) => retros.setVotingClosed(ctx, id(p, 'retroId'), bool(p, 'closed')));
  rpc(r, 'facilitator.timer', (p, ctx) => {
    const op = oneOf(p, 'op', ['start', 'pause', 'resume', 'reset', 'add'] as const);
    const cmd: retros.TimerCommand =
      op === 'start'
        ? { op, durationSec: int(p, 'durationSec', { min: 5, max: LIMITS.timerMaxSec }) }
        : op === 'add'
          ? { op, seconds: int(p, 'seconds', { min: -600, max: 1800 }) }
          : { op };
    return retros.controlTimer(ctx, id(p, 'retroId'), cmd);
  });
  rpc(r, 'facilitator.spotlight', (p, ctx) => {
    const t = p.target;
    const target = t ? { type: oneOf(obj(p, 'target'), 'type', ['card', 'group'] as const), id: id(obj(p, 'target'), 'id') } : null;
    return retros.setSpotlight(ctx, id(p, 'retroId'), target);
  });
  rpc(r, 'facilitator.music', (p, ctx) => {
    const volume = p.volume;
    if (volume !== undefined && (typeof volume !== 'number' || volume < 0 || volume > 1)) throw new AppError('BAD_REQUEST', 'Volume must be 0..1.');
    return retros.setMusic(ctx, id(p, 'retroId'), {
      trackId: optId(p, 'trackId'),
      playing: bool(p, 'playing'),
      ...(typeof volume === 'number' ? { volume } : {}),
    });
  });
  rpc(r, 'facilitator.icebreaker', (p, ctx) =>
    retros.setIcebreaker(ctx, id(p, 'retroId'), {
      mode: oneOf(p, 'mode', ['random', 'custom', 'clear'] as const),
      question: str(p, 'question', { max: 300, optional: true }),
      customQuestions:
        p.customQuestions === undefined ? undefined : strArray(p, 'customQuestions', { maxItems: LIMITS.customIcebreakers, maxLen: 300 }),
    }),
  );
}
