/**
 * Export the retro summary + action items as Markdown or CSV (built client-side from the
 * viewer's own snapshot, so masked cards are never included), or publish it as a
 * Confluence page (built server-side by the confluence.publish resolver).
 *
 * Downloads and clipboard access can be blocked inside Jira's sandboxed iframe, so the
 * text is always shown in a selectable box as the fallback.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, ExternalLink, FileText, Sheet } from 'lucide-react';
import { buildCsv, buildMarkdown } from '@shared/export';
import { RpcError, call } from '../../lib/api';
import { Button, cx, Modal, Spinner } from '../ui';
import { useRetro } from './RetroContext';

type Tab = 'markdown' | 'csv' | 'confluence';

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'retro';

export function ExportDialog({ open, onClose, siteUrl }: { open: boolean; onClose: () => void; siteUrl: string | null }) {
  const { s, user } = useRetro();
  const [tab, setTab] = useState<Tab>('markdown');
  const [markdown, csv] = useMemo(() => {
    if (!open) return ['', ''];
    const name = (id: string | null) => (id ? (user(id)?.displayName ?? 'Unknown user') : 'Anonymous');
    return [buildMarkdown(s, name), buildCsv(s, name)];
  }, [open, s, user]);
  const hidden = s.cards.filter((c) => c.masked).length;

  return (
    <Modal open={open} onClose={onClose} title="Export retrospective" width="max-w-2xl">
      <div className="mb-3 flex gap-1 border-b border-[var(--sp-border)]" role="tablist">
        {(
          [
            ['markdown', 'Markdown', FileText],
            ['csv', 'CSV', Sheet],
            ['confluence', 'Confluence page', ExternalLink],
          ] as const
        ).map(([key, label, Icon]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={cx('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium', tab === key ? 'border-brand-500 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700')}>
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>
      {hidden > 0 && <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{hidden} unrevealed card(s) are hidden from you and won't be exported.</p>}
      {tab === 'markdown' && <TextExport text={markdown} filename={`${slug(s.board.title)}.md`} mime="text/markdown" />}
      {tab === 'csv' && <TextExport text={csv} filename={`${slug(s.board.title)}.csv`} mime="text/csv" />}
      {tab === 'confluence' && <ConfluenceExport siteUrl={siteUrl} />}
    </Modal>
  );
}

function TextExport({ text, filename, mime }: { text: string; filename: string; mime: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ref.current?.select();
      document.execCommand('copy');
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    try {
      // BOM so Excel opens UTF-8 CSV (emoji, accents) correctly.
      const blob = new Blob([mime === 'text/csv' ? '﻿' : '', text], { type: `${mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setDownloadFailed(true);
    }
  };

  return (
    <div>
      <textarea ref={ref} readOnly value={text} aria-label="Export preview" className="h-72 w-full resize-y rounded-md border border-[var(--sp-border)] bg-slate-50 p-2 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      {downloadFailed && <p className="mt-1 text-xs text-amber-700">Downloads are blocked here - copy the text instead.</p>}
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={copy}>{copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />} {copied ? 'Copied' : 'Copy'}</Button>
        <Button variant="primary" onClick={download}><Download className="size-4" /> Download {filename.split('.').pop()?.toUpperCase()}</Button>
      </div>
    </div>
  );
}

function ConfluenceExport({ siteUrl }: { siteUrl: string | null }) {
  const { s, openLink } = useRetro();
  const [spaces, setSpaces] = useState<Array<{ key: string; name: string }> | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [space, setSpace] = useState('');
  const [title, setTitle] = useState(s.board.title);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<Array<{ key: string; name: string }>>('confluence.spaces', { query: '' })
      .then((list) => {
        setSpaces(list);
        if (list[0]) setSpace(list[0].key);
      })
      .catch((e) => setUnavailable(e instanceof RpcError && e.code === 'CONFLUENCE_UNAVAILABLE' ? 'Confluence is not available on this site - use Markdown or CSV instead.' : (e as Error).message));
  }, []);

  if (unavailable) return <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">{unavailable}</p>;
  if (!spaces) return <p className="flex items-center gap-2 text-sm text-slate-500"><Spinner /> Loading Confluence spaces...</p>;
  if (result) {
    return (
      <div className="rounded-md bg-emerald-50 p-4 text-sm text-emerald-800">
        <p className="mb-2 flex items-center gap-1.5 font-medium"><Check className="size-4" /> Published to Confluence</p>
        <Button size="sm" onClick={() => openLink(result.url)}><ExternalLink className="size-3.5" /> Open page</Button>
      </div>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          setResult(await call<{ id: string; url: string }>('confluence.publish', { retroId: s.board.id, spaceKey: space, title: title.trim(), siteUrl: siteUrl ?? '' }));
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Space</span>
        <select value={space} onChange={(e) => setSpace(e.target.value)} className="w-full rounded-md border border-[var(--sp-border)] px-2 py-1.5">
          {spaces.map((sp) => <option key={sp.key} value={sp.key}>{sp.name} ({sp.key})</option>)}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Page title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} className="w-full rounded-md border border-[var(--sp-border)] px-2 py-1.5" />
      </label>
      <p className="text-xs text-slate-500">The page lists every revealed card (ranked by votes), the team mood and the action items with their Jira links. Anonymous cards stay anonymous.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end">
        <Button variant="primary" type="submit" disabled={!space || !title.trim() || busy}>{busy && <Spinner />} Publish page</Button>
      </div>
    </form>
  );
}
