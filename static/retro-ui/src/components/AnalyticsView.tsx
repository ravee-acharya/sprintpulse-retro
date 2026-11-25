/** Team Health & Sentiment dashboard across recent retros. */
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { MOODS } from '@shared/catalog';
import type { TeamAnalytics } from '@shared/types';
import { call } from '../lib/api';
import { LineChart, StackedColumns, TopicBars } from './charts';
import { useToast } from './toast';
import { Button, cx, Spinner } from './ui';

const moodFor = (avg: number | null) => (avg === null ? null : MOODS.reduce((b, m) => (Math.abs(m.score - avg) < Math.abs(b.score - avg) ? m : b)));
const shortLabel = (sprint: string | null, title: string) => (sprint ?? title).replace(/\s*Retrospective$/i, '').replace(/^Sprint\s+/i, 'S').slice(0, 12);

export function AnalyticsView() {
  const toast = useToast();
  const [data, setData] = useState<TeamAnalytics | null>(null);
  const [limit, setLimit] = useState(12);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (refreshJira: boolean) => {
      setLoading(true);
      try {
        setData(await call<TeamAnalytics>('analytics.team', { limit, refreshJira }));
      } catch (e) {
        toast('error', (e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [limit, toast],
  );

  // Live Jira statuses on first load, so completion rates reflect reality.
  useEffect(() => void load(true), [load]);

  if (!data) return <div className="flex items-center gap-2 p-6 text-slate-500"><Spinner /> Crunching team health...</div>;

  const t = data.trend;
  const withMood = t.filter((p) => p.moodAverage !== null);
  const latest = withMood.at(-1);
  const prev = withMood.at(-2);
  const delta = latest && prev ? latest.moodAverage! - prev.moodAverage! : null;
  const latestMood = moodFor(latest?.moodAverage ?? null);
  const avgParticipants = t.length ? Math.round((t.reduce((n, p) => n + p.participantCount, 0) / t.length) * 10) / 10 : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-lg font-semibold">Team health</h2>
          <p className="text-sm text-[var(--sp-text-subtle)]">Mood, follow-through and recurring themes across your recent retros. Action statuses come live from Jira.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="Number of retros" className="h-9 rounded-md border border-[var(--sp-border)] px-2 text-sm">
            {[6, 12, 24].map((n) => <option key={n} value={n}>Last {n} retros</option>)}
          </select>
          <Button onClick={() => load(true)} disabled={loading}><RefreshCw className={cx('size-4', loading && 'animate-spin')} /> Refresh from Jira</Button>
        </div>
      </div>

      {!t.length ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">No retros yet. Close a retro to start building your team's health history.</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Latest mood" value={latest ? `${latestMood?.emoji ?? ''} ${latest.moodAverage!.toFixed(1)}` : '-'} sub={delta === null ? 'out of 5' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)} vs previous retro`} />
            <Stat label="Action completion" value={data.actions.completionRate === null ? '-' : `${data.actions.completionRate}%`} sub={`${data.actions.done} of ${data.actions.total} done`} />
            <Stat label="Open actions" value={String(data.actions.open)} sub={`${data.actions.linkedToJira} linked to Jira issues`} />
            <Stat label="Retros" value={String(t.length)} sub={`${avgParticipants} participants on average`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <LineChart
              title="Mood trend"
              subtitle="Average check-in per retro (1 = rough, 5 = great)"
              valueName="Average mood"
              points={t.map((p) => ({ label: shortLabel(p.sprintName, p.title), sublabel: new Date(p.date).toLocaleDateString(), value: p.moodAverage }))}
              yMin={1}
              yMax={5}
              yTicks={[1, 2, 3, 4, 5]}
            />
            <StackedColumns
              title="Action follow-through"
              subtitle="Action items per retro, by current status"
              names={['Done', 'Open']}
              data={t.map((p) => ({ label: shortLabel(p.sprintName, p.title), sublabel: p.title, a: p.actionsDone, b: p.actionCount - p.actionsDone }))}
            />
          </div>
          <TopicBars topics={data.topTopics} />
        </>
      )}
      <p className="text-right text-xs text-slate-400">Updated {new Date(data.generatedAt).toLocaleTimeString()}</p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-[var(--sp-border)] bg-white p-4">
      <div className="text-xs font-medium text-[var(--sp-text-subtle)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{sub}</div>
    </div>
  );
}
