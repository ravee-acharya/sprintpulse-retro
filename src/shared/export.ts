/**
 * Retro export builders (Markdown, CSV, Confluence storage XHTML). Pure functions over a
 * snapshot so the UI can export locally and the backend can publish to Confluence.
 * Masked cards are skipped - exports only contain what the exporter is allowed to see.
 */
import { MOODS } from './catalog';
import type { ActionItem, CardView, RetroSnapshot } from './types';

export type NameLookup = (accountId: string | null) => string;

interface Entry {
  kind: 'card' | 'group';
  id: string;
  title: string;
  votes: number;
  cards: CardView[];
}

function columnEntries(s: RetroSnapshot, columnId: string): Entry[] {
  const totals = s.votes.totals ?? {};
  const visible = s.cards.filter((c) => c.columnId === columnId && !c.masked);
  const entries: Entry[] = [];
  for (const g of s.groups.filter((g) => g.columnId === columnId)) {
    const members = visible.filter((c) => c.groupId === g.id);
    if (members.length) entries.push({ kind: 'group', id: g.id, title: g.title, votes: totals[g.id] ?? 0, cards: members });
  }
  const groupIds = new Set(s.groups.map((g) => g.id));
  for (const c of visible.filter((c) => !c.groupId || !groupIds.has(c.groupId))) {
    entries.push({ kind: 'card', id: c.id, title: c.text, votes: totals[c.id] ?? 0, cards: [c] });
  }
  return entries.sort((a, b) => b.votes - a.votes);
}

const oneLine = (t: string) => t.replace(/\s+/g, ' ').trim();
/** Anonymous cards never carry an author in exports - not even the exporter's own cards. */
const authorOf = (c: CardView): string | null => (c.anonymous ? null : c.authorId);
const fmtDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function moodLine(s: RetroSnapshot): string {
  if (!s.mood.total) return 'No mood check-ins.';
  const parts = MOODS.filter((m) => s.mood.counts[m.key]).map((m) => `${m.emoji} ${m.label} x${s.mood.counts[m.key]}`);
  return `${parts.join(' · ')} (avg ${s.mood.average?.toFixed(2)} / 5, ${s.mood.total} check-ins)`;
}

function actionLine(a: ActionItem, name: NameLookup): string {
  const who = a.assigneeAccountId ? name(a.assigneeAccountId) : 'Unassigned';
  const jira = a.jira ? ` [${a.jira.issueKey} · ${a.jira.status}]` : '';
  const due = a.dueDate ? ` · due ${a.dueDate}` : '';
  return `${a.title} - ${who}${due}${jira}`;
}

export function buildMarkdown(s: RetroSnapshot, name: NameLookup): string {
  const b = s.board;
  const out: string[] = [];
  out.push(`# ${b.title}`, '');
  out.push(`- **Project:** ${b.projectKey}`);
  if (b.sprint) out.push(`- **Sprint:** ${b.sprint.name}`);
  out.push(`- **Date:** ${fmtDate(b.createdAt)}`);
  out.push(`- **Mood:** ${moodLine(s)}`, '');
  for (const col of [...b.columns].sort((x, y) => x.order - y.order)) {
    out.push(`## ${col.emoji ? `${col.emoji} ` : ''}${col.title}`, '');
    const entries = columnEntries(s, col.id);
    if (!entries.length) out.push('_No cards._', '');
    for (const e of entries) {
      const votes = e.votes ? ` **(${e.votes} vote${e.votes === 1 ? '' : 's'})**` : '';
      if (e.kind === 'group') {
        out.push(`- **${oneLine(e.title)}**${votes}`);
        for (const c of e.cards) out.push(`  - ${oneLine(c.text)}${authorOf(c) ? ` - _${name(authorOf(c))}_` : ''}`);
      } else {
        const c = e.cards[0]!;
        out.push(`- ${oneLine(c.text)}${votes}${authorOf(c) ? ` - _${name(authorOf(c))}_` : ''}`);
      }
      for (const c of e.cards) for (const cm of c.comments) out.push(`    > ${oneLine(cm.text)} - ${name(cm.authorId)}`);
    }
    out.push('');
  }
  out.push('## Action items', '');
  if (!s.actions.length) out.push('_No action items._');
  for (const a of s.actions) out.push(`- [${a.status === 'done' ? 'x' : ' '}] ${actionLine(a, name)}`);
  out.push('');
  return out.join('\n');
}

