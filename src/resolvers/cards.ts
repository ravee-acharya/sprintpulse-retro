import type Resolver from '@forge/resolver';
import { LIMITS, MOOD_KEYS } from '../shared/catalog';
import { AppError } from '../lib/errors';
import { id, int, obj, oneOf, optId, str, strArray } from '../lib/validate';
import * as cards from '../services/cards';
import * as votes from '../services/votes';
import { rpc } from './rpc';

export function registerCardResolvers(r: Resolver): void {
  rpc(r, 'cards.add', (p, ctx) =>
    cards.addCard(ctx, id(p, 'retroId'), {
      columnId: id(p, 'columnId'),
      text: str(p, 'text', { max: LIMITS.cardTextMax, optional: true }) ?? '',
      anonymous: typeof p.anonymous === 'boolean' ? p.anonymous : undefined,
      gifId: optId(p, 'gifId'),
      tags: strArray(p, 'tags', { maxItems: LIMITS.tagsPerCard, maxLen: LIMITS.tagMax }),
    }),
  );
  rpc(r, 'cards.edit', (p, ctx) =>
    cards.editCard(ctx, id(p, 'retroId'), id(p, 'cardId'), {
      text: str(p, 'text', { max: LIMITS.cardTextMax, optional: true }),
      gifId: p.gifId === undefined ? undefined : optId(p, 'gifId'),
      tags: p.tags === undefined ? undefined : strArray(p, 'tags', { maxItems: LIMITS.tagsPerCard, maxLen: LIMITS.tagMax }),
      anonymous: typeof p.anonymous === 'boolean' ? p.anonymous : undefined,
    }),
  );
  rpc(r, 'cards.delete', async (p, ctx) => {
    await cards.deleteCard(ctx, id(p, 'retroId'), id(p, 'cardId'));
    return true;
  });
  rpc(r, 'cards.move', (p, ctx) =>
    cards.moveCard(ctx, id(p, 'retroId'), id(p, 'cardId'), id(p, 'columnId'), int(p, 'order', { min: 0, max: Number.MAX_SAFE_INTEGER })),
  );
  rpc(r, 'cards.group', (p, ctx) => {
    const t = obj(p, 'target');
    return cards.groupCards(ctx, id(p, 'retroId'), id(p, 'cardId'), { type: oneOf(t, 'type', ['card', 'group'] as const), id: id(t, 'id') });
  });
  rpc(r, 'cards.ungroup', (p, ctx) => cards.ungroupCard(ctx, id(p, 'retroId'), id(p, 'cardId')));
  rpc(r, 'groups.update', (p, ctx) =>
    cards.updateGroup(ctx, id(p, 'retroId'), id(p, 'groupId'), {
      title: str(p, 'title', { max: 60, optional: true }),
      columnId: optId(p, 'columnId') ?? undefined,
      order: p.order === undefined ? undefined : int(p, 'order', { min: 0, max: Number.MAX_SAFE_INTEGER }),
    }),
  );
  rpc(r, 'cards.react', (p, ctx) => cards.toggleReaction(ctx, id(p, 'retroId'), id(p, 'cardId'), str(p, 'emoji', { min: 1, max: LIMITS.reactionEmojiMaxLen })));
  rpc(r, 'cards.comment', (p, ctx) => cards.addComment(ctx, id(p, 'retroId'), id(p, 'cardId'), str(p, 'text', { min: 1, max: LIMITS.commentMax })));
  rpc(r, 'cards.deleteComment', (p, ctx) => cards.deleteComment(ctx, id(p, 'retroId'), id(p, 'cardId'), id(p, 'commentId')));

  /* voting & mood */
  rpc(r, 'votes.cast', (p, ctx) => {
    const delta = p.delta;
    if (delta !== 1 && delta !== -1) throw new AppError('BAD_REQUEST', '"delta" must be 1 or -1.');
    return votes.castVote(ctx, id(p, 'retroId'), id(p, 'targetId'), delta);
  });
  rpc(r, 'votes.summary', (p, ctx) => votes.getVoteSummary(ctx, id(p, 'retroId')));
  rpc(r, 'votes.reset', async (p, ctx) => {
    await votes.resetVotes(ctx, id(p, 'retroId'));
    return true;
  });
  rpc(r, 'mood.set', (p, ctx) =>
    votes.setMood(ctx, id(p, 'retroId'), {
      mood: oneOf(p, 'mood', MOOD_KEYS),
      gifId: optId(p, 'gifId'),
      note: str(p, 'note', { max: 280, optional: true }) ?? '',
    }),
  );
}
