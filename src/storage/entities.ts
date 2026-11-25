/**
 * Entity definitions and key scheme. Entity names, attributes and indexes must stay in
 * sync with `app.storage.entities` in manifest.yml.
 *
 * Keys:
 *   retro:{projectId}:{retroId}           board (facilitator state, columns, settings)
 *   card:{retroId}:{cardId}               one record per card
 *   group:{retroId}:{groupId}             one record per card stack
 *   ballot:{retroId}:{accountId}          one record per voter (only that voter writes it)
 *   mood:{retroId}:{accountId}            one record per check-in
 *   actions:{projectId}:{actionId}        action items (project-wide backlog of retro actions)
 *   template:{projectId}:{templateId}     custom templates
 *
 * The per-project retro index (`retro:index:{projectId}` in the original spec) is the
 * `by-project` KVS index on sp-board rather than a hand-maintained list document,
 * which would be a write hot-spot every time a retro is created.
 */
import type { ActionItem, CardGroup, MoodCheckin, RetroBoard, RetroCard, RetroTemplate, VoteBallot } from '../shared/types';
import { EntityStore } from './store';

export const keys = {
  board: (projectId: string, retroId: string) => `retro:${projectId}:${retroId}`,
  card: (retroId: string, cardId: string) => `card:${retroId}:${cardId}`,
  group: (retroId: string, groupId: string) => `group:${retroId}:${groupId}`,
  ballot: (retroId: string, accountId: string) => `ballot:${retroId}:${accountId}`,
  mood: (retroId: string, accountId: string) => `mood:${retroId}:${accountId}`,
  action: (projectId: string, actionId: string) => `actions:${projectId}:${actionId}`,
  template: (projectId: string, templateId: string) => `template:${projectId}:${templateId}`,
};

export const boards = new EntityStore<RetroBoard>({
  name: 'sp-board',
  key: (b) => keys.board(b.projectId, b.id),
  indexAttrs: (b) => ({ projectId: b.projectId, createdAt: b.createdAt, status: b.status, titleLower: b.title.toLowerCase() }),
});

export const cards = new EntityStore<RetroCard>({
  name: 'sp-card',
  key: (c) => keys.card(c.retroId, c.id),
  indexAttrs: (c) => ({ retroId: c.retroId, createdAt: c.createdAt }),
});

export const groups = new EntityStore<CardGroup>({
  name: 'sp-group',
  key: (g) => keys.group(g.retroId, g.id),
  indexAttrs: (g) => ({ retroId: g.retroId, createdAt: g.createdAt }),
});

export const ballots = new EntityStore<VoteBallot>({
  name: 'sp-ballot',
  key: (b) => keys.ballot(b.retroId, b.accountId),
  indexAttrs: (b) => ({ retroId: b.retroId, accountId: b.accountId }),
});

export const moods = new EntityStore<MoodCheckin>({
  name: 'sp-mood',
  key: (m) => keys.mood(m.retroId, m.accountId),
  indexAttrs: (m) => ({ retroId: m.retroId, projectId: m.projectId, accountId: m.accountId, createdAt: m.at }),
});

export const actions = new EntityStore<ActionItem>({
  name: 'sp-action',
  key: (a) => keys.action(a.projectId, a.id),
  indexAttrs: (a) => ({ projectId: a.projectId, retroId: a.retroId, createdAt: a.createdAt, status: a.status }),
});

export const templates = new EntityStore<RetroTemplate>({
  name: 'sp-template',
  key: (t) => keys.template(t.projectId ?? '', t.id),
  indexAttrs: (t) => ({ projectId: t.projectId ?? '', createdAt: t.createdAt ?? 0 }),
});

export const INDEX = {
  boardsByProject: 'by-project',
  byRetro: 'by-retro',
  actionsByProject: 'by-project',
  templatesByProject: 'by-project',
} as const;
