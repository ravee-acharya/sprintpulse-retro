import { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { DEFAULT_SETTINGS } from '@shared/catalog';
import type { RetroBoard, RetroTemplate, SprintRef, ThemeKey } from '@shared/types';
import { call } from '../lib/api';
import { ColumnEditor, type EditableColumn } from './ColumnEditor';
import { useToast } from './toast';
import { Button, cx, Modal, Spinner, Toggle } from './ui';

const THEMES: ThemeKey[] = ['aurora', 'sunset', 'ocean', 'forest', 'sailboat', 'midnight', 'paper'];

export function CreateRetroDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (b: RetroBoard) => void }) {
  const toast = useToast();
  const [templates, setTemplates] = useState<RetroTemplate[]>([]);
  const [sprints, setSprints] = useState<SprintRef[] | null>(null);
  const [templateId, setTemplateId] = useState('start-stop-continue');
  const [sprintId, setSprintId] = useState<number | ''>('');
  const [title, setTitle] = useState('');
  const [theme, setTheme] = useState<ThemeKey>('aurora');
  const [columns, setColumns] = useState<EditableColumn[]>([]);
  const [customised, setCustomised] = useState(false);
  const [anon, setAnon] = useState(DEFAULT_SETTINGS.anonymousByDefault);
  const [voteLimit, setVoteLimit] = useState(DEFAULT_SETTINGS.voteLimit);
  const [hideVotes, setHideVotes] = useState(DEFAULT_SETTINGS.hideVotesUntilClosed);
  const [busy, setBusy] = useState(false);
  const [tplName, setTplName] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    call<RetroTemplate[]>('templates.list').then(setTemplates).catch((e) => toast('error', e.message));
    call<SprintRef[]>('jira.sprints')
      .then((list) => {
        setSprints(list);
        // Default to the most recently finished sprint, else the active one.
        const preferred = list.find((s) => s.state === 'closed') ?? list.find((s) => s.state === 'active');
        if (preferred) setSprintId(preferred.id);
      })
      .catch(() => setSprints([]));
  }, [open, toast]);

  const template = templates.find((t) => t.id === templateId);
  useEffect(() => {
    if (!template) return;
    setColumns(template.columns.map((c) => ({ ...c })));
    setTheme(template.theme);
    setCustomised(false);
  }, [template]);

  const sprint = useMemo(() => sprints?.find((s) => s.id === sprintId) ?? null, [sprints, sprintId]);
  const placeholder = sprint ? `${sprint.name} Retrospective` : `Retrospective - ${new Date().toISOString().slice(0, 10)}`;
  const columnsValid = columns.length > 0 && columns.every((c) => c.title.trim());

  async function create() {
    setBusy(true);
    try {
      const board = await call<RetroBoard>('retros.create', {
        title: title.trim() || undefined,
        templateId,
        sprint,
        theme,
        settings: { anonymousByDefault: anon, voteLimit, maxVotesPerTarget: Math.min(3, voteLimit), hideVotesUntilClosed: hideVotes },
        ...(customised ? { columns } : {}),
      });
      onCreated(board);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate() {
    const name = tplName?.trim();
    if (!name) return;
    try {
      const t = await call<RetroTemplate>('templates.save', { name, description: 'Custom template', theme, columns });
      setTemplates((ts) => [...ts, t]);
      setTemplateId(t.id);
      setTplName(null);
      toast('success', 'Template saved');
    } catch (e) {
      toast('error', (e as Error).message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New retrospective"
      width="max-w-3xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !columnsValid} onClick={create}>
            {busy && <Spinner />} Create retro
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Sprint</span>
            {sprints === null ? (
              <span className="flex items-center gap-2 text-slate-500"><Spinner /> Loading sprints...</span>
            ) : (
              <select value={sprintId} onChange={(e) => setSprintId(e.target.value ? Number(e.target.value) : '')} className="w-full rounded-md border border-[var(--sp-border)] px-2 py-1.5">
                <option value="">No sprint</option>
                {sprints.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.state === 'active' ? '(active)' : s.state === 'future' ? '(upcoming)' : ''}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={placeholder} maxLength={120} className="w-full rounded-md border border-[var(--sp-border)] px-2 py-1.5" />
          </label>
          <div className="text-sm">
            <span className="mb-1 block font-medium">Template</span>
            <div className="grid grid-cols-2 gap-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTemplateId(t.id)}
                  className={cx('rounded-lg border p-2 text-left transition', t.id === templateId ? 'border-brand-500 ring-2 ring-brand-100' : 'border-[var(--sp-border)] hover:border-slate-400')}
                >
                  <div className={cx('mb-1 h-6 rounded', `sp-theme-${t.theme}`)} />
                  <div className="text-xs font-semibold">{t.name}</div>
                  <div className="text-[11px] text-slate-500">{t.columns.map((c) => c.title).join(' · ')}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2 rounded-lg bg-slate-50 p-3">
            <Toggle checked={anon} onChange={setAnon} label="Anonymous cards by default" />
            <Toggle checked={hideVotes} onChange={setHideVotes} label="Hide votes until voting closes" />
            <label className="flex items-center gap-2 text-sm">
              Votes per person
              <input type="number" min={1} max={20} value={voteLimit} onChange={(e) => setVoteLimit(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className="w-16 rounded border border-[var(--sp-border)] px-2 py-0.5" />
            </label>
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Columns {customised && <span className="text-xs text-amber-600">(customised)</span>}</span>
            <Button size="sm" variant="ghost" disabled={!columnsValid} onClick={() => setTplName(`${template?.name ?? 'Custom'} (custom)`)}>
              <Save className="size-3.5" /> Save as template
            </Button>
          </div>
          {tplName !== null && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void saveTemplate();
              }}
            >
              <input autoFocus aria-label="Template name" value={tplName} maxLength={60} onChange={(e) => setTplName(e.target.value)} className="flex-1 rounded-md border border-[var(--sp-border)] px-2 py-1 text-sm" />
              <Button size="sm" variant="primary" type="submit" disabled={!tplName.trim()}>Save</Button>
              <Button size="sm" onClick={() => setTplName(null)}>Cancel</Button>
            </form>
          )}
          <ColumnEditor
            columns={columns}
            onChange={(c) => {
              setColumns(c);
              setCustomised(true);
            }}
          />
          <div className="text-sm">
            <span className="mb-1 block font-medium">Background</span>
            <div className="flex flex-wrap gap-2">
              {THEMES.map((t) => (
                <button key={t} type="button" title={t} aria-label={`${t} theme`} onClick={() => setTheme(t)} className={cx('h-8 w-12 rounded-md border', `sp-theme-${t}`, theme === t ? 'ring-2 ring-brand-500 ring-offset-1' : 'border-[var(--sp-border)]')} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
