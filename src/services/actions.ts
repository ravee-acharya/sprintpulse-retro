import { FilterConditions, Filter } from '@forge/kvs';
import type { ActionItem } from '../shared/types';
import { AppError } from '../lib/errors';
import { newId, type ReqContext } from '../lib/context';
import { actions, INDEX, keys } from '../storage/entities';
import type { StoredRecord } from '../storage/store';
import { publishRetro } from '../realtime/publisher';
import { addIssueToSprint, createIssue, getIssueSnapshots } from '../jira/jira';
import { isFacilitator, loadBoard } from './retros';

const pub = (ctx: ReqContext, a: ActionItem) => publishRetro(ctx.projectId, a.retroId, ctx.accountId, { type: 'action.upserted', action: a });

async function requireEditable(ctx: ReqContext, a: ActionItem): Promise<void> {
  if (a.createdBy === ctx.accountId) return;
  const board = await loadBoard(ctx, a.retroId).catch(() => null);
  if (board && isFacilitator(board, ctx.accountId)) return;
  if (a.assigneeAccountId === ctx.accountId) return;
  throw new AppError('FORBIDDEN', 'Only the creator, assignee or a facilitator can change this action.');
}

export async function createAction(
  ctx: ReqContext,
  retroId: string,
  input: { title: string; description: string; assigneeAccountId: string | null; sourceCardId: string | null; dueDate: string | null },
): Promise<ActionItem> {
  const board = await loadBoard(ctx, retroId);
  if (board.status === 'archived') throw new AppError('PHASE', 'This retrospective is archived.');
  const now = Date.now();
  const action: ActionItem = {
    id: newId(),
    projectId: ctx.projectId,
    retroId,
    title: input.title,
    description: input.description,
    assigneeAccountId: input.assigneeAccountId,
    sourceCardId: input.sourceCardId,
    dueDate: input.dueDate,
    status: 'open',
    jira: null,
    createdBy: ctx.accountId,
    createdAt: now,
    updatedAt: now,
    version: 0,
  };
  await actions.create(action, now);
  await pub(ctx, action);
  return action;
}

export async function updateAction(
  ctx: ReqContext,
  actionId: string,
  input: Partial<Pick<ActionItem, 'title' | 'description' | 'assigneeAccountId' | 'dueDate' | 'status'>>,
): Promise<ActionItem> {
  const key = keys.action(ctx.projectId, actionId);
  await requireEditable(ctx, await actions.require(key, 'Action item'));
  const updated = await actions.update(
    key,
    (a) => {
      if (input.title !== undefined) a.title = input.title;
      if (input.description !== undefined) a.description = input.description;
      if (input.assigneeAccountId !== undefined) a.assigneeAccountId = input.assigneeAccountId;
      if (input.dueDate !== undefined) a.dueDate = input.dueDate;
      if (input.status !== undefined) {
        if (a.jira) throw new AppError('BAD_REQUEST', 'Status follows the linked Jira issue - change it in Jira.');
        a.status = input.status;
      }
      return a;
    },
    'Action item',
  );
  await pub(ctx, updated);
  return updated;
}

export async function deleteAction(ctx: ReqContext, actionId: string): Promise<void> {
  const key = keys.action(ctx.projectId, actionId);
  const a = await actions.require(key, 'Action item');
  await requireEditable(ctx, a);
  await actions.delete(key);
  await publishRetro(ctx.projectId, a.retroId, ctx.accountId, { type: 'action.deleted', actionId });
}

/**
 * One-click "push to Jira": creates the issue as the current user, optionally drops it into
 * a sprint, and links key/status/assignee back onto the action item.
 */
