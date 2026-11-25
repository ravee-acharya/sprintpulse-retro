/** Who's in the room: lightweight heartbeat over an unsigned realtime channel. */
import { useEffect, useState } from 'react';
import { presenceChannel } from '@shared/events';
import { publishPresence, subscribe } from '../lib/api';

const HEARTBEAT_MS = 15_000;
const EXPIRE_MS = 40_000;

export function usePresence(retroId: string, accountId: string): string[] {
  const [seen, setSeen] = useState<Record<string, number>>({ [accountId]: Date.now() });

  useEffect(() => {
    const channel = presenceChannel(retroId);
    let sub: { unsubscribe(): void } | null = null;
    let alive = true;
    const beat = (leaving = false) => void publishPresence(channel, { accountId, at: Date.now(), leaving });

    void subscribe(channel, null, (raw) => {
      const p = raw as { accountId?: string; at?: number; leaving?: boolean; hello?: boolean };
      if (!p?.accountId || typeof p.accountId !== 'string') return;
      setSeen((s) => {
        const next = { ...s };
        if (p.leaving) delete next[p.accountId!];
        else next[p.accountId!] = Date.now();
        return next;
      });
      // Answer newcomers so they see us immediately rather than after the next heartbeat.
      if (p.hello && p.accountId !== accountId) beat();
    }).then((s) => {
      if (!alive) return s?.unsubscribe();
      sub = s;
      void publishPresence(channel, { accountId, at: Date.now(), hello: true });
    });

    const hb = window.setInterval(() => {
      beat();
      setSeen((s) => Object.fromEntries(Object.entries(s).filter(([id, t]) => id === accountId || Date.now() - t < EXPIRE_MS)));
    }, HEARTBEAT_MS);
    const onUnload = () => beat(true);
    window.addEventListener('pagehide', onUnload);
    return () => {
      alive = false;
      beat(true);
      sub?.unsubscribe();
      window.clearInterval(hb);
      window.removeEventListener('pagehide', onUnload);
    };
  }, [retroId, accountId]);

  return Object.keys(seen);
}
