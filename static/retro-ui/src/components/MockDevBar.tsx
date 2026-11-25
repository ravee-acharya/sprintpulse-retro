/**
 * Local-preview controls (mock mode only): switch identity, open a second participant in a
 * new tab, let simulated teammates act, and reset the in-browser data.
 */
import { useEffect, useState } from 'react';
import { Bot, Database, ExternalLink, FastForward, FlaskConical, Trash2 } from 'lucide-react';
import type { JiraUser } from '@shared/types';
import { Button, cx } from './ui';

interface MockApi {
  users: JiraUser[];
  current: JiraUser;
  setUser: (id: string) => void;
  botTick: (retroId: string) => Promise<string | null>;
  reset: () => void;
  seed: (onProgress: (m: string) => void) => Promise<void>;
  progress: () => number;
}

export function MockDevBar({ retroId }: { retroId: string | null }) {
  const [api, setApi] = useState<MockApi | null>(null);
  const [bots, setBots] = useState(false);
  const [last, setLast] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([import('../mock/users'), import('../mock/bots'), import('../mock/forge-kvs'), import('../mock/seed')]).then(([u, b, k, sd]) =>
      setApi({ users: u.MOCK_USERS, current: u.currentMockUser(), setUser: u.setMockUser, botTick: b.botTick, reset: k.resetMockStorage, seed: sd.seedDemoHistory, progress: sd.progressAllMockIssues }),
    );
  }, []);

  useEffect(() => {
    if (!bots || !retroId || !api) return;
    const id = window.setInterval(() => {
      void api.botTick(retroId).then((msg) => msg && setLast(msg));
    }, 2500);
    return () => window.clearInterval(id);
  }, [bots, retroId, api]);

  if (!api) return null;
  const other = api.current.accountId === api.users[1]!.accountId ? api.users[0]! : api.users[1]!;
  const openAs = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('mock', '');
    url.searchParams.set('user', other.accountId);
    window.open(url.toString(), '_blank');
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900">
      <span className="flex items-center gap-1 font-semibold"><FlaskConical className="size-3.5" /> Local mock mode</span>
      <label className="flex items-center gap-1">
        Acting as
        <select value={api.current.accountId} onChange={(e) => api.setUser(e.target.value)} className="rounded border border-amber-300 bg-white px-1 py-0.5" aria-label="Mock user">
          {api.users.map((u) => (
            <option key={u.accountId} value={u.accountId}>
              {u.displayName}
              {u.accountId === 'mock-facilitator' ? ' (facilitator)' : ''}
            </option>
          ))}
        </select>
      </label>
      <Button size="sm" variant="ghost" onClick={openAs} className="text-amber-900 hover:bg-amber-100">
        <ExternalLink className="size-3.5" /> Open as {other.displayName.split(' ')[0]} in new tab
      </Button>
      {retroId && (
        <Button size="sm" variant="ghost" onClick={() => setBots((b) => !b)} className={cx('hover:bg-amber-100', bots ? 'bg-amber-200 text-amber-950' : 'text-amber-900')} aria-pressed={bots}>
          <Bot className="size-3.5" /> {bots ? 'Simulated team: on' : 'Simulate team'}
        </Button>
      )}
      {bots && last && <span className="text-amber-700">{last}</span>}
      {!retroId && (
        <Button
          size="sm"
          variant="ghost"
          className="text-amber-900 hover:bg-amber-100"
          title="Create four closed retros (Sprints 19-22) with moods, cards and Jira-linked actions"
          onClick={async () => {
            try {
              await api.seed(setLast);
              window.location.reload();
            } catch (e) {
              setLast(`Seeding failed: ${(e as Error).message}`);
            }
          }}
        >
          <Database className="size-3.5" /> Seed demo history
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="text-amber-900 hover:bg-amber-100"
        title="Simulate the team working: move every mock Jira issue one status forward, then use Sync"
        onClick={() => setLast(`Moved ${api.progress()} mock Jira issue(s) forward - press Sync`)}
      >
        <FastForward className="size-3.5" /> Progress Jira issues
      </Button>
      {last && !bots && <span className="text-amber-700">{last}</span>}
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto text-amber-900 hover:bg-amber-100"
        onClick={() => {
          api.reset();
          localStorage.removeItem('sprintpulse-mock-jira');
          window.location.reload();
        }}
      >
        <Trash2 className="size-3.5" /> Reset mock data
      </Button>
    </div>
  );
}
