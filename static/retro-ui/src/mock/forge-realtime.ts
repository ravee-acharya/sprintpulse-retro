/** Browser stand-in for `@forge/realtime` (mock mode only): publishes onto the mock bus. */
import { emit } from './bus';

export enum Jira {
  Board = 'board',
  Issue = 'issue',
  Project = 'project',
}

export function publish(channel: string, payload: unknown) {
  emit(channel, payload);
  return Promise.resolve({ eventId: crypto.randomUUID(), eventTimestamp: new Date().toISOString() });
}

export const publishGlobal = publish;

export function signRealtimeToken() {
  // Placeholder for the local mock bus, which ignores tokens; never sent anywhere.
  // nosemgrep: owasp-a07-hardcoded-secret
  return Promise.resolve({ token: 'mock-token', expiresAt: Date.now() + 15 * 60_000 });
}
