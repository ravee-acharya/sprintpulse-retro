/**
 * Small, safe Markdown renderer for card text and comments. Produces React elements
 * (never innerHTML): **bold**, *italic*, ~~strike~~, `code`, [links](https://..),
 * bare URLs, "- " / "1. " lists, "> " quotes, and line breaks.
 */
import { Fragment, type ReactNode } from 'react';

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|~~[^~]+~~|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<]+[^\s<.,;:!?)])/g;

const SHORTCODES: Record<string, string> = {
  ':rocket:': '🚀', ':tada:': '🎉', ':fire:': '🔥', ':+1:': '👍', ':-1:': '👎', ':heart:': '❤️', ':100:': '💯', ':bug:': '🐛', ':warning:': '⚠️', ':coffee:': '☕',
};

function inline(text: string, onLink: (url: string) => void, keyBase: string): ReactNode[] {
  const withEmoji = text.replace(/:[a-z0-9+_-]+:/g, (m) => SHORTCODES[m] ?? m);
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of withEmoji.matchAll(INLINE)) {
    const tok = m[0];
    const at = m.index ?? 0;
    if (at > last) out.push(withEmoji.slice(last, at));
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith('**') || tok.startsWith('__')) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('~~')) out.push(<s key={k}>{tok.slice(2, -2)}</s>);
    else if (tok.startsWith('`')) out.push(<code key={k} className="rounded bg-black/5 px-1 py-0.5 text-[0.85em]">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('[')) {
      const mm = tok.match(/^\[([^\]]+)\]\((.+)\)$/)!;
      out.push(<LinkButton key={k} url={mm[2]!} label={mm[1]!} onLink={onLink} />);
    } else if (tok.startsWith('http')) out.push(<LinkButton key={k} url={tok} label={tok} onLink={onLink} />);
    else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = at + tok.length;
  }
  if (last < withEmoji.length) out.push(withEmoji.slice(last));
  return out;
}

function LinkButton({ url, label, onLink }: { url: string; label: string; onLink: (u: string) => void }) {
  return (
    <a
      href={url}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onLink(url);
      }}
      className="break-all text-brand-600 underline underline-offset-2 hover:text-brand-700"
    >
      {label}
    </a>
  );
}

export function Markdown({ text, onLink, className }: { text: string; onLink: (url: string) => void; className?: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={`l${blocks.length}`} className={`${list.ordered ? 'list-decimal' : 'list-disc'} my-1 pl-5`}>
        {list.items.map((it, i) => (
          <li key={i}>{inline(it, onLink, `li${blocks.length}-${i}`)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };
  lines.forEach((line, idx) => {
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((ul ?? ol)![1]!);
      return;
    }
    flush();
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      blocks.push(
        <blockquote key={`q${idx}`} className="my-1 border-l-2 border-black/20 pl-2 text-[var(--sp-text-subtle)]">
          {inline(quote[1]!, onLink, `q${idx}`)}
        </blockquote>,
      );
    } else if (line.trim()) {
      blocks.push(<p key={`p${idx}`}>{inline(line, onLink, `p${idx}`)}</p>);
    } else if (idx > 0 && idx < lines.length - 1) {
      blocks.push(<div key={`b${idx}`} className="h-2" />);
    }
  });
  flush();
  return <div className={`break-words [&_p]:leading-snug ${className ?? ''}`}>{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
