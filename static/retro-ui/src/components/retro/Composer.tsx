/** New-card composer and inline editor (markdown, hashtags -> tags, sticker GIFs, anonymity). */
import { useState } from 'react';
import { ImagePlus, Send, UserRound, UserX, X } from 'lucide-react';
import { GIF_PACK, LIMITS } from '@shared/catalog';
import type { CardView } from '@shared/types';
import { Button, cx, Popover, Sticker } from '../ui';
import { useRetro } from './RetroContext';

const extractTags = (text: string) => [...new Set([...text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]{2,32})/gu)].map((m) => m[1]!.toLowerCase()))].slice(0, LIMITS.tagsPerCard);

function GifPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" aria-label="Add reaction GIF" onClick={() => setOpen((o) => !o)} className={cx('rounded p-1 hover:bg-slate-100', value ? 'text-brand-600' : 'text-slate-500')}>
        <ImagePlus className="size-4" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="bottom-8 left-0 grid w-72 grid-cols-4 gap-1.5">
        {GIF_PACK.map((g) => (
          <button key={g.id} type="button" aria-label={g.label} onClick={() => (onChange(g.id === value ? null : g.id), setOpen(false))} className={cx('rounded-lg', g.id === value && 'ring-2 ring-brand-500')}>
            <Sticker id={g.id} size="sm" />
          </button>
        ))}
      </Popover>
    </div>
  );
}

export function Composer({ columnId, onClose }: { columnId: string; onClose?: () => void }) {
  const { s, runCard } = useRetro();
  const settings = s.board.settings;
  const [text, setText] = useState('');
  const [gif, setGif] = useState<string | null>(null);
  const [anon, setAnon] = useState(settings.anonymousByDefault);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const t = text.trim();
    if ((!t && !gif) || busy) return;
    setBusy(true);
    const created = await runCard('cards.add', {
      retroId: s.board.id,
      columnId,
      text: t,
      gifId: gif,
      tags: extractTags(t),
      ...(settings.allowAuthorToggleAnonymity ? { anonymous: anon } : {}),
    });
    setBusy(false);
    if (created) {
      setText('');
      setGif(null);
    }
  }

  return (
    <div className="rounded-lg border border-brand-300 bg-white p-2 shadow-sm ring-2 ring-brand-100">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
            e.preventDefault();
            void submit();
          }
          if (e.key === 'Escape') onClose?.();
        }}
        maxLength={LIMITS.cardTextMax}
        rows={3}
        placeholder="Type your thought... (Enter to add, Shift+Enter for a new line, **bold**, #tag)"
        aria-label="New card text"
        className="w-full resize-none border-0 p-1 text-sm focus:outline-none"
      />
      {gif && (
        <div className="relative mb-2">
          <Sticker id={gif} />
          <button type="button" aria-label="Remove GIF" onClick={() => setGif(null)} className="absolute top-1 right-1 rounded-full bg-white/80 p-0.5"><X className="size-3" /></button>
        </div>
      )}
      <div className="flex items-center gap-1">
        <GifPicker value={gif} onChange={setGif} />
        {settings.allowAuthorToggleAnonymity ? (
          <button type="button" onClick={() => setAnon((a) => !a)} aria-pressed={anon} className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-slate-600 hover:bg-slate-100">
            {anon ? <UserX className="size-3.5" /> : <UserRound className="size-3.5" />}
            {anon ? 'Anonymous' : 'Named'}
          </button>
        ) : (
          <span className="text-xs text-slate-500">{settings.anonymousByDefault ? 'Anonymous' : 'Named'}</span>
        )}
        <div className="ml-auto flex gap-1">
          {onClose && <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>}
          <Button size="sm" variant="primary" disabled={(!text.trim() && !gif) || busy} onClick={submit}>
            <Send className="size-3.5" /> Add
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CardEditor({ card, onDone }: { card: CardView; onDone: () => void }) {
  const { s, runCard } = useRetro();
  const [text, setText] = useState(card.text);
  const [gif, setGif] = useState<string | null>(card.gifId);
  const save = async () => {
    const t = text.trim();
    if (!t && !gif) return;
    if (await runCard('cards.edit', { retroId: s.board.id, cardId: card.id, text: t, gifId: gif, tags: extractTags(t) })) onDone();
  };
  return (
    <div onPointerDown={(e) => e.stopPropagation()}>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void save();
          }
          if (e.key === 'Escape') onDone();
        }}
        rows={3}
        maxLength={LIMITS.cardTextMax}
        aria-label="Edit card"
        className="w-full resize-none rounded border border-[var(--sp-border)] p-1.5 text-sm"
      />
      {gif && <Sticker id={gif} />}
      <div className="mt-1 flex items-center gap-1">
        <GifPicker value={gif} onChange={setGif} />
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={save}>Save</Button>
        </div>
      </div>
    </div>
  );
}
