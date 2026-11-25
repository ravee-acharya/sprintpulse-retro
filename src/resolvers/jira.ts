import type Resolver from '@forge/resolver';
import { AppError } from '../lib/errors';
import { id, int, oneOf, optId, str, strArray } from '../lib/validate';
import * as actions from '../services/actions';
import { getTeamAnalytics } from '../services/analytics';
import { getSnapshot } from '../services/retros';
import { buildConfluenceStorage } from '../shared/export';
import { getUsers, listIssueTypes, listSprints, searchAssignableUsers } from '../jira/jira';
import { listSpaces, publishPage } from '../jira/confluence';
import { rpc } from './rpc';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function optDate(p: Record<string, unknown>, key: string): string | null | undefined {
  const v = p[key];
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !ISO_DATE.test(v)) throw new AppError('BAD_REQUEST', `"${key}" must be YYYY-MM-DD.`);
  return v;
}

/** Jira account ids are opaque strings like "5b10a2844c20165700ede21g" or "712020:uuid". */
function optAccountId(p: Record<string, unknown>, key: string): string | null | undefined {
  const v = p[key];
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(v)) throw new AppError('BAD_REQUEST', `"${key}" is not a valid account id.`);
  return v;
}

export function registerJiraResolvers(r: Resolver): void {
  /* Jira lookups */
  rpc(r, 'jira.sprints', (_p, ctx) => listSprints(ctx.projectKey));
  rpc(r, 'jira.searchUsers', (p, ctx) => searchAssignableUsers(ctx.projectKey, str(p, 'query', { max: 80, optional: true }) ?? ''));
  rpc(r, 'jira.users', (p) => getUsers(strArray(p, 'accountIds', { maxItems: 100, maxLen: 128 })));
  rpc(r, 'jira.issueTypes', (_p, ctx) => listIssueTypes(ctx.projectKey));

  /* action items */
  rpc(r, 'actions.create', (p, ctx) =>
    actions.createAction(ctx, id(p, 'retroId'), {
      title: str(p, 'title', { min: 1, max: 255 }),
      description: str(p, 'description', { max: 4000, optional: true }) ?? '',
      assigneeAccountId: optAccountId(p, 'assigneeAccountId') ?? null,
      sourceCardId: optId(p, 'sourceCardId'),
      dueDate: optDate(p, 'dueDate') ?? null,
    }),
  );
  rpc(r, 'actions.update', (p, ctx) => {
    const title = str(p, 'title', { min: 1, max: 255, optional: true });
    const description = str(p, 'description', { max: 4000, optional: true });
    const assigneeAccountId = optAccountId(p, 'assigneeAccountId');
    const dueDate = optDate(p, 'dueDate');
    return actions.updateAction(ctx, id(p, 'actionId'), {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(assigneeAccountId !== undefined ? { assigneeAccountId } : {}),
      ...(dueDate !== undefined ? { dueDate } : {}),
      ...(p.status !== undefined ? { status: oneOf(p, 'status', ['open', 'done'] as const) } : {}),
    });
  });
  rpc(r, 'actions.delete', async (p, ctx) => {
    await actions.deleteAction(ctx, id(p, 'actionId'));
    return true;
  });
  rpc(r, 'actions.list', (p, ctx) =>
    actions.listActions(ctx, {
      retroId: optId(p, 'retroId'),
      status: oneOf(p, 'status', ['open', 'done', 'all'] as const, 'all'),
      cursor: str(p, 'cursor', { max: 2000, optional: true }),
      limit: int(p, 'limit', { min: 1, max: 100, fallback: 50 }),
    }),
  );
  rpc(r, 'actions.createIssue', (p, ctx) =>
    actions.createJiraIssueForAction(ctx, id(p, 'actionId'), {
      issueTypeId: str(p, 'issueTypeId', { min: 1, max: 32 }),
      sprintId: p.sprintId === undefined || p.sprintId === null ? null : int(p, 'sprintId', { min: 1 }),
    }),
  );
  rpc(r, 'actions.sync', (p, ctx) => actions.syncActions(ctx, { retroId: optId(p, 'retroId') }));

  /* analytics */
  rpc(r, 'analytics.team', (p, ctx) =>
    getTeamAnalytics(ctx, { limit: int(p, 'limit', { min: 1, max: 50, fallback: 12 }), refreshJira: p.refreshJira === true }),
  );

  /* Confluence export */
  rpc(r, 'confluence.spaces', (p) => listSpaces(str(p, 'query', { max: 80, optional: true }) ?? ''));
  rpc(r, 'confluence.publish', async (p, ctx) => {
    const retroId = id(p, 'retroId');
    const spaceKey = str(p, 'spaceKey', { min: 1, max: 255 });
    if (!/^[A-Za-z0-9~_-]+$/.test(spaceKey)) throw new AppError('BAD_REQUEST', 'Invalid space key.');
    const snapshot = await getSnapshot(ctx, retroId);
    const ids = new Set<string>();
    for (const c of snapshot.cards) {
      if (c.authorId) ids.add(c.authorId);
      for (const cm of c.comments) ids.add(cm.authorId);
    }
    for (const a of snapshot.actions) {
      ids.add(a.createdBy);
      if (a.assigneeAccountId) ids.add(a.assigneeAccountId);
    }
    const users = await getUsers([...ids]).catch(() => []);
    const names = new Map(users.map((u) => [u.accountId, u.displayName]));
    const xhtml = buildConfluenceStorage(snapshot, (aid) => (aid ? (names.get(aid) ?? 'Unknown user') : 'Anonymous'), str(p, 'siteUrl', { max: 200, optional: true }) ?? '');
    const title = str(p, 'title', { min: 1, max: 255, optional: true }) ?? snapshot.board.title;
    return publishPage({ spaceKey, title, storageXhtml: xhtml, parentId: str(p, 'parentId', { max: 32, optional: true }) ?? null });
  });
}
