import { emptyMoodCounts } from '../shared/catalog';
import { summariseMood } from '../shared/rules';
import type { ActionItem, RetroBoard, RetroTrendPoint, TeamAnalytics } from '../shared/types';
import type { ReqContext } from '../lib/context';
import { actions, boards, INDEX, moods } from '../storage/entities';
import { syncActions } from './actions';

/**
 * Team health over the most recent retros. Closed retros carry a pre-computed summary;
 * open ones get a live mood read. Action completion comes from live Jira statuses when
 * `refreshJira` is set (one JQL search per 50 issues), else from the last sync.
 */
export async function getTeamAnalytics(ctx: ReqContext, opts: { limit: number; refreshJira: boolean }): Promise<TeamAnalytics> {
  const recent = (await boards.queryAll(INDEX.boardsByProject, [ctx.projectId], { sort: 'DESC', max: opts.limit })).filter(
    (b) => b.status !== 'archived',
  );

  const actionList: ActionItem[] = opts.refreshJira
    ? await syncActions(ctx, {})
    : await actions.queryAll(INDEX.actionsByProject, [ctx.projectId], { sort: 'DESC', max: 300 });

  const actionsByRetro = new Map<string, ActionItem[]>();
  for (const a of actionList) actionsByRetro.set(a.retroId, [...(actionsByRetro.get(a.retroId) ?? []), a]);

  const trend: RetroTrendPoint[] = await Promise.all(
    recent.map(async (b: RetroBoard): Promise<RetroTrendPoint> => {
      const own = actionsByRetro.get(b.id) ?? [];
      let moodAverage = b.summary?.moodAverage ?? null;
      let moodCounts = b.summary?.moodCounts ?? emptyMoodCounts();
      if (!b.summary) {
        const m = summariseMood(await moods.queryAll(INDEX.byRetro, [b.id]), null);
        moodAverage = m.average;
        moodCounts = m.counts;
      }
      return {
        retroId: b.id,
        title: b.title,
        sprintName: b.sprint?.name ?? null,
        date: b.createdAt,
        moodAverage,
        moodCounts,
        cardCount: b.summary?.cardCount ?? 0,
        participantCount: b.summary?.participantCount ?? 0,
        actionCount: own.length,
        actionsDone: own.filter((a) => a.status === 'done').length,
      };
    }),
  );
  trend.sort((a, b) => a.date - b.date);

  const topicTotals = new Map<string, { count: number; retros: number }>();
  for (const b of recent) {
    for (const [topic, count] of Object.entries(b.summary?.topicCounts ?? {})) {
      const t = topicTotals.get(topic) ?? { count: 0, retros: 0 };
      t.count += count;
      t.retros += 1;
      topicTotals.set(topic, t);
    }
  }
  const topTopics = [...topicTotals.entries()]
    .map(([topic, v]) => ({ topic, ...v }))
    .sort((a, b) => b.retros - a.retros || b.count - a.count)
    .slice(0, 15);

  const done = actionList.filter((a) => a.status === 'done').length;
  return {
    projectId: ctx.projectId,
    trend,
    actions: {
      total: actionList.length,
      done,
      open: actionList.length - done,
      linkedToJira: actionList.filter((a) => a.jira).length,
      completionRate: actionList.length ? Math.round((done / actionList.length) * 1000) / 10 : null,
    },
    topTopics,
    generatedAt: Date.now(),
  };
}
