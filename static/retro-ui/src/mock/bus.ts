/**
 * Cross-tab event bus for the Local Mock Adapter. Events are delivered to listeners in
 * this tab and, via BroadcastChannel, to every other open tab - so two browser tabs act
 * like two participants connected to the same Forge Realtime channel.
 */
type Listener = (payload: unknown) => void;

const listeners = new Map<string, Set<Listener>>();
const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('sprintpulse-mock') : null;

function deliver(channel: string, payload: unknown): void {
  for (const l of listeners.get(channel) ?? []) {
    try {
      l(structuredClone(payload));
    } catch (e) {
      console.error('[mock bus] listener failed', e);
    }
  }
}

bc?.addEventListener('message', (e: MessageEvent<{ channel: string; payload: unknown }>) => deliver(e.data.channel, e.data.payload));

export function emit(channel: string, payload: unknown): void {
  // Async like the real network, so callers never rely on synchronous delivery.
  setTimeout(() => deliver(channel, payload), 15);
  bc?.postMessage({ channel, payload });
}

export function on(channel: string, l: Listener): () => void {
  if (!listeners.has(channel)) listeners.set(channel, new Set());
  listeners.get(channel)!.add(l);
  return () => listeners.get(channel)?.delete(l);
}
