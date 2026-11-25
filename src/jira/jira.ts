/**
 * Jira REST calls, always made *as the current user* so Jira's own permissions apply
 * (a user can only see sprints, users and issues they could see in Jira itself).
 */
import api, { route, type Route } from '@forge/api';
import type { JiraIssueLink, JiraIssueType, JiraUser, SprintRef } from '../shared/types';
import { AppError } from '../lib/errors';

type Json = Record<string, any>;

async function jira<T = Json>(path: Route, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await api.asUser().requestJira(path, {
    method: init?.method ?? 'GET',
    headers: { Accept: 'application/json', ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as Json) : {};
  if (!res.ok) {
    const msgs = [...(data.errorMessages ?? []), ...Object.values(data.errors ?? {})].filter(Boolean);
    const msg = msgs.length ? msgs.join(' ') : `Jira responded ${res.status}`;
    if (res.status === 401 || res.status === 403) throw new AppError('FORBIDDEN', msg);
    if (res.status === 404) throw new AppError('NOT_FOUND', msg);
    throw new AppError('JIRA_ERROR', msg);
  }
  return data as T;
}

/* ------------------------------ sprints ----------------------------- */

interface AgileSprint {
  id: number;
  name: string;
  state: 'active' | 'closed' | 'future';
  originBoardId?: number;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
}

const toSprintRef = (s: AgileSprint, boardId: number): SprintRef => ({
  id: s.id,
  name: s.name,
  state: s.state,
  boardId: s.originBoardId ?? boardId,
  ...(s.startDate ? { startDate: s.startDate } : {}),
  ...(s.endDate ? { endDate: s.endDate } : {}),
  ...(s.completeDate ? { completeDate: s.completeDate } : {}),
});

/** Active, future and the most recently closed sprints across the project's scrum boards. */
export async function listSprints(projectKey: string, recentClosed = 6): Promise<SprintRef[]> {
  const boards = await jira<{ values: Array<{ id: number; type: string }> }>(
    route`/rest/agile/1.0/board?projectKeyOrId=${projectKey}&maxResults=10`,
  ).catch((e) => {
    // Business/JWM projects have no boards - not an error for us.
    if (e instanceof AppError && (e.code === 'NOT_FOUND' || e.code === 'JIRA_ERROR')) return { values: [] };
    throw e;
  });
  const scrumBoards = boards.values.filter((b) => b.type === 'scrum').slice(0, 3);

  const byId = new Map<number, SprintRef>();
  await Promise.all(
    scrumBoards.map(async (b) => {
      const open = await jira<{ values: AgileSprint[] }>(route`/rest/agile/1.0/board/${b.id}/sprint?state=active,future&maxResults=50`);
      for (const s of open.values) byId.set(s.id, toSprintRef(s, b.id));

      // Closed sprints come oldest-first; page to the end (bounded) and keep the tail.
      const closed: AgileSprint[] = [];
      for (let startAt = 0, pages = 0; pages < 10; pages++) {
        const page = await jira<{ values: AgileSprint[]; isLast: boolean }>(
          route`/rest/agile/1.0/board/${b.id}/sprint?state=closed&startAt=${startAt}&maxResults=50`,
        );
        closed.push(...page.values);
        if (page.isLast || !page.values.length) break;
        startAt += page.values.length;
      }
      for (const s of closed.slice(-recentClosed)) byId.set(s.id, toSprintRef(s, b.id));
    }),
  );

  const rank = { active: 0, future: 1, closed: 2 } as const;
  return [...byId.values()].sort(
    (a, b) =>
      rank[a.state] - rank[b.state] ||
      (b.completeDate ?? b.endDate ?? b.startDate ?? '').localeCompare(a.completeDate ?? a.endDate ?? a.startDate ?? ''),
  );
}

/* ------------------------------- users ------------------------------ */

export async function searchAssignableUsers(projectKey: string, query: string): Promise<JiraUser[]> {
  const users = await jira<Array<{ accountId: string; displayName: string; accountType: string; active: boolean; avatarUrls?: Record<string, string> }>>(
    route`/rest/api/3/user/assignable/search?project=${projectKey}&query=${query}&maxResults=20`,
  );
  return users
    .filter((u) => u.active && u.accountType === 'atlassian')
    .map((u) => ({ accountId: u.accountId, displayName: u.displayName, avatarUrl: u.avatarUrls?.['48x48'] ?? null }));
}

export async function getUsers(accountIds: string[]): Promise<JiraUser[]> {
  const ids = [...new Set(accountIds)].slice(0, 100);
  if (!ids.length) return [];
  const out: JiraUser[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const params = new URLSearchParams({ maxResults: '50' });
    for (const id of chunk) params.append('accountId', id);
    const page = await jira<{ values: Array<{ accountId: string; displayName: string; avatarUrls?: Record<string, string> }> }>(
      route`/rest/api/3/user/bulk?${params}`,
    );
    for (const u of page.values) out.push({ accountId: u.accountId, displayName: u.displayName, avatarUrl: u.avatarUrls?.['48x48'] ?? null });
  }
  return out;
}

/* ------------------------------- issues ----------------------------- */

export async function listIssueTypes(projectKey: string): Promise<JiraIssueType[]> {
  const data = await jira<{ issueTypes?: Array<{ id: string; name: string; iconUrl?: string; subtask: boolean }>; values?: Array<{ id: string; name: string; iconUrl?: string; subtask: boolean }> }>(
    route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes?maxResults=50`,
  );
  const list = data.issueTypes ?? data.values ?? [];
  return list.filter((t) => !t.subtask).map((t) => ({ id: t.id, name: t.name, iconUrl: t.iconUrl ?? null, subtask: t.subtask }));
}

/** Minimal Atlassian Document Format from plain/markdown-ish text: one paragraph per line. */
function adf(text: string, footer?: string): Json {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const content: Json[] = lines.map((l) => ({ type: 'paragraph', content: [{ type: 'text', text: l }] }));
  if (footer) content.push({ type: 'paragraph', content: [{ type: 'text', text: footer, marks: [{ type: 'em' }] }] });
  return { type: 'doc', version: 1, content: content.length ? content : [{ type: 'paragraph', content: [] }] };
}

export async function createIssue(input: {
  projectId: string;
  issueTypeId: string;
  summary: string;
  description: string;
  assigneeAccountId: string | null;
  dueDate: string | null;
  labels: string[];
  footer: string;
}): Promise<{ id: string; key: string }> {
  const fields: Json = {
    project: { id: input.projectId },
    issuetype: { id: input.issueTypeId },
    summary: input.summary.slice(0, 255),
    description: adf(input.description, input.footer),
    labels: input.labels,
  };
  if (input.assigneeAccountId) fields.assignee = { accountId: input.assigneeAccountId };
  if (input.dueDate) fields.duedate = input.dueDate;
  try {
    return await jira<{ id: string; key: string }>(route`/rest/api/3/issue`, { method: 'POST', body: { fields } });
  } catch (e) {
    // Some screens omit due date/labels - retry with the essentials only.
    if (e instanceof AppError && e.code === 'JIRA_ERROR' && (fields.duedate || fields.labels)) {
      delete fields.duedate;
      delete fields.labels;
      return jira<{ id: string; key: string }>(route`/rest/api/3/issue`, { method: 'POST', body: { fields } });
    }
    throw e;
  }
}

export async function addIssueToSprint(sprintId: number, issueKey: string): Promise<void> {
  await jira(route`/rest/agile/1.0/sprint/${sprintId}/issue`, { method: 'POST', body: { issues: [issueKey] } });
}

type IssueSnapshot = Omit<JiraIssueLink, 'url' | 'issueType'> & { issueType: string };

/** Current status + assignee for up to 100 issues (one JQL call per 50 keys). */
export async function getIssueSnapshots(issueKeys: string[]): Promise<Map<string, IssueSnapshot>> {
  const out = new Map<string, IssueSnapshot>();
  const uniq = [...new Set(issueKeys)].filter((k) => /^[A-Z][A-Z0-9_]+-\d+$/.test(k));
  for (let i = 0; i < uniq.length; i += 50) {
    const chunk = uniq.slice(i, i + 50);
    const data = await jira<{ issues: Array<{ id: string; key: string; fields: Json }> }>(route`/rest/api/3/search/jql`, {
      method: 'POST',
      body: { jql: `key in (${chunk.join(',')})`, fields: ['status', 'assignee', 'issuetype'], maxResults: 50 },
    });
    for (const issue of data.issues ?? []) {
      const cat = issue.fields.status?.statusCategory?.key as string | undefined;
      out.set(issue.key, {
        issueId: issue.id,
        issueKey: issue.key,
        issueType: issue.fields.issuetype?.name ?? '',
        status: issue.fields.status?.name ?? 'Unknown',
        statusCategory: cat === 'new' || cat === 'indeterminate' || cat === 'done' ? cat : 'unknown',
        assigneeAccountId: issue.fields.assignee?.accountId ?? null,
        assigneeName: issue.fields.assignee?.displayName ?? null,
        syncedAt: Date.now(),
      });
    }
  }
  return out;
}
