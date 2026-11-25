import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { GIF_PACK } from '@shared/catalog';
import type { ColumnColor, JiraUser } from '@shared/types';

export const cx = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ variant = 'secondary', size = 'md', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-9 px-3 text-sm',
        variant === 'primary' && 'bg-brand-500 text-white hover:bg-brand-600',
        variant === 'secondary' && 'border border-[var(--sp-border)] bg-white text-[var(--sp-text)] hover:bg-slate-50',
        variant === 'ghost' && 'text-[var(--sp-text-subtle)] hover:bg-black/5',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        className,
      )}
    />
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2 text-sm select-none', disabled && 'cursor-not-allowed opacity-50')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative h-5 w-9 rounded-full transition', checked ? 'bg-brand-500' : 'bg-slate-300')}
      >
        <span className={cx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      {label}
    </label>
  );
}

export function Modal({ open, onClose, title, children, width = 'max-w-lg', footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input,textarea,select,button:not([data-close])')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" className={cx('w-full rounded-xl bg-white shadow-2xl', width)}>
        <div className="flex items-center justify-between border-b border-[var(--sp-border)] px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button data-close type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-black/5">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-[var(--sp-border)] px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Closes when clicking outside. */
export function Popover({ open, onClose, children, className }: { open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => (window.removeEventListener('mousedown', onDown), window.removeEventListener('keydown', onKey));
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} className={cx('absolute z-40 rounded-lg border border-[var(--sp-border)] bg-white p-2 shadow-xl', className)}>
      {children}
    </div>
  );
}

const AVATAR_COLORS = ['bg-rose-500', 'bg-amber-500', 'bg-emerald-500', 'bg-sky-500', 'bg-violet-500', 'bg-pink-500', 'bg-teal-500', 'bg-indigo-500'];
const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

export function Avatar({ user, id, size = 24, anonymous }: { user: JiraUser | null; id?: string | null; size?: number; anonymous?: boolean }) {
  const style = { width: size, height: size, fontSize: size * 0.42 };
  if (anonymous) {
    return <span style={style} className="grid shrink-0 place-items-center rounded-full bg-slate-400 text-white" title="Anonymous">?</span>;
  }
  if (user?.avatarUrl) return <img src={user.avatarUrl} alt={user.displayName} title={user.displayName} style={style} className="shrink-0 rounded-full" />;
  const name = user?.displayName ?? '…';
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span style={style} title={name} className={cx('grid shrink-0 place-items-center rounded-full font-semibold text-white', AVATAR_COLORS[hash(id ?? name) % AVATAR_COLORS.length])}>
      {initials}
    </span>
  );
}

/* Bundled reaction "GIFs": animated sticker tiles rendered in CSS - no external hosts. */
const STICKERS: Record<string, { emoji: string; anim: string; bg: string }> = {
  applause: { emoji: '👏', anim: 'sp-anim-shake', bg: 'from-amber-200 to-orange-300' },
  facepalm: { emoji: '🤦', anim: 'sp-anim-tilt', bg: 'from-slate-200 to-slate-300' },
  'mind-blown': { emoji: '🤯', anim: 'sp-anim-pop', bg: 'from-fuchsia-200 to-purple-300' },
  party: { emoji: '🥳', anim: 'sp-anim-bounce', bg: 'from-pink-200 to-rose-300' },
  'thumbs-up': { emoji: '👍', anim: 'sp-anim-bounce', bg: 'from-emerald-200 to-green-300' },
  'this-is-fine': { emoji: '🔥', anim: 'sp-anim-flicker', bg: 'from-orange-200 to-red-300' },
  rocket: { emoji: '🚀', anim: 'sp-anim-launch', bg: 'from-sky-200 to-indigo-300' },
  thinking: { emoji: '🤔', anim: 'sp-anim-tilt', bg: 'from-yellow-100 to-amber-200' },
  'high-five': { emoji: '🙌', anim: 'sp-anim-shake', bg: 'from-teal-200 to-cyan-300' },
  sleepy: { emoji: '😴', anim: 'sp-anim-float', bg: 'from-indigo-100 to-slate-300' },
  coffee: { emoji: '☕', anim: 'sp-anim-float', bg: 'from-amber-100 to-yellow-700/40' },
  celebrate: { emoji: '🎉', anim: 'sp-anim-pop', bg: 'from-lime-200 to-emerald-300' },
};

export function Sticker({ id, size = 'md' }: { id: string; size?: 'sm' | 'md' }) {
  const s = STICKERS[id];
  const label = GIF_PACK.find((g) => g.id === id)?.label ?? id;
  if (!s) return null;
  return (
    <div className={cx('flex flex-col items-center justify-center rounded-lg bg-gradient-to-br', s.bg, size === 'sm' ? 'h-14 w-16' : 'h-24 w-full')} title={label}>
      <span className={cx(s.anim, size === 'sm' ? 'text-2xl' : 'text-4xl')}>{s.emoji}</span>
      {size === 'md' && <span className="mt-1 text-[10px] font-semibold tracking-wide text-black/50 uppercase">{label}</span>}
    </div>
  );
}

export const COLUMN_STYLES: Record<ColumnColor, { bar: string; soft: string; text: string; ring: string }> = {
  green: { bar: 'bg-emerald-500', soft: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-400' },
  red: { bar: 'bg-rose-500', soft: 'bg-rose-50', text: 'text-rose-700', ring: 'ring-rose-400' },
  blue: { bar: 'bg-sky-500', soft: 'bg-sky-50', text: 'text-sky-700', ring: 'ring-sky-400' },
  yellow: { bar: 'bg-amber-400', soft: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-400' },
  purple: { bar: 'bg-violet-500', soft: 'bg-violet-50', text: 'text-violet-700', ring: 'ring-violet-400' },
  teal: { bar: 'bg-teal-500', soft: 'bg-teal-50', text: 'text-teal-700', ring: 'ring-teal-400' },
  orange: { bar: 'bg-orange-500', soft: 'bg-orange-50', text: 'text-orange-700', ring: 'ring-orange-400' },
  gray: { bar: 'bg-slate-500', soft: 'bg-slate-50', text: 'text-slate-700', ring: 'ring-slate-400' },
};

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent', className)} />;
}
