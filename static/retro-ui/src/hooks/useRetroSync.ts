/**
 * Live retro state: initial snapshot + Forge Realtime events, with fallback polling.
 *
 *  - Realtime connected:   events applied via retroReducer; a safety re-sync every 60 s
 *                          and whenever the tab regains focus.
 *  - Realtime unavailable: poll the snapshot every 4 s.
 *  - `refetch` events (phase / reveal / vote visibility changes) trigger an immediate
 *    re-fetch, because what this viewer may see has changed server-side.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { retroChannel, type RetroEventEnvelope } from '@shared/events';
import type { CardView, RetroSnapshot } from '@shared/types';
import { call, subscribe, type Subscription } from '../lib/api';
import { retroReducer } from '../lib/retroState';

export type SyncStatus = 'loading' | 'live' | 'polling' | 'error';

const POLL_MS = 4_000;
const SAFETY_RESYNC_MS = 60_000;

export function useRetroSync(retroId: string, viewer: string) {
  const [snapshot, dispatch] = useReducer(retroReducer, null);
  const [status, setStatus] = useState<SyncStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  /** serverTime - Date.now(), so timers agree across clients with skewed clocks. */
  const [clockOffset, setClockOffset] = useState(0);
  const inflight = useRef<Promise<void> | null>(null);
  const queued = useRef(false);
  const tokenRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    // Coalesce bursts of refetch requests into at most one queued follow-up.
    if (inflight.current) {
      queued.current = true;
      return inflight.current;
    }
    const run = (async () => {
      try {
        const t0 = Date.now();
        const snap = await call<RetroSnapshot>('retros.get', { retroId });
        setClockOffset(snap.serverTime - Math.round((t0 + Date.now()) / 2));
        tokenRef.current = snap.realtime.token;
        dispatch({ type: 'snapshot', snapshot: snap });
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus((s) => (s === 'loading' ? 'error' : s));
      }
    })();
    inflight.current = run;
    await run;
    inflight.current = null;
    if (queued.current) {
      queued.current = false;
      await refresh();
    }
  }, [retroId]);

  // Initial load + realtime subscription
  useEffect(() => {
    let sub: Subscription | null = null;
    let cancelled = false;
    let pollTimer: number | undefined;
    void (async () => {
      await refresh();
      if (cancelled) return;
      sub = await subscribe(retroChannel(retroId), tokenRef.current, (raw) => {
        const env = raw as RetroEventEnvelope;
        if (!env?.event || env.retroId !== retroId) return;
        dispatch({ type: 'event', event: env.event, viewer });
        if (env.event.type === 'board.updated' && env.event.refetch) void refresh();
      });
      if (cancelled) return sub?.unsubscribe();
      if (sub) {
        setStatus('live');
        pollTimer = window.setInterval(() => void refresh(), SAFETY_RESYNC_MS);
      } else {
        setStatus('polling');
        pollTimer = window.setInterval(() => void refresh(), POLL_MS);
      }
    })();
    const onFocus = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      sub?.unsubscribe();
      window.clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [retroId, viewer, refresh]);

  /** Apply the authoritative result of my own card mutation immediately. */
  const applyMine = useCallback((card: CardView) => dispatch({ type: 'mine', card }), []);
  const removeCard = useCallback((cardId: string) => dispatch({ type: 'removeCard', cardId }), []);
  const patch = useCallback((p: Partial<RetroSnapshot>) => dispatch({ type: 'patch', patch: p }), []);

  return { snapshot, status, error, clockOffset, refresh, applyMine, removeCard, patch };
}
