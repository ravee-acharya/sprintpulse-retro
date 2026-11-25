/**
 * The only module that talks to @forge/bridge or the Local Mock Adapter. Everything else
 * calls `call()`, `subscribe()`, `publishPresence()` and `openUrl()`.
 */
import type { ErrorCode, RpcResult } from '@shared/types';
import { isMockMode } from './env';

export interface AppContext {
  mock: boolean;
  projectKey: string | null;
  projectId: string | null;
  accountId: string | null;
  siteUrl: string | null;
}

export class RpcError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const mockBackend = () => import('../mock/backend');
const mockBus = () => import('../mock/bus');

export async function getAppContext(): Promise<AppContext> {
  if (isMockMode()) {
    const { currentMockUser, MOCK_PROJECT } = await import('../mock/users');
    return { mock: true, projectKey: MOCK_PROJECT.key, projectId: MOCK_PROJECT.id, accountId: currentMockUser().accountId, siteUrl: 'https://mock.atlassian.net' };
  }
  const { view } = await import('@forge/bridge');
  const ctx = await view.getContext();
  const project = (ctx.extension as { project?: { key?: string; id?: string | number } } | undefined)?.project;
  return {
    mock: false,
    projectKey: project?.key ?? null,
    projectId: project?.id !== undefined ? String(project.id) : null,
    accountId: ctx.accountId ?? null,
    siteUrl: ctx.siteUrl ?? null,
  };
}

/** Invoke a resolver and unwrap its RpcResult envelope (throws RpcError on failure). */
export async function call<T>(fn: string, payload?: Record<string, unknown>): Promise<T> {
  let res: RpcResult<T>;
  try {
    if (isMockMode()) {
      res = await (await mockBackend()).invoke<T>(fn, payload);
    } else {
      const { invoke } = await import('@forge/bridge');
      res = (await invoke(fn, payload)) as RpcResult<T>;
    }
  } catch (e) {
    throw new RpcError('INTERNAL', e instanceof Error ? e.message : 'Network error');
  }
  if (!res.ok) throw new RpcError(res.error.code, res.error.message);
  return res.data;
}

export interface Subscription {
  unsubscribe(): void;
}

/**
 * Subscribe to a Forge Realtime channel scoped to the Jira project context. Resolves to
 * null when realtime is unavailable, so callers fall back to polling.
 */
export async function subscribe(channel: string, token: string | null, onEvent: (payload: unknown) => void): Promise<Subscription | null> {
  if (isMockMode()) {
    const off = (await mockBus()).on(channel, onEvent);
    return { unsubscribe: off };
  }
  try {
    const { realtime, Jira } = await import('@forge/bridge');
    const sub = await realtime.subscribe(
      channel,
      (payload, error) => {
        if (error) return console.warn('[sprintpulse] realtime error', error);
        onEvent(typeof payload === 'string' ? JSON.parse(payload) : payload);
      },
      { contextOverrides: [Jira.Project], ...(token ? { token } : {}) },
    );
    return { unsubscribe: () => void sub.unsubscribe() };
  } catch (e) {
    console.warn('[sprintpulse] realtime unavailable, falling back to polling', e);
    return null;
  }
}

/** Client-published, unsigned presence pings (non-sensitive: "I'm here"). */
export async function publishPresence(channel: string, payload: Record<string, unknown>): Promise<void> {
  if (isMockMode()) return (await mockBus()).emit(channel, payload);
  try {
    const { realtime, Jira } = await import('@forge/bridge');
    await realtime.publish(channel, payload, { contextOverrides: [Jira.Project] });
  } catch {
    /* presence is best-effort */
  }
}

/** Open a link outside the Jira iframe (new tab), or a Jira-relative path like /browse/KEY. */
export async function openUrl(url: string, siteUrl: string | null): Promise<void> {
  const absolute = url.startsWith('/') ? `${siteUrl ?? ''}${url}` : url;
  if (isMockMode()) {
    window.open(absolute, '_blank', 'noopener');
    return;
  }
  const { router } = await import('@forge/bridge');
  await router.open(absolute);
}
