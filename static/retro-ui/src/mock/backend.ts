/**
 * Local Mock Adapter backend.
 *
 * Runs the *real* Forge resolvers from `src/resolvers` in the browser. Vite aliases
 * `@forge/kvs`, `@forge/realtime`, `@forge/api`, `@forge/resolver` and `node:crypto` to the
 * shims in this folder (see vite.config.ts), so masking, voting limits, optimistic locking
 * and realtime payloads behave exactly as deployed. Loaded lazily, only in mock mode.
 */
import { resolver } from '@backend/resolvers';
import type { RpcResult } from '@shared/types';
import { currentMockUser, MOCK_PROJECT } from './users';

type Handler = (req: { payload: unknown; context: unknown }) => Promise<unknown>;
const handlers = (resolver as unknown as { handlers: Map<string, Handler> }).handlers;

export function contextFor(accountId: string) {
  return {
    accountId,
    siteUrl: 'https://mock.atlassian.net',
    extension: { type: 'jira:projectPage', project: { id: MOCK_PROJECT.id, key: MOCK_PROJECT.key, type: 'software' } },
  };
}

export async function invokeAs<T>(accountId: string, fn: string, payload: Record<string, unknown> = {}): Promise<RpcResult<T>> {
  const h = handlers.get(fn);
  if (!h) return { ok: false, error: { code: 'BAD_REQUEST', message: `No resolver "${fn}"` } };
  // Round-trip through JSON like the real bridge does.
  const res = await h({ payload: JSON.parse(JSON.stringify(payload)), context: contextFor(accountId) });
  return JSON.parse(JSON.stringify(res)) as RpcResult<T>;
}

export function invoke<T>(fn: string, payload?: Record<string, unknown>): Promise<RpcResult<T>> {
  return invokeAs<T>(currentMockUser().accountId, fn, payload);
}