const csvCell = (v: string | number | null | undefined) => {
  const t = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formula injection and quote everything.
  const safe = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function buildCsv(s: RetroSnapshot, name: NameLookup): string {
  const rows: Array<Array<string | number | null>> = [['Type', 'Column', 'Group', 'Text', 'Author', 'Votes', 'Reactions', 'Comments', 'Assignee', 'Jira', 'Status', 'Due']];
  const totals = s.votes.totals ?? {};
  const groupTitle = new Map(s.groups.map((g) => [g.id, g.title]));
  for (const col of [...s.board.columns].sort((x, y) => x.order - y.order)) {
    for (const c of s.cards.filter((c) => c.columnId === col.id && !c.masked)) {
      const reactions = Object.entries(c.reactions)
        .map(([e, who]) => `${e}${who.length}`)
        .join(' ');
      const votes = c.groupId && groupTitle.has(c.groupId) ? (totals[c.groupId] ?? 0) : (totals[c.id] ?? 0);
      rows.push(['Card', col.title, c.groupId ? (groupTitle.get(c.groupId) ?? '') : '', c.text, authorOf(c) ? name(authorOf(c)) : 'Anonymous', votes, reactions, c.comments.length, null, null, null, null]);
    }
  }
  for (const a of s.actions) {
    rows.push(['Action', null, null, a.title, name(a.createdBy), null, null, null, a.assigneeAccountId ? name(a.assigneeAccountId) : '', a.jira?.issueKey ?? '', a.jira?.status ?? a.status, a.dueDate ?? '']);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildConfluenceStorage(s: RetroSnapshot, name: NameLookup, siteBaseUrl = ''): string {
  const b = s.board;
  const parts: string[] = [];
  parts.push(
    '<table><tbody>',
    `<tr><th>Project</th><td>${esc(b.projectKey)}</td></tr>`,
    b.sprint ? `<tr><th>Sprint</th><td>${esc(b.sprint.name)}</td></tr>` : '',
    `<tr><th>Date</th><td>${fmtDate(b.createdAt)}</td></tr>`,
    `<tr><th>Mood</th><td>${esc(moodLine(s))}</td></tr>`,
    '</tbody></table>',
  );
  for (const col of [...b.columns].sort((x, y) => x.order - y.order)) {
    parts.push(`<h2>${esc(`${col.emoji ? `${col.emoji} ` : ''}${col.title}`)}</h2>`);
    const entries = columnEntries(s, col.id);
    if (!entries.length) {
      parts.push('<p><em>No cards.</em></p>');
      continue;
    }
    parts.push('<ul>');
    for (const e of entries) {
      const votes = e.votes ? ` <strong>(${e.votes} votes)</strong>` : '';
      if (e.kind === 'group') {
        parts.push(`<li><strong>${esc(oneLine(e.title))}</strong>${votes}<ul>`);
        for (const c of e.cards) parts.push(`<li>${esc(oneLine(c.text))}</li>`);
        parts.push('</ul></li>');
      } else {
        parts.push(`<li>${esc(oneLine(e.cards[0]!.text))}${votes}</li>`);
      }
    }
    parts.push('</ul>');
  }
  parts.push('<h2>Action items</h2>');
  if (!s.actions.length) parts.push('<p><em>No action items.</em></p>');
  else {
    parts.push('<table><tbody><tr><th>Action</th><th>Assignee</th><th>Jira</th><th>Status</th><th>Due</th></tr>');
    for (const a of s.actions) {
      const jira = a.jira ? `<a href="${esc(siteBaseUrl + a.jira.url)}">${esc(a.jira.issueKey)}</a>` : '';
      parts.push(
        `<tr><td>${esc(a.title)}</td><td>${esc(a.assigneeAccountId ? name(a.assigneeAccountId) : 'Unassigned')}</td><td>${jira}</td><td>${esc(a.jira?.status ?? a.status)}</td><td>${esc(a.dueDate ?? '')}</td></tr>`,
      );
    }
    parts.push('</tbody></table>');
  }
  return parts.filter(Boolean).join('');
}
