import { useEffect, useState } from 'react';
import { Activity, BarChart3, History, LayoutGrid, ListTodo, XCircle } from 'lucide-react';
import { getAppContext, type AppContext } from './lib/api';
import { MockDevBar } from './components/MockDevBar';
import { AnalyticsView } from './components/AnalyticsView';
import { HistoryView } from './components/HistoryView';
import { ProjectActionsView } from './components/ProjectActionsView';
import { RetroList } from './components/RetroList';
import { RetroRoom } from './components/retro/RetroRoom';
import { ToastProvider } from './components/toast';
import { cx, Spinner } from './components/ui';

type Tab = 'retros' | 'history' | 'actions' | 'health';
type Route = { view: 'home'; tab: Tab } | { view: 'retro'; id: string };

const TABS: Array<{ key: Tab; label: string; Icon: typeof History }> = [
  { key: 'retros', label: 'Retros', Icon: LayoutGrid },
  { key: 'history', label: 'History', Icon: History },
  { key: 'actions', label: 'Action items', Icon: ListTodo },
  { key: 'health', label: 'Team health', Icon: BarChart3 },
];

/** Keep the current view in the URL hash so refreshes and shared links land on it. */
function readRoute(): Route {
  const m = window.location.hash.match(/^#\/retro\/([A-Za-z0-9_-]+)/);
  if (m) return { view: 'retro', id: m[1]! };
  const t = window.location.hash.match(/^#\/(history|actions|health)/)?.[1] as Tab | undefined;
  return { view: 'home', tab: t ?? 'retros' };
}

export default function App() {
  const [ctx, setCtx] = useState<AppContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    getAppContext()
      .then(setCtx)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (r: Route) => {
    window.location.hash = r.view === 'retro' ? `/retro/${r.id}` : r.tab === 'retros' ? '/' : `/${r.tab}`;
    setRoute(r);
  };

  if (error) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-red-700">
        <XCircle className="size-5" /> {error}
      </div>
    );
  }
  if (!ctx) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-slate-500">
        <Spinner /> Loading SprintPulse...
      </div>
    );
  }

  return (
    <ToastProvider>
      <div className="flex h-full min-h-[600px] flex-col">
        {ctx.mock && <MockDevBar retroId={route.view === 'retro' ? route.id : null} />}
        {route.view === 'home' ? (
          <>
            <header className="flex items-center gap-3 border-b border-[var(--sp-border)] px-6 py-3">
              <div className="grid size-9 place-items-center rounded-lg bg-brand-500 text-white">
                <Activity className="size-5" />
              </div>
              <div>
                <h1 className="text-base font-semibold">SprintPulse Retro</h1>
                <p className="text-xs text-[var(--sp-text-subtle)]">{ctx.projectKey} · Agile retrospectives, native to Jira</p>
              </div>
              <nav className="ml-6 flex gap-1" aria-label="Sections">
                {TABS.map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    aria-current={route.tab === key ? 'page' : undefined}
                    onClick={() => go({ view: 'home', tab: key })}
                    className={cx('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium', route.tab === key ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100')}
                  >
                    <Icon className="size-4" /> {label}
                  </button>
                ))}
              </nav>
            </header>
            <div className="min-h-0 flex-1 overflow-auto">
              {route.tab === 'retros' && <RetroList projectId={ctx.projectId} onOpen={(id) => go({ view: 'retro', id })} />}
              {route.tab === 'history' && <HistoryView onOpen={(id) => go({ view: 'retro', id })} />}
              {route.tab === 'actions' && <ProjectActionsView siteUrl={ctx.siteUrl} onOpenRetro={(id) => go({ view: 'retro', id })} />}
              {route.tab === 'health' && <AnalyticsView />}
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1">
            <RetroRoom key={route.id} retroId={route.id} me={ctx.accountId ?? ''} siteUrl={ctx.siteUrl} onBack={() => go({ view: 'home', tab: 'retros' })} />
          </div>
        )}
      </div>
    </ToastProvider>
  );
}
