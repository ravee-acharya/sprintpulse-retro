/** Shared state + action helpers for everything inside one retro room. */
import { createContext, useContext } from 'react';
import type { CardView, JiraUser, RetroSnapshot } from '@shared/types';

export interface RetroCtx {
  s: RetroSnapshot;
  me: string;
  isFac: boolean;
  user: (id: string | null | undefined) => JiraUser | null;
  /** Calls a resolver; shows a toast on failure and resolves to null. */
  run: <T>(fn: string, payload?: Record<string, unknown>) => Promise<T | null>;
  /** Like run() for card mutations: applies my authoritative card view immediately. */
  runCard: (fn: string, payload: Record<string, unknown>) => Promise<CardView | null>;
  removeCard: (id: string) => void;
  patch: (p: Partial<RetroSnapshot>) => void;
  refresh: () => Promise<void>;
  clockOffset: number;
  openLink: (url: string) => void;
  viewMode: 'board' | 'focus';
  /** Open the action items drawer, optionally pre-filled from a card. */
  openActions: (prefill?: { title: string; sourceCardId: string | null }) => void;
}

export const RetroContext = createContext<RetroCtx | null>(null);

export function useRetro(): RetroCtx {
  const c = useContext(RetroContext);
  if (!c) throw new Error('useRetro outside RetroContext');
  return c;
}
