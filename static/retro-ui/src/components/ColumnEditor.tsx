/** Custom template builder: add / rename / reorder / colour-code columns. */
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { LIMITS } from '@shared/catalog';
import type { ColumnColor } from '@shared/types';
import { COLUMN_STYLES, cx } from './ui';

export interface EditableColumn {
  id?: string;
  title: string;
  prompt: string;
  color: ColumnColor;
  emoji: string;
}

const COLORS = Object.keys(COLUMN_STYLES) as ColumnColor[];

export function ColumnEditor({ columns, onChange }: { columns: EditableColumn[]; onChange: (c: EditableColumn[]) => void }) {
  const update = (i: number, patch: Partial<EditableColumn>) => onChange(columns.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i: number, d: -1 | 1) => {
    const next = columns.slice();
    const [c] = next.splice(i, 1);
    next.splice(i + d, 0, c!);
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {columns.map((c, i) => (
        <div key={c.id ?? i} className="flex items-start gap-2 rounded-lg border border-[var(--sp-border)] bg-white p-2">
          <div className={cx('mt-1 h-14 w-1.5 shrink-0 rounded-full', COLUMN_STYLES[c.color].bar)} />
          <div className="grid flex-1 grid-cols-[3rem_1fr] gap-1.5">
            <input aria-label="Emoji" value={c.emoji} maxLength={8} onChange={(e) => update(i, { emoji: e.target.value })} className="rounded border border-[var(--sp-border)] px-1 text-center" />
            <input
              aria-label="Column title"
              value={c.title}
              maxLength={LIMITS.columnTitleMax}
              placeholder="Column title"
              onChange={(e) => update(i, { title: e.target.value })}
              className="rounded border border-[var(--sp-border)] px-2 py-1 text-sm font-medium"
            />
            <div className="col-span-2 flex items-center gap-2">
              <input
                aria-label="Prompt"
                value={c.prompt}
                maxLength={120}
                placeholder="Prompt shown under the title (optional)"
                onChange={(e) => update(i, { prompt: e.target.value })}
                className="flex-1 rounded border border-[var(--sp-border)] px-2 py-1 text-xs"
              />
              <div className="flex gap-1" role="radiogroup" aria-label="Colour">
                {COLORS.map((col) => (
                  <button
                    key={col}
                    type="button"
                    role="radio"
                    aria-checked={c.color === col}
                    aria-label={col}
                    onClick={() => update(i, { color: col })}
                    className={cx('size-4 rounded-full', COLUMN_STYLES[col].bar, c.color === col && 'ring-2 ring-offset-1 ring-slate-700')}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col">
            <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-0.5 text-slate-500 hover:bg-black/5 disabled:opacity-30">
              <ArrowUp className="size-3.5" />
            </button>
            <button type="button" aria-label="Move down" disabled={i === columns.length - 1} onClick={() => move(i, 1)} className="rounded p-0.5 text-slate-500 hover:bg-black/5 disabled:opacity-30">
              <ArrowDown className="size-3.5" />
            </button>
            <button type="button" aria-label="Remove column" disabled={columns.length <= LIMITS.columnsMin} onClick={() => onChange(columns.filter((_, j) => j !== i))} className="rounded p-0.5 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30">
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      ))}
      {columns.length < LIMITS.columnsMax && (
        <button
          type="button"
          onClick={() => onChange([...columns, { title: '', prompt: '', color: COLORS[columns.length % COLORS.length]!, emoji: '' }])}
          className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          <Plus className="size-4" /> Add column
        </button>
      )}
    </div>
  );
}
