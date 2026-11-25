/**
 * Service-level tests against the in-memory KVS fake: concurrency, privacy of realtime
 * payloads, grouping, and phase/permission rules.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { createFakeKvs, type EntitySchema } from './fakeKvs';

// Enforce the real manifest's entity attribute types (incl. 32-bit integers) in the fake KVS.
const manifest = parse(readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8')) as {
  app: { storage: { entities: Array<{ name: string; attributes: Record<string, { type: string }> }> } };
};
const SCHEMA: EntitySchema = Object.fromEntries(
  manifest.app.storage.entities.map((e) => [e.name, Object.fromEntries(Object.entries(e.attributes).map(([a, d]) => [a, d.type]))]),
) as EntitySchema;

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof import('./fakeKvs').createFakeKvs> | null }));
const published = vi.hoisted(() => [] as Array<{ channel: string; payload: any }>);

vi.mock('@forge/kvs', async () => {
  const real = await vi.importActual<typeof import('@forge/kvs')>('@forge/kvs');
  const proxy = {
    entity: (n: string) => fake.current!.kvs.entity(n),
    transact: () => fake.current!.kvs.transact(),
  };
  return { ...real, default: proxy, kvs: proxy };
});

vi.mock('@forge/realtime', () => ({
  Jira: { Project: 'project' },
  publish: vi.fn((channel: string, payload: unknown) => {
    published.push({ channel, payload });
    return Promise.resolve({ eventId: '1', eventTimestamp: '1' });
  }),
  signRealtimeToken: vi.fn(() => Promise.resolve({ token: 'tok', expiresAt: Date.now() + 600_000 })),
}));

vi.mock('@forge/api', () => ({ default: {}, route: () => '', assumeTrustedRoute: () => '' }));

const { createRetro, getSnapshot, setPhase, setRevealed, closeRetro } = await import('../src/services/retros');
const { addCard, groupCards, toggleReaction, deleteCard } = await import('../src/services/cards');
const { castVote, setMood } = await import('../src/services/votes');
const { createAction } = await import('../src/services/actions');
const { reqContext } = await import('../src/lib/context');

const ctxFor = (accountId: string) => reqContext({ accountId, extension: { project: { id: '10001', key: 'DEMO' } } });
const fac = ctxFor('facilitator');
const alice = ctxFor('alice');
const bob = ctxFor('bob');

async function newRetro() {
  const board = await createRetro(fac, { templateId: 'start-stop-continue', sprint: null, settings: { voteLimit: 3, maxVotesPerTarget: 3 } });
  await setPhase(fac, board.id, 'brainstorm');
  return board;
}

beforeEach(() => {
  fake.current = createFakeKvs(SCHEMA);
  published.length = 0;
});

describe('trusted context', () => {
  it('rejects calls without a project or account', () => {
    expect(() => reqContext({ extension: { project: { id: '1', key: 'X' } } })).toThrow(/logged in/);
    expect(() => reqContext({ accountId: 'a' })).toThrow(/Jira project/);
  });
});

describe('retro lifecycle', () => {
  it('names retros after the sprint and makes the creator facilitator', async () => {
    const b = await createRetro(fac, {
      templateId: 'sailboat',
      sprint: { id: 24, name: 'Sprint 24', state: 'closed', boardId: 1 },
    });
    expect(b.title).toBe('Sprint 24 Retrospective');
    expect(b.columns.map((c) => c.title)).toEqual(['Wind', 'Anchor', 'Rocks', 'Island']);
    expect(b.facilitatorIds).toEqual(['facilitator']);
    expect(b.version).toBe(1);
  });

  it('only facilitators can drive phases', async () => {
    const b = await newRetro();
    await expect(setPhase(alice, b.id, 'vote')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('private brainstorm', () => {
  it('never publishes or returns another user’s unrevealed card text', async () => {
    const b = await newRetro();
    const col = b.columns[0]!.id;
    await addCard(alice, b.id, { columnId: col, text: 'secret thought', gifId: null, tags: [] });

    expect(JSON.stringify(published)).not.toContain('secret thought');
    expect(JSON.stringify(published)).not.toContain('alice'); // not as author, not as actor

    const bobView = await getSnapshot(bob, b.id);
    expect(bobView.cards[0]).toMatchObject({ masked: true, text: '' });
    const aliceView = await getSnapshot(alice, b.id);
    expect(aliceView.cards[0]).toMatchObject({ masked: false, text: 'secret thought', isMine: true });

    await setRevealed(fac, b.id, true);
    expect((await getSnapshot(bob, b.id)).cards[0]).toMatchObject({ masked: false, text: 'secret thought', authorId: null });
  });

  it('blocks reactions until reveal', async () => {
    const b = await newRetro();
    const c = await addCard(alice, b.id, { columnId: b.columns[0]!.id, text: 'x', gifId: null, tags: [] });
    await expect(toggleReaction(bob, b.id, c.id, '👍')).rejects.toMatchObject({ code: 'PHASE' });
  });
});

describe('concurrency', () => {
  it('many users adding cards at once all land (no shared hot record)', async () => {
    const b = await newRetro();
    const col = b.columns[1]!.id;
    const users = Array.from({ length: 25 }, (_, i) => ctxFor(`user${i}`));
    await Promise.all(users.map((u, i) => addCard(u, b.id, { columnId: col, text: `card ${i}`, gifId: null, tags: [] })));
    expect((await getSnapshot(fac, b.id)).cards).toHaveLength(25);
  });

  it('concurrent reactions on one card are all kept (optimistic lock + retry)', async () => {
    const b = await newRetro();
    const c = await addCard(alice, b.id, { columnId: b.columns[0]!.id, text: 'hot card', gifId: null, tags: [] });
    await setRevealed(fac, b.id, true);
    const users = Array.from({ length: 5 }, (_, i) => ctxFor(`r${i}`));
    await Promise.all(users.map((u) => toggleReaction(u, b.id, c.id, '🔥')));
    const snap = await getSnapshot(alice, b.id);
    expect(snap.cards[0]!.reactions['🔥']!.sort()).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
    expect(fake.current!.stats.conflicts).toBeGreaterThan(0); // proves the retry path ran
  });

  it('a user spamming votes in parallel can never exceed the vote limit', async () => {
    const b = await newRetro();
    const c = await addCard(alice, b.id, { columnId: b.columns[0]!.id, text: 'vote me', gifId: null, tags: [] });
    await setPhase(fac, b.id, 'vote');
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => castVote(bob, b.id, c.id, 1)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(results.filter((r) => r.status === 'rejected').every((r) => r.status === 'rejected' && (r.reason as { code?: string }).code === 'VOTE_LIMIT')).toBe(true);
  });

  it('hides vote totals in realtime events until voting closes', async () => {
    const b = await newRetro();
    const c = await addCard(alice, b.id, { columnId: b.columns[0]!.id, text: 'v', gifId: null, tags: [] });
    await setPhase(fac, b.id, 'vote');
    await castVote(bob, b.id, c.id, 1);
    const voteEvents = published.map((p) => p.payload.event).filter((e) => e.type === 'votes.updated');
    expect(voteEvents.at(-1)).toEqual({ type: 'votes.updated', totals: null, votersCount: 1 });
  });
});

describe('grouping', () => {
  it('stacks two cards into a new group, joins a third, and dissolves on delete', async () => {
    const b = await newRetro();
    const [c1, c2] = b.columns;
    const a = await addCard(alice, b.id, { columnId: c1!.id, text: 'flaky CI', gifId: null, tags: [] });
    const x = await addCard(bob, b.id, { columnId: c2!.id, text: 'CI is slow', gifId: null, tags: [] });
    const y = await addCard(bob, b.id, { columnId: c2!.id, text: 'builds fail', gifId: null, tags: [] });
    await setPhase(fac, b.id, 'group');

    const { group } = await groupCards(bob, b.id, x.id, { type: 'card', id: a.id });
    expect(group.title).toBe('flaky CI');
    await groupCards(bob, b.id, y.id, { type: 'group', id: group.id });

    let snap = await getSnapshot(fac, b.id);
    expect(snap.groups).toHaveLength(1);
    expect(snap.cards.filter((c) => c.groupId === group.id)).toHaveLength(3);
    expect(snap.cards.every((c) => c.columnId === c1!.id)).toBe(true);

    await deleteCard(bob, b.id, x.id);
    await deleteCard(bob, b.id, y.id);
    snap = await getSnapshot(fac, b.id);
    expect(snap.groups).toHaveLength(0);
    expect(snap.cards[0]!.groupId).toBeNull();
  });
});

describe('closing', () => {
  it('stores a summary that analytics can use without re-reading cards', async () => {
    const b = await newRetro();
    await addCard(alice, b.id, { columnId: b.columns[0]!.id, text: 'a', gifId: null, tags: ['deploys'] });
    await setMood(bob, b.id, { mood: 'good', gifId: null, note: '' });
    await createAction(fac, b.id, { title: 'Fix CI', description: '', assigneeAccountId: null, sourceCardId: null, dueDate: null });
    const closed = await closeRetro(fac, b.id);
    expect(closed.status).toBe('closed');
    expect(closed.summary).toMatchObject({ cardCount: 1, participantCount: 2, actionCount: 1, moodAverage: 4, topicCounts: { deploys: 1 } });
    await expect(addCard(alice, b.id, { columnId: b.columns[0]!.id, text: 'late', gifId: null, tags: [] })).rejects.toMatchObject({ code: 'PHASE' });
  });
});
