/**
 * Forge Realtime publisher.
 *
 * Channels are scoped to the Jira project context (contextOverrides: [Jira.Project]) and,
 * when token signing is available, secured with a signed token: the backend publishes
 * with a publish-capable token and hands clients a subscribe-only token with the same
 * claims. Clients therefore cannot inject fake board events.
 *
 * Publishing is best-effort: a realtime failure never fails the mutation, because clients
 * also reconcile via the snapshot resolver (fallback polling).
 */
import { Jira, publish, signRealtimeToken } from '@forge/realtime';
import { projectChannel, retroChannel, type ProjectEventEnvelope, type RetroEvent, type RetroEventEnvelope } from '../shared/events';

const CONTEXT = [Jira.Project];
const TOKEN_REFRESH_MARGIN_MS = 60_000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

async function token(channel: string, claims: Record<string, string>, perms: 'publish' | 'subscribe'): Promise<string | null> {
  const cacheKey = `${perms}|${channel}`;
  const hit = tokenCache.get(cacheKey);
  if (hit && hit.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) return hit.token;
  try {
    const res = await signRealtimeToken(channel, claims, [perms]);
    if (!res.token) {
      console.warn('[sprintpulse] realtime token signing returned no token', res.errors);
      return null;
    }
    const expiresAt = typeof res.expiresAt === 'number' ? res.expiresAt : Date.parse(String(res.expiresAt)) || Date.now() + 10 * 60_000;
    tokenCache.set(cacheKey, { token: res.token as string, expiresAt });
    return res.token as string;
  } catch (e) {
    console.warn('[sprintpulse] realtime token signing unavailable', e);
    return null;
  }
}

const claimsFor = (projectId: string, retroId: string) => ({ projectId, retroId });

/** Subscribe-only token handed to clients in the retro snapshot. */
export async function subscribeToken(projectId: string, retroId: string): Promise<string | null> {
  return token(retroChannel(retroId), claimsFor(projectId, retroId), 'subscribe');
}

/** `_actorId` is accepted for call-site readability/logging but never broadcast (anonymity). */
export async function publishRetro(projectId: string, retroId: string, _actorId: string, event: RetroEvent): Promise<void> {
  const channel = retroChannel(retroId);
  const envelope: RetroEventEnvelope = { retroId, at: Date.now(), event };
  try {
    const t = await token(channel, claimsFor(projectId, retroId), 'publish');
    const res = await publish(channel, envelope as unknown as Record<string, unknown>, {
      contextOverrides: CONTEXT,
      ...(t ? { token: t } : {}),
    });
    if (res.errors) console.warn('[sprintpulse] realtime publish errors', event.type, res.errors);
  } catch (e) {
    console.warn('[sprintpulse] realtime publish failed', event.type, e);
  }
}

export async function publishProject(projectId: string, retroId: string): Promise<void> {
  const envelope: ProjectEventEnvelope = { projectId, at: Date.now(), event: { type: 'retros.changed', retroId } };
  try {
    await publish(projectChannel(projectId), envelope as unknown as Record<string, unknown>, { contextOverrides: CONTEXT });
  } catch (e) {
    console.warn('[sprintpulse] realtime project publish failed', e);
  }
}
