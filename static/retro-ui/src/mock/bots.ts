/**
 * Simulated teammates for the Local Mock Adapter: each tick, a random non-current user
 * does something appropriate to the current phase, through the real resolvers.
 */
import { MOODS } from '@shared/catalog';
import type { RetroSnapshot } from '@shared/types';
import { invokeAs } from './backend';
import { currentMockUser, MOCK_USERS } from './users';

const IDEAS: Record<string, string[]> = {
  generic: [
    'Daily stand-ups ran long most days',
    'Great pairing session on the **payments** refactor',
    'Too many context switches between projects',
    'CI pipeline was flaky again - lost hours to re-runs',
    'Loved the new design review format',
    'Requirements changed mid-sprint for the onboarding flow',
    'We should write more `integration tests`',
    'Release went out smoothly :rocket:',
    'Unclear ownership of the alerting backlog',
    'Shout-out to the support rotation for fast triage',
    'Story points felt inflated this sprint',
    'Docs for the API are out of date',
  ],
};

const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

export async function botTick(retroId: string): Promise<string | null> {
  // The first two mock users (facilitator + "Open as" tab) are driven by hand; bots are the rest.
  const me = currentMockUser().accountId;
  const bot = pick(MOCK_USERS.slice(2).filter((u) => u.accountId !== me));
  const res = await invokeAs<RetroSnapshot>(bot.accountId, 'retros.get', { retroId });
  if (!res.ok) return null;
  const s = res.data;
  const phase = s.board.facilitator.phase;
  const name = bot.displayName.split(' ')[0];

  if (!s.mood.mine && s.board.status === 'active') {
    await invokeAs(bot.accountId, 'mood.set', { retroId, mood: pick(MOODS).key, gifId: null, note: '' });
    return `${name} checked in`;
  }
  if (phase === 'brainstorm' || (phase === 'group' && Math.random() < 0.3)) {
    const col = pick(s.board.columns);
    await invokeAs(bot.accountId, 'cards.add', { retroId, columnId: col.id, text: pick(IDEAS.generic!), tags: [] });
    return `${name} added a card`;
  }
  if (phase === 'vote' && s.votes.myRemaining > 0) {
    const groupIds = new Set(s.groups.map((g) => g.id));
    const targets = [...s.groups.map((g) => g.id), ...s.cards.filter((c) => !c.groupId || !groupIds.has(c.groupId)).map((c) => c.id)];
    if (targets.length) {
      const r = await invokeAs(bot.accountId, 'votes.cast', { retroId, targetId: pick(targets), delta: 1 });
      return r.ok ? `${name} voted` : null;
    }
  }
  if (s.board.facilitator.revealed && s.cards.length && phase !== 'closed') {
    const c = pick(s.cards);
    if (Math.random() < 0.7) {
      await invokeAs(bot.accountId, 'cards.react', { retroId, cardId: c.id, emoji: pick(['👍', '🔥', '💯', '😂', '🎉']) });
      return `${name} reacted`;
    }
    await invokeAs(bot.accountId, 'cards.comment', { retroId, cardId: c.id, text: pick(['+1, same here', 'Agreed!', 'Can we dig into this?', 'This hit us too']) });
    return `${name} commented`;
  }
  return null;
}
