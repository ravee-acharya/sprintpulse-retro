/** Display-name/avatar directory: batches lookups of account ids and caches them. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { JiraUser } from '@shared/types';
import { call } from '../lib/api';

const cache = new Map<string, JiraUser>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
let timer: number | undefined;

function flush() {
  timer = undefined;
  const ids = [...pending].slice(0, 100);
  ids.forEach((id) => pending.delete(id));
  if (!ids.length) return;
  call<JiraUser[]>('jira.users', { accountIds: ids })
    .then((users) => {
      for (const u of users) cache.set(u.accountId, u);
      for (const id of ids) if (!cache.has(id)) cache.set(id, { accountId: id, displayName: 'Unknown user', avatarUrl: null });
    })
    .catch(() => ids.forEach((id) => cache.set(id, { accountId: id, displayName: 'Unknown user', avatarUrl: null })))
    .finally(() => {
      version++;
      listeners.forEach((l) => l());
      if (pending.size) timer = window.setTimeout(flush, 30);
    });
}

function request(ids: Array<string | null | undefined>) {
  let added = false;
  for (const id of ids) {
    if (id && !cache.has(id) && !pending.has(id)) {
      pending.add(id);
      added = true;
    }
  }
  if (added && timer === undefined) timer = window.setTimeout(flush, 30);
}

export function primeUsers(users: JiraUser[]) {
  for (const u of users) cache.set(u.accountId, u);
  version++;
  listeners.forEach((l) => l());
}

/** Returns a lookup function; re-renders when new users resolve. */
export function useUsers(ids: Array<string | null | undefined>): (id: string | null | undefined) => JiraUser | null {
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => version,
  );
  const key = ids.filter(Boolean).sort().join(',');
  const [, setTick] = useState(0);
  useEffect(() => {
    request(key.split(','));
    setTick((t) => t + 1);
  }, [key]);
  return (id) => (id ? (cache.get(id) ?? null) : null);
}
