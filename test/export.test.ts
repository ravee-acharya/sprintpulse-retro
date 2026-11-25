import { describe, expect, it } from 'vitest';
import { buildConfluenceStorage, buildCsv, buildMarkdown } from '../src/shared/export';
import type { CardView, RetroSnapshot } from '../src/shared/types';
import { DEFAULT_SETTINGS } from '../src/shared/catalog';

const cardView = (over: Partial<CardView>): CardView => ({
  id: 'c',
  retroId: 'r',
  columnId: 'start',
  authorId: null,
  anonymous: true,
  text: '',
  gifId: null,
  groupId: null,
  order: 0,
  reactions: {},
  comments: [],
  tags: [],
  createdAt: 0,
  updatedAt: 0,
  version: 1,
  masked: false,
  maskedLength: 0,
  isMine: false,
  ...over,
});

const snapshot: RetroSnapshot = {
  board: {
    id: 'r',
    projectId: '1',
    projectKey: 'DEMO',
    title: 'Sprint 24 Retrospective',
    templateId: 'start-stop-continue',
    theme: 'aurora',
    columns: [
      { id: 'start', title: 'Start', prompt: '', color: 'green', emoji: '🚀', order: 0 },
      { id: 'stop', title: 'Stop', prompt: '', color: 'red', emoji: '🛑', order: 1 },
    ],
    sprint: { id: 24, name: 'Sprint 24', state: 'closed', boardId: 1 },
    settings: DEFAULT_SETTINGS,
    facilitator: {
      phase: 'actions',
      revealed: true,
      votingClosed: true,
      spotlight: null,
      timer: null,
      music: { trackId: null, playing: false, startedAt: null, volume: 0.4 },
      icebreaker: null,
    },
    facilitatorIds: ['f'],
    status: 'active',
    createdAt: Date.UTC(2026, 10, 20),
    createdBy: 'f',
    updatedAt: 0,
    version: 3,
    summary: null,
  },
  cards: [
    cardView({ id: 'c1', text: 'Pair more', authorId: 'alice', anonymous: false }),
    cardView({ id: 'c2', text: '=HYPERLINK("http://evil")', columnId: 'stop' }),
    cardView({ id: 'c3', masked: true, text: '', maskedLength: 10 }),
    cardView({ id: 'c4', text: 'Late <deploys>', groupId: 'g1', columnId: 'stop' }),
    cardView({ id: 'c5', text: 'Friday deploys', groupId: 'g1', columnId: 'stop' }),
  ],
  groups: [{ id: 'g1', retroId: 'r', columnId: 'stop', title: 'Deploy pain', order: 0, createdBy: 'f', createdAt: 0, version: 1 }],
  votes: { limit: 5, maxPerTarget: 3, myVotes: {}, myRemaining: 5, totals: { g1: 4, c1: 1 }, votersCount: 3, hidden: false },
  mood: { counts: { great: 1, good: 1, okay: 0, meh: 0, rough: 0 }, average: 4.5, total: 2, mine: null },
  actions: [
    {
      id: 'a1',
      projectId: '1',
      retroId: 'r',
      title: 'Freeze Friday deploys',
      description: '',
      assigneeAccountId: 'bob',
      sourceCardId: null,
      dueDate: '2026-12-01',
      status: 'open',
      jira: { issueId: '1', issueKey: 'DEMO-7', url: '/browse/DEMO-7', issueType: 'Task', status: 'In Progress', statusCategory: 'indeterminate', assigneeAccountId: 'bob', assigneeName: 'Bob', syncedAt: 0 },
      createdBy: 'f',
      createdAt: 0,
      updatedAt: 0,
      version: 1,
    },
  ],
  viewer: { accountId: 'f', isFacilitator: true },
  realtime: { channel: 'x', token: null },
  serverTime: 0,
};

const names = (id: string | null) => ({ alice: 'Alice', bob: 'Bob', f: 'Fran' })[id ?? ''] ?? 'Anonymous';

describe('exports', () => {
  it('markdown: groups ranked by votes, masked cards omitted, actions with Jira keys', () => {
    const md = buildMarkdown(snapshot, names);
    expect(md).toContain('# Sprint 24 Retrospective');
    expect(md).toContain('- **Deploy pain** **(4 votes)**');
    expect(md).toContain('- Pair more **(1 vote)** - _Alice_');
    expect(md).toContain('- [ ] Freeze Friday deploys - Bob · due 2026-12-01 [DEMO-7 · In Progress]');
    expect(md.indexOf('Deploy pain')).toBeLessThan(md.indexOf('=HYPERLINK'));
    // 4 metadata bullets + 3 visible entries + 1 action; masked c3 contributes nothing.
    expect(md.match(/^- /gm)?.length).toBe(8);
  });

  it("never attributes anonymous cards, even the exporter's own", () => {
    const mine = { ...snapshot, cards: [cardView({ id: 'm', text: 'my anon idea', authorId: 'f', anonymous: true, isMine: true })] };
    expect(buildMarkdown(mine, names)).not.toContain('Fran');
    expect(buildCsv(mine, names)).toContain('"my anon idea","Anonymous"');
  });

  it('csv: neutralises formula injection and quotes every cell', () => {
    const csv = buildCsv(snapshot, names);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv.split('\r\n')[0]).toBe('"Type","Column","Group","Text","Author","Votes","Reactions","Comments","Assignee","Jira","Status","Due"');
    expect(csv).toContain('"Action","","","Freeze Friday deploys","Fran"');
  });

  it('confluence: escapes HTML and links Jira issues', () => {
    const x = buildConfluenceStorage(snapshot, names, 'https://acme.atlassian.net');
    expect(x).toContain('Late &lt;deploys&gt;');
    expect(x).toContain('<a href="https://acme.atlassian.net/browse/DEMO-7">DEMO-7</a>');
  });
});
