/**
 * Mock-only: seed a realistic retro history (Sprints 19-22) through the real resolvers,
 * so History, Action items and Team health have data to show. Afterwards the boards are
 * back-dated directly in mock storage so the trend spans ~2 months.
 */
import type { ActionItem, MoodKey, RetroBoard, SprintRef } from '@shared/types';
import { advanceMockIssue } from './forge-api';
import { invokeAs } from './backend';
import { MOCK_USERS } from './users';

const FAC = 'mock-facilitator';
const DAY = 86_400_000;

async function ok<T>(accountId: string, fn: string, payload: Record<string, unknown>): Promise<T> {
  const r = await invokeAs<T>(accountId, fn, payload);
  if (!r.ok) throw new Error(`${fn}: ${r.error.message}`);
  return r.data;
}

const PLAN: Array<{ sprint: number; template: string; moods: MoodKey[]; cards: Array<[number, string]>; actions: Array<{ title: string; assignee: number; jira: boolean; progress: number }> }> = [
  {
    sprint: 19,
    template: 'start-stop-continue',
    moods: ['meh', 'okay', 'rough', 'meh', 'okay'],
    cards: [[0, 'Flaky #ci pipeline blocked merges twice'], [1, 'Too many meetings, no focus time #focus'], [2, 'Pairing on onboarding was great'], [1, 'Unclear #requirements for the billing epic']],
    actions: [
      { title: 'Quarantine flaky CI tests', assignee: 2, jira: true, progress: 2 },
      { title: 'Introduce no-meeting Wednesdays', assignee: 0, jira: true, progress: 2 },
    ],
  },
  {
    sprint: 20,
    template: 'mad-sad-glad',
    moods: ['okay', 'okay', 'meh', 'good', 'okay'],
    cards: [[0, 'Still waiting on #ci fixes'], [2, 'Shipped the export feature!'], [3, 'Scope creep from stakeholders #requirements'], [1, 'Glad about the new design system']],
    actions: [
      { title: 'Define acceptance criteria template', assignee: 3, jira: true, progress: 2 },
      { title: 'Weekly CI health review', assignee: 2, jira: true, progress: 1 },
      { title: 'Share demo recordings with support', assignee: 1, jira: false, progress: 0 },
    ],
  },
  {
    sprint: 21,
    template: '4ls',
    moods: ['good', 'okay', 'good', 'great', 'good'],
    cards: [[1, 'Liked the focus Wednesdays #focus'], [0, 'Learned a lot about observability'], [3, 'Lacked a staging environment'], [2, 'Longed for faster #ci builds']],
    actions: [
      { title: 'Provision a shared staging env', assignee: 4, jira: true, progress: 1 },
      { title: 'Cache dependencies in CI', assignee: 2, jira: true, progress: 2 },
    ],
  },
  {
    sprint: 22,
    template: 'sailboat',
    moods: ['great', 'good', 'good', 'great', 'okay'],
    cards: [[2, 'Wind: CI is finally fast'], [3, 'Anchor: on-call noise'], [0, 'Rocks: holiday capacity'], [1, 'Island: launch v2 #roadmap']],
    actions: [
      { title: 'Tune paging thresholds', assignee: 3, jira: true, progress: 0 },
      { title: 'Plan holiday cover rota', assignee: 0, jira: false, progress: 0 },
    ],
  },
];

export async function seedDemoHistory(onProgress?: (msg: string) => void): Promise<void> {
  const team = MOCK_USERS.slice(1); // everyone but the facilitator
  const sprints = await ok<SprintRef[]>(FAC, 'jira.sprints', {});
  const types = await ok<Array<{ id: string; name: string }>>(FAC, 'jira.issueTypes', {});
  const task = types.find((t) => t.name === 'Task') ?? types[0]!;
  const now = Date.now();

  for (const [i, p] of PLAN.entries()) {
    onProgress?.(`Seeding Sprint ${p.sprint}...`);
    const sprint = sprints.find((s) => s.id === p.sprint) ?? null;
    const board = await ok<RetroBoard>(FAC, 'retros.create', { templateId: p.template, sprint });
    const id = board.id;
    await ok(FAC, 'facilitator.setPhase', { retroId: id, phase: 'brainstorm' });
    for (const [k, mood] of p.moods.entries()) await ok(team[k % team.length]!.accountId, 'mood.set', { retroId: id, mood, gifId: null, note: '' });
    for (const [k, [col, text]] of p.cards.entries()) {
      const tags = [...text.matchAll(/#([a-z-]+)/g)].map((m) => m[1]!);
      await ok(team[k % team.length]!.accountId, 'cards.add', { retroId: id, columnId: board.columns[col % board.columns.length]!.id, text, tags });
    }
    await ok(FAC, 'facilitator.setPhase', { retroId: id, phase: 'actions' });
    for (const a of p.actions) {
      const item = await ok<ActionItem>(FAC, 'actions.create', { retroId: id, title: a.title, description: '', assigneeAccountId: team[a.assignee]!.accountId, sourceCardId: null, dueDate: null });
      if (a.jira) {
        const linked = await ok<ActionItem>(FAC, 'actions.createIssue', { actionId: item.id, issueTypeId: task.id, sprintId: null });
        for (let n = 0; n < a.progress; n++) advanceMockIssue(linked.jira!.issueKey);
      } else if (a.progress > 1) {
        await ok(FAC, 'actions.update', { actionId: item.id, status: 'done' });
      }
    }
    await ok(FAC, 'actions.sync', { retroId: id });
    await ok(FAC, 'retros.close', { retroId: id });

    // Back-date: one retro every 14 days, oldest first.
    const when = now - (PLAN.length - i) * 14 * DAY;
    const key = `sprintpulse-mock-kvs:sp-board|retro:${board.projectId}:${id}`;
    const rec = JSON.parse(localStorage.getItem(key)!);
    rec.createdAt = when;
    rec.doc.createdAt = when;
    if (rec.doc.summary) rec.doc.summary.closedAt = when + 3_600_000;
    localStorage.setItem(key, JSON.stringify(rec));
  }
  onProgress?.('Demo history ready');
}

/** Move every mock Jira issue one status forward (To Do -> In Progress -> Done). */
export function progressAllMockIssues(): number {
  const list = JSON.parse(localStorage.getItem('sprintpulse-mock-jira') ?? '[]') as Array<{ key: string }>;
  for (const i of list) advanceMockIssue(i.key);
  return list.length;
}
