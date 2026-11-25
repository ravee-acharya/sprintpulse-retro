import { GIF_IDS, LIMITS } from '../shared/catalog';
import { canCreateCards, canGroup, canReactOrComment, normaliseTag, toCardView } from '../shared/rules';
import type { CardGroup, CardView, RetroBoard, RetroCard } from '../shared/types';
import { AppError } from '../lib/errors';
import { newId, type ReqContext } from '../lib/context';
import { cards, groups, INDEX, keys } from '../storage/entities';
import { atomic } from '../storage/store';
import { publishRetro } from '../realtime/publisher';
import { isFacilitator, loadBoard, requireOpen } from './retros';

const pub = (ctx: ReqContext, retroId: string, card: RetroCard, board: RetroBoard) =>
  publishRetro(ctx.projectId, retroId, ctx.accountId, { type: 'card.upserted', card: toCardView(card, board, null) });

function cleanTags(tags: string[]): string[] {
  return [...new Set(tags.map(normaliseTag).filter((t): t is string => !!t))].slice(0, LIMITS.tagsPerCard);
}

function requireColumn(board: RetroBoard, columnId: string): void {
  if (!board.columns.some((c) => c.id === columnId)) throw new AppError('BAD_REQUEST', 'Unknown column.');
}

function requireGif(gifId: string | null): void {
  if (gifId && !GIF_IDS.has(gifId)) throw new AppError('BAD_REQUEST', 'Unknown GIF.');
}

/* ------------------------------- CRUD ------------------------------- */

export async function addCard(
  ctx: ReqContext,
  retroId: string,
  input: { columnId: string; text: string; anonymous?: boolean; gifId: string | null; tags: string[] },
): Promise<CardView> {
  const board = await loadBoard(ctx, retroId);
  requireOpen(board);
  if (!canCreateCards(board.facilitator, isFacilitator(board, ctx.accountId))) {
    throw new AppError('PHASE', 'Cards can be added during Brainstorm and Group phases.');
  }
  requireColumn(board, input.columnId);
  requireGif(input.gifId);
  if (!input.text && !input.gifId) throw new AppError('BAD_REQUEST', 'A card needs text or a GIF.');

  const anonymous =
    board.settings.allowAuthorToggleAnonymity && input.anonymous !== undefined ? input.anonymous : board.settings.anonymousByDefault;
  const now = Date.now();
  const card: RetroCard = {
    id: newId(),
    retroId,
    columnId: input.columnId,
    authorId: ctx.accountId,
    anonymous,
    text: input.text,
    gifId: input.gifId,
    groupId: null,
    order: now, // append; clients sort by (order, createdAt)
    reactions: {},
    comments: [],
    tags: cleanTags(input.tags),
    createdAt: now,
    updatedAt: now,
    version: 0,
  };
  await cards.create(card, now);
  await pub(ctx, retroId, card, board);
  return toCardView(card, board, ctx.accountId);
}

export async function editCard(
  ctx: ReqContext,
  retroId: string,
  cardId: string,
  input: { text?: string; gifId?: string | null; tags?: string[]; anonymous?: boolean },
): Promise<CardView> {
  const board = await loadBoard(ctx, retroId);
  requireOpen(board);
  if (input.gifId !== undefined) requireGif(input.gifId);
  const card = await cards.update(
    keys.card(retroId, cardId),
    (c) => {
      if (c.authorId !== ctx.accountId) throw new AppError('FORBIDDEN', 'You can only edit your own cards.');
      if (input.text !== undefined) c.text = input.text;
      if (input.gifId !== undefined) c.gifId = input.gifId;
      if (!c.text && !c.gifId) throw new AppError('BAD_REQUEST', 'A card needs text or a GIF.');
      if (input.tags !== undefined) c.tags = cleanTags(input.tags);
      if (input.anonymous !== undefined) {
        if (!board.settings.allowAuthorToggleAnonymity) throw new AppError('FORBIDDEN', 'The facilitator has locked anonymity.');
        c.anonymous = input.anonymous;
      }
      return c;
    },
    'Card',
  );
  await pub(ctx, retroId, card, board);
  return toCardView(card, board, ctx.accountId);
}

