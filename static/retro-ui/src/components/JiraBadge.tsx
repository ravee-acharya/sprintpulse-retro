/** Jira issue key + status lozenge (status category drives the colour, label carries meaning). */
import { CheckCircle2, CircleDashed, CircleDot, ExternalLink } from 'lucide-react';
import type { JiraIssueLink } from '@shared/types';
import { cx } from './ui';

const CATEGORY = {
  new: { cls: 'bg-slate-100 text-slate-700', Icon: CircleDashed },
  indeterminate: { cls: 'bg-sky-100 text-sky-800', Icon: CircleDot },
  done: { cls: 'bg-emerald-100 text-emerald-800', Icon: CheckCircle2 },
  unknown: { cls: 'bg-slate-100 text-slate-600', Icon: CircleDashed },
} as const;

export function JiraBadge({ jira, onOpen }: { jira: JiraIssueLink; onOpen: () => void }) {
  const c = CATEGORY[jira.statusCategory];
  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" onClick={onOpen} className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand-600 hover:underline" title={`Open ${jira.issueKey} in Jira`}>
        {jira.issueKey} <ExternalLink className="size-3" />
      </button>
      <span className={cx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase', c.cls)}>
        <c.Icon className="size-3" aria-hidden />
        {jira.status}
      </span>
    </span>
  );
}
