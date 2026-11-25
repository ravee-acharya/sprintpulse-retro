/**
 * Forge Realtime event contract. The backend is the only publisher of these events
 * (publishes are signed with a backend-only token when token signing is available);
 * payloads are always the *public* projection, so they never leak masked card text,
 * anonymous authors or hidden vote totals.
 */
import type { ActionItem, CardGroup, CardView, MoodSummary, RetroBoard } from './types';

export type RetroEvent =
  | { type: 'board.updated'; board: RetroBoard; /** Phase/reveal changes alter visibility: clients must re-fetch the snapshot. */ refetch: boolean }
  | { type: 'card.upserted'; card: CardView }
  | { type: 'card.deleted'; cardId: string }
  | { type: 'group.upserted'; group: CardGroup }
  | { type: 'group.deleted'; groupId: string }
  | { type: 'votes.updated'; totals: Record<string, number> | null; votersCount: number }
  | { type: 'mood.updated'; mood: Omit<MoodSummary, 'mine'> }
  | { type: 'action.upserted'; action: ActionItem }
  | { type: 'action.deleted'; actionId: string };

/**
 * No actor id on purpose: it would reveal who wrote an anonymous card or who just voted.
 * Clients de-duplicate their own echoes by comparing record `version`s.
 */
export interface RetroEventEnvelope {
  retroId: string;
  at: number;
  event: RetroEvent;
}

/** Project-level channel: retro list changed (created / closed / archived). */
export interface ProjectEventEnvelope {
  projectId: string;
  at: number;
  event: { type: 'retros.changed'; retroId: string };
}

export const retroChannel = (retroId: string): string => `sprintpulse:retro:${retroId}`;
export const projectChannel = (projectId: string): string => `sprintpulse:project:${projectId}`;
/** Unsigned, client-published presence/typing pings (non-sensitive). */
export const presenceChannel = (retroId: string): string => `sprintpulse:presence:${retroId}`;