export async function deleteCard(ctx: ReqContext, retroId: string, cardId: string): Promise<void> {
  const board = await loadBoard(ctx, retroId);
  requireOpen(board);
  const card = await cards.require(keys.card(retroId, cardId), 'Card');
  if (card.authorId !== ctx.accountId && !isFacilitator(board, ctx.accountId)) {
    throw new AppError('FORBIDDEN', 'Only the author or a facilitator can delete a card.');
  }
  await cards.delete(keys.card(retroId, cardId));
  await publishRetro(ctx.projectId, retroId, ctx.accountId, { type: 'card.deleted', cardId });
  if (card.groupId) await dissolveGroupIfSmall(ctx, retroId, card.groupId, board);
}

/** Move within/between columns. Leaving a group's column ungroups the card. */
export async function moveCard(ctx: ReqContext, retroId: string, cardId: string, columnId: string, order: number): Promise<CardView> {
  const board = await loadBoard(ctx, retroId);
  requireOpen(board);
  requireColumn(board, columnId);
  const fac = isFacilitator(board, ctx.accountId);
  let leftGroup: string | null = null;
  const card = await cards.update(
    keys.card(retroId, cardId),
    (c) => {
      const mineInBrainstorm = c.authorId === ctx.accountId && board.facilitator.phase === 'brainstorm';
      if (!mineInBrainstorm && !canGroup(board.facilitator, fac)) throw new AppError('PHASE', 'Cards can be rearranged in the Group phase.');
      if (c.groupId && c.columnId !== columnId) {
        leftGroup = c.groupId;
        c.groupId = null;
      }
      c.columnId = columnId;
      c.order = order;
      return c;
    },
    'Card',
  );
  await pub(ctx, retroId, card, board);
  if (leftGroup) await dissolveGroupIfSmall(ctx, retroId, leftGroup, board);
  return toCardView(card, board, ctx.accountId);
}

/* ----------------------------- grouping ----------------------------- */

/**
 * Drop `sourceCardId` onto a card or a group.
 *  - onto a group: the card joins it (and moves to the group's column);
 *  - onto an ungrouped card: a new group is created holding both;
 *  - onto a grouped card: the source joins that card's group.
 * Committed as one KVS transaction guarded by both cards' versions.
 */