export async function createJiraIssueForAction(
  ctx: ReqContext,
  actionId: string,
  input: { issueTypeId: string; sprintId: number | null },
): Promise<ActionItem> {
  const key = keys.action(ctx.projectId, actionId);
  const a = await actions.require(key, 'Action item');
  if (a.jira) throw new AppError('CONFLICT', `Already linked to ${a.jira.issueKey}.`);
  await requireEditable(ctx, a);
  const board = await loadBoard(ctx, a.retroId);

  const created = await createIssue({
    projectId: ctx.projectId,
    issueTypeId: input.issueTypeId,
    summary: a.title,
    description: a.description,
    assigneeAccountId: a.assigneeAccountId,
    dueDate: a.dueDate,
    labels: ['retro-action', 'sprintpulse'],
    footer: `Action item from "${board.title}" (SprintPulse Retro).`,
  });

  let sprintWarning: string | null = null;
  if (input.sprintId) {
    try {
      await addIssueToSprint(input.sprintId, created.key);
    } catch (e) {
      sprintWarning = e instanceof Error ? e.message : String(e);
      console.warn('[sprintpulse] could not add issue to sprint', created.key, e);
    }
  }

  const snap = (await getIssueSnapshots([created.key]).catch(() => new Map())).get(created.key);
  const linked = await actions.update(
    key,
    (cur) => {
      cur.jira = {
        issueId: created.id,
        issueKey: created.key,
        url: `/browse/${created.key}`,
        issueType: snap?.issueType ?? '',
        status: snap?.status ?? 'To Do',
        statusCategory: snap?.statusCategory ?? 'new',
        assigneeAccountId: snap?.assigneeAccountId ?? cur.assigneeAccountId,
        assigneeName: snap?.assigneeName ?? null,
        syncedAt: Date.now(),
      };
      cur.status = cur.jira.statusCategory === 'done' ? 'done' : 'open';
      return cur;
    },
    'Action item',
  );
  await pub(ctx, linked);
  if (sprintWarning) console.warn('[sprintpulse] sprint warning', sprintWarning);
  return linked;
}

export async function listActions(
  ctx: ReqContext,
  opts: { retroId?: string | null; status?: 'open' | 'done' | 'all'; cursor?: string; limit?: number },
): Promise<{ items: ActionItem[]; cursor: string | null }> {
  const filter =
    opts.status && opts.status !== 'all' ? new Filter<StoredRecord<ActionItem>>().and('status', FilterConditions.equalTo(opts.status)) : undefined;
  if (opts.retroId) {
    const items = await actions.queryAll('by-retro', [opts.retroId], { filter });
    return { items: items.filter((a) => a.projectId === ctx.projectId), cursor: null };
  }
  const page = await actions.queryPage(INDEX.actionsByProject, [ctx.projectId], { sort: 'DESC', limit: opts.limit ?? 50, cursor: opts.cursor, filter });
  return page;
}

/**
 * Pull live status/assignee from Jira for linked action items and persist changes.
 * Returns the refreshed items. Issues the user can't see are left untouched.
 */
export async function syncActions(ctx: ReqContext, opts: { retroId?: string | null }): Promise<ActionItem[]> {
  const all = opts.retroId
    ? await actions.queryAll('by-retro', [opts.retroId])
    : await actions.queryAll(INDEX.actionsByProject, [ctx.projectId], { sort: 'DESC', max: 300 });
  const linked = all.filter((a) => a.jira && a.projectId === ctx.projectId);
  if (!linked.length) return all;

  const snaps = await getIssueSnapshots(linked.map((a) => a.jira!.issueKey));
  const byId = new Map(all.map((a) => [a.id, a]));
  for (const a of linked) {
    const s = snaps.get(a.jira!.issueKey);
    if (!s) continue;
    const j = a.jira!;
    const changed = j.status !== s.status || j.assigneeAccountId !== s.assigneeAccountId || j.statusCategory !== s.statusCategory;
    if (!changed) continue;
    const updated = await actions.update(keys.action(ctx.projectId, a.id), (cur) => {
      cur.jira = { ...cur.jira!, ...s, url: cur.jira!.url, syncedAt: Date.now() };
      cur.status = s.statusCategory === 'done' ? 'done' : 'open';
      cur.assigneeAccountId = s.assigneeAccountId;
      return cur;
    });
    byId.set(a.id, updated);
    await pub(ctx, updated);
  }
  return [...byId.values()];
}
