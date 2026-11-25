/**
 * Browser stand-in for `@forge/api` (mock mode only): a tiny fake Jira + Confluence that
 * answers exactly the REST calls the backend makes, so the real jira.ts/confluence.ts run.
 */
import { MOCK_PROJECT, MOCK_USERS } from './users';

const JIRA_KEY = 'sprintpulse-mock-jira';

interface MockIssue {
  id: string;
  key: string;
  summary: string;
  issueTypeId: string;
  statusIdx: number;
  assignee: string | null;
  sprintId: number | null;
}

const STATUSES = [
  { name: 'To Do', category: 'new' },
  { name: 'In Progress', category: 'indeterminate' },
  { name: 'Done', category: 'done' },
] as const;

const ISSUE_TYPES = [
  { id: '10001', name: 'Task', subtask: false },
  { id: '10002', name: 'Story', subtask: false },
  { id: '10003', name: 'Bug', subtask: false },
  { id: '10004', name: 'Sub-task', subtask: true },
];

const DAY = 86_400_000;
const sprintDates = (offsetSprints: number) => {
  const start = Date.now() + offsetSprints * 14 * DAY;
  return { startDate: new Date(start).toISOString(), endDate: new Date(start + 14 * DAY).toISOString() };
};
const SPRINTS = [
  ...[19, 20, 21, 22, 23].map((n, i) => ({ id: n, name: `Sprint ${n}`, state: 'closed', originBoardId: 1, ...sprintDates(i - 6), completeDate: sprintDates(i - 5).startDate })),
  { id: 24, name: 'Sprint 24', state: 'active', originBoardId: 1, ...sprintDates(-1) },
  { id: 25, name: 'Sprint 25', state: 'future', originBoardId: 1 },
];

function loadIssues(): MockIssue[] {
  return JSON.parse(localStorage.getItem(JIRA_KEY) ?? '[]') as MockIssue[];
}
function saveIssues(list: MockIssue[]): void {
  localStorage.setItem(JIRA_KEY, JSON.stringify(list));
}

/** Test hook: move a mock issue to its next status (used by the mock dev panel). */
export function advanceMockIssue(key: string): void {
  const list = loadIssues();
  const i = list.find((x) => x.key === key);
  if (i) i.statusIdx = Math.min(STATUSES.length - 1, i.statusIdx + 1);
  saveIssues(list);
}

const userJson = (id: string) => {
  const u = MOCK_USERS.find((x) => x.accountId === id);
  return u ? { accountId: u.accountId, displayName: u.displayName, accountType: 'atlassian', active: true, avatarUrls: {} } : null;
};

function respond(status: number, body?: unknown) {
  const text = body === undefined ? '' : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(text), json: () => Promise.resolve(body) };
}

async function handleJira(path: string, init?: { method?: string; body?: string }) {
  await new Promise((r) => setTimeout(r, 60 + Math.random() * 120));
  const url = new URL(path, 'https://mock.atlassian.net');
  const p = url.pathname;
  const q = url.searchParams;
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(init.body) : undefined;

  if (p === '/rest/agile/1.0/board') return respond(200, { values: [{ id: 1, type: 'scrum', name: `${MOCK_PROJECT.key} board` }] });

  const sprintList = p.match(/^\/rest\/agile\/1\.0\/board\/\d+\/sprint$/);
  if (sprintList) {
    const states = (q.get('state') ?? '').split(',');
    const startAt = Number(q.get('startAt') ?? 0);
    const values = SPRINTS.filter((s) => states.includes(s.state)).slice(startAt, startAt + 50);
    return respond(200, { values, isLast: true });
  }

  if (p === '/rest/api/3/user/assignable/search') {
    const term = (q.get('query') ?? '').toLowerCase();
    return respond(200, MOCK_USERS.filter((u) => u.displayName.toLowerCase().includes(term)).map((u) => userJson(u.accountId)));
  }

  if (p === '/rest/api/3/user/bulk') {
    return respond(200, { values: q.getAll('accountId').map(userJson).filter(Boolean) });
  }

  if (/^\/rest\/api\/3\/issue\/createmeta\/[^/]+\/issuetypes$/.test(p)) return respond(200, { issueTypes: ISSUE_TYPES });

  if (p === '/rest/api/3/issue' && method === 'POST') {
    const list = loadIssues();
    const n = list.length + 101;
    const f = body.fields;
    const issue: MockIssue = {
      id: String(20000 + n),
      key: `${MOCK_PROJECT.key}-${n}`,
      summary: f.summary,
      issueTypeId: f.issuetype.id,
      statusIdx: 0,
      assignee: f.assignee?.accountId ?? null,
      sprintId: null,
    };
    saveIssues([...list, issue]);
    return respond(201, { id: issue.id, key: issue.key });
  }

  const addToSprint = p.match(/^\/rest\/agile\/1\.0\/sprint\/(\d+)\/issue$/);
  if (addToSprint && method === 'POST') {
    const list = loadIssues();
    for (const k of body.issues as string[]) {
      const i = list.find((x) => x.key === k);
      if (i) i.sprintId = Number(addToSprint[1]);
    }
    saveIssues(list);
    return respond(204);
  }

  if (p === '/rest/api/3/search/jql' && method === 'POST') {
    const keys: string[] = String(body.jql).match(/[A-Z][A-Z0-9_]+-\d+/g) ?? [];
    const issues = loadIssues()
      .filter((i) => keys.includes(i.key))
      .map((i) => {
        const st = STATUSES[i.statusIdx]!;
        const a = i.assignee ? userJson(i.assignee) : null;
        return {
          id: i.id,
          key: i.key,
          fields: {
            status: { name: st.name, statusCategory: { key: st.category } },
            assignee: a ? { accountId: a.accountId, displayName: a.displayName } : null,
            issuetype: { name: ISSUE_TYPES.find((t) => t.id === i.issueTypeId)?.name ?? 'Task' },
          },
        };
      });
    return respond(200, { issues });
  }

  return respond(404, { errorMessages: [`Mock Jira has no handler for ${method} ${p}`] });
}

async function handleConfluence(path: string, init?: { method?: string; body?: string }) {
  await new Promise((r) => setTimeout(r, 100));
  const url = new URL(path, 'https://mock.atlassian.net');
  if (url.pathname === '/wiki/rest/api/space') {
    return respond(200, { results: [{ key: 'TEAM', name: 'Team Space' }, { key: 'ENG', name: 'Engineering' }] });
  }
  if (url.pathname === '/wiki/rest/api/content' && init?.method === 'POST') {
    const body = JSON.parse(init.body ?? '{}');
    const id = String(Date.now());
    localStorage.setItem(`sprintpulse-mock-confluence:${id}`, JSON.stringify(body));
    return respond(200, { id, _links: { base: 'https://mock.atlassian.net/wiki', webui: `/spaces/${body.space.key}/pages/${id}` } });
  }
  return respond(404, { message: 'Not found' });
}

export function route(strings: TemplateStringsArray, ...params: unknown[]): string {
  return strings.reduce((acc, s, i) => {
    if (i === 0) return s;
    const v = params[i - 1];
    const enc = v instanceof URLSearchParams ? v.toString() : encodeURIComponent(String(v));
    return acc + enc + s;
  }, '');
}

export const assumeTrustedRoute = (r: string) => r;

const client = {
  requestJira: (path: string, init?: { method?: string; body?: string }) => handleJira(path, init),
  requestConfluence: (path: string, init?: { method?: string; body?: string }) => handleConfluence(path, init),
};

const api = { asUser: () => client, asApp: () => client };
export default api;