export async function groupCards(
  ctx: ReqContext,
  retroId: string,
  sourceCardId: string,
  target: { type: 'card' | 'group'; id: string },
): Promise<{ group: CardGroup; cards: CardView[] }> {
  const board = await loadBoard(ctx, retroId);
  requireOpen(board);
  if (!canGroup(board.facilitator, isFacilitator(board, ctx.accountId))) throw new AppError('PHASE', 'Grouping happens in the Group phase.');
  if (target.type === 'card' && target.id === sourceCardId) throw new AppError('BAD_REQUEST', 'Cannot group a card with itself.');

  let previousGroup: string | null = null;
  let result: { group: CardGroup; cards: RetroCard[] } | null = null;

  if (target.type === 'group') {
    await atomic<[RetroCard, CardGroup]>(
      [
        { store: cards, key: keys.card(retroId, sourceCardId) },
        { store: groups, key: keys.group(retroId, target.id) },
      ],
      ([src, grp]) => {
        if (!src) throw new AppError('NOT_FOUND', 'Card not found.');
        if (!grp) throw new AppError('NOT_FOUND', 'Group not found.');
        previousGroup = src.groupId && src.groupId !== grp.id ? src.groupId : null;
        src.groupId = grp.id;
        src.columnId = grp.columnId;
        src.order = Date.now();
        result = { group: grp, cards: [src] };
        return { sets: [{ store: cards, doc: src }] };
      },
    );
  } else {
    const now = Date.now();
    const newGroupId = newId();
    await atomic<[RetroCard, RetroCard]>(
      [
        { store: cards, key: keys.card(retroId, sourceCardId) },
        { store: cards, key: keys.card(retroId, target.id) },
      ],
      ([src, dst]) => {
        if (!src || !dst) throw new AppError('NOT_FOUND', 'Card not found.');
        previousGroup = src.groupId && src.groupId !== dst.groupId ? src.groupId : null;
        if (dst.groupId) {
          // Join the existing stack; group record is only read, the card carries the link.
          src.groupId = dst.groupId;
          src.columnId = dst.columnId;
          src.order = now;
          result = { group: { id: dst.groupId } as CardGroup, cards: [src] };
          return { sets: [{ store: cards, doc: src }] };
        }
        const group: CardGroup = {
          id: newGroupId,
          retroId,
          columnId: dst.columnId,
          title: (dst.text || 'Untitled group').replace(/\s+/g, ' ').slice(0, 60),
          order: dst.order,
          createdBy: ctx.accountId,
          createdAt: now,
          version: 0,
        };
        dst.groupId = group.id;
        src.groupId = group.id;
        src.columnId = dst.columnId;
        src.order = now;
        result = { group, cards: [dst, src] };
        return {
          sets: [
            { store: groups, doc: group },
            { store: cards, doc: dst },
            { store: cards, doc: src },
          ],
        };
      },
      now,
    );
  }

  const r = result as { group: CardGroup; cards: RetroCard[] } | null;
  if (!r) throw new AppError('INTERNAL', 'Grouping failed.');
  // Joining an existing group via a card: load the real group record for the response.
  const group = r.group.retroId ? r.group : await groups.require(keys.group(retroId, r.group.id), 'Group');
  if (r.group.retroId && r.cards.length === 2) {
    await publishRetro(ctx.projectId, retroId, ctx.accountId, { type: 'group.upserted', group });
  }
  for (const c of r.cards) await pub(ctx, retroId, c, board);
  if (previousGroup) await dissolveGroupIfSmall(ctx, retroId, previousGroup, board);
  return { group, cards: r.cards.map((c) => toCardView(c, board, ctx.accountId)) };
}

export async function ungroupCard(ctx: ReqContext, retroId: string, cardId: string): Promise<CardView> {
  const board = await loadBoard(ctx, retroId);
  requireOpen(board);
  if (!canGroup(board.facilitator, isFacilitator(board, ctx.accountId))) throw new AppError('PHASE', 'Grouping happens in the Group phase.');
  let groupId: string | null = null;
  const card = await cards.update(
    keys.card(retroId, cardId),
    (c) => {
      groupId = c.groupId;
      if (!groupId) return null;
      c.groupId = null;
      c.order = Date.now();
      return c;
    },
    'Card',
  );
  if (groupId) {
    await pub(ctx, retroId, card, board);
    await dissolveGroupIfSmall(ctx, retroId, groupId, board);
  }
  return toCardView(card, board, ctx.accountId);
}

export async function updateGroup(
  ctx: ReqContext,
  retroId: string,
  groupId: string,
  input: { title?: string; columnId?: string; order?: number },
): Promise<CardGroup> {
  const board = await loadBoard(ctx, retroId);
  requireOpen(board);
  if (!canGroup(board.facilitator, isFacilitator(board, ctx.accountId))) throw new AppError('PHASE', 'Grouping happens in the Group phase.');
  if (input.columnId) requireColumn(board, input.columnId);
  const prev = await groups.require(keys.group(retroId, groupId), 'Group');
  const group = await groups.update(
    keys.group(retroId, groupId),
    (g) => {
      if (input.title !== undefined) {
        if (!input.title) throw new AppError('BAD_REQUEST', 'Group title cannot be empty.');
        g.title = input.title.slice(0, 60);
      }
      if (input.columnId) g.columnId = input.columnId;
      if (input.order !== undefined) g.order = input.order;
      return g;
    },
    'Group',
  );
  await publishRetro(ctx.projectId, retroId, ctx.accountId, { type: 'group.upserted', group });
  // Moving a stack moves its members.
  if (input.columnId && input.columnId !== prev.columnId) {
    const members = (await cards.queryAll(INDEX.byRetro, [retroId])).filter((c) => c.groupId === groupId);
    for (const m of members) {
      const moved = await cards.update(keys.card(retroId, m.id), (c) => ({ ...c, columnId: input.columnId! }));
      await pub(ctx, retroId, moved, board);
    }
  }
  return group;
}

/** A group with fewer than two cards is dissolved; its last card is released. */
async function dissolveGroupIfSmall(ctx: ReqContext, retroId: string, groupId: string, board: RetroBoard): Promise<void> {
  const members = (await cards.queryAll(INDEX.byRetro, [retroId])).filter((c) => c.groupId === groupId);
  if (members.length >= 2) return;
  for (const m of members) {
    const freed = await cards.update(keys.card(retroId, m.id), (c) => (c.groupId === groupId ? { ...c, groupId: null } : null));
    await pub(ctx, retroId, freed, board);
  }
  await groups.delete(keys.group(retroId, groupId));
  await publishRetro(ctx.projectId, retroId, ctx.accountId, { type: 'group.deleted', groupId });
}

/* ------------------------ reactions & comments ---------------------- */

export async function toggleReaction(ctx: ReqContext, retroId: string, cardId: string, emoji: string): Promise<CardView> {
  const board = await loadBoard(ctx, retroId);
  if (!canReactOrComment(board.facilitator)) throw new AppError('PHASE', 'Reactions open once cards are revealed.');
  if (!emoji || emoji.length > LIMITS.reactionEmojiMaxLen || /[\s<>]/.test(emoji)) throw new AppError('BAD_REQUEST', 'Invalid reaction.');
  const card = await cards.update(
    keys.card(retroId, cardId),
    (c) => {
      const who = c.reactions[emoji] ?? [];
      if (who.includes(ctx.accountId)) {
        const rest = who.filter((a) => a !== ctx.accountId);
        if (rest.length) c.reactions[emoji] = rest;
        else delete c.reactions[emoji];
      } else {
        if (!c.reactions[emoji] && Object.keys(c.reactions).length >= LIMITS.distinctReactionsPerCard) {
          throw new AppError('BAD_REQUEST', 'This card has too many different reactions.');
        }
        c.reactions[emoji] = [...who, ctx.accountId];
      }
      return c;
    },
    'Card',
  );
  await pub(ctx, retroId, card, board);
  return toCardView(card, board, ctx.accountId);
}

export async function addComment(ctx: ReqContext, retroId: string, cardId: string, text: string): Promise<CardView> {
  const board = await loadBoard(ctx, retroId);
  if (!canReactOrComment(board.facilitator)) throw new AppError('PHASE', 'Comments open once cards are revealed.');
  const card = await cards.update(
    keys.card(retroId, cardId),
    (c) => {
      if (c.comments.length >= LIMITS.commentsPerCard) throw new AppError('BAD_REQUEST', 'Comment limit reached for this card.');
      c.comments.push({ id: newId(), authorId: ctx.accountId, text, createdAt: Date.now() });
      return c;
    },
    'Card',
  );
  await pub(ctx, retroId, card, board);
  return toCardView(card, board, ctx.accountId);
}

export async function deleteComment(ctx: ReqContext, retroId: string, cardId: string, commentId: string): Promise<CardView> {
  const board = await loadBoard(ctx, retroId);
  const fac = isFacilitator(board, ctx.accountId);
  const card = await cards.update(
    keys.card(retroId, cardId),
    (c) => {
      const cm = c.comments.find((x) => x.id === commentId);
      if (!cm) return null;
      if (cm.authorId !== ctx.accountId && !fac) throw new AppError('FORBIDDEN', 'You can only delete your own comments.');
      c.comments = c.comments.filter((x) => x.id !== commentId);
      return c;
    },
    'Card',
  );
  await pub(ctx, retroId, card, board);
  return toCardView(card, board, ctx.accountId);
}
