/**
 * Small, dependency-free SVG charts for the team-health view.
 * Specs: 2px lines, >=8px markers with a 2px surface ring, <=24px columns with a 4px
 * rounded data-end, 2px surface gap between stacked segments, hairline solid grid,
 * text in text tokens (never series colour), hover tooltips, and a table view.
 * Palette (validated: CVD dE 24.7, normal-vision dE 33.6 on #fcfcfb):
 *   series-1 #2a78d6 (blue), series-2 #eb6834 (orange).
 */
import { useId, useState, type ReactNode } from 'react';
import { Table2 } from 'lucide-react';
import { cx } from './ui';

export const SERIES = { s1: '#2a78d6', s2: '#eb6834' };
const SURFACE = '#ffffff';
const GRID = '#e8eaee';
const TEXT_2 = '#52514e';
const TEXT_3 = '#7a7975';

const W = 640;
const PAD = { top: 18, right: 44, bottom: 34, left: 34 };

function ChartFrame({ title, subtitle, legend, children, table }: { title: string; subtitle?: string; legend?: ReactNode; children: ReactNode; table: ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className="rounded-xl border border-[var(--sp-border)] bg-white p-4">
      <div className="mb-2 flex items-start gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="text-xs text-[var(--sp-text-subtle)]">{subtitle}</p>}
        </div>
        <button type="button" aria-pressed={showTable} onClick={() => setShowTable((t) => !t)} className={cx('ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-slate-100', showTable ? 'text-brand-700' : 'text-slate-500')}>
          <Table2 className="size-3.5" /> {showTable ? 'Chart' : 'Table'}
        </button>
      </div>
      {legend}
      {showTable ? <div className="max-h-72 overflow-auto">{table}</div> : children}
    </section>
  );
}

function Tooltip({ x, y, h, children }: { x: number; y: number; h: number; children: ReactNode }) {
  // x/y in viewBox units -> percentages so it tracks the responsive SVG.
  const left = (x / W) * 100;
  const top = (y / h) * 100;
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-md bg-slate-900 px-2 py-1.5 text-xs whitespace-nowrap text-white shadow-lg"
      style={{ left: `${left}%`, top: `${top}%`, transform: `translate(${left > 70 ? '-105%' : '8px'}, -50%)` }}
    >
      {children}
    </div>
  );
}

export interface LinePoint {
  label: string;
  sublabel?: string;
  value: number | null;
}

export function LineChart({ title, subtitle, points, yMin, yMax, yTicks, format = (v) => v.toFixed(1), valueName, height = 220 }: {
  title: string;
  subtitle?: string;
  points: LinePoint[];
  yMin: number;
  yMax: number;
  yTicks: number[];
  format?: (v: number) => string;
  valueName: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId();
  const plotW = W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  const defined = points.map((p, i) => ({ ...p, i })).filter((p): p is LinePoint & { i: number; value: number } => p.value !== null);
  const path = defined.map((p, k) => `${k ? 'L' : 'M'}${x(p.i)},${y(p.value)}`).join(' ');
  const area = defined.length > 1 ? `${path} L${x(defined.at(-1)!.i)},${y(yMin)} L${x(defined[0]!.i)},${y(yMin)} Z` : '';
  const last = defined.at(-1);
  const hp = hover !== null ? points[hover] : null;

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      table={
        <table className="w-full text-left text-xs">
          <thead className="text-slate-500"><tr><th className="py-1">Retro</th><th>{valueName}</th></tr></thead>
          <tbody>{points.map((p, i) => <tr key={i} className="border-t border-[var(--sp-border)]"><td className="py-1">{p.label}{p.sublabel ? ` · ${p.sublabel}` : ''}</td><td className="tabular-nums">{p.value === null ? '-' : format(p.value)}</td></tr>)}</tbody>
        </table>
      }
    >
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={`${title}. ${defined.map((p) => `${p.label}: ${format(p.value)}`).join(', ')}`}>
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={TEXT_3}>{t}</text>
            </g>
          ))}
          {points.map((p, i) => (
            <text key={i} x={x(i)} y={height - 12} textAnchor="middle" fontSize={11} fill={TEXT_2}>
              {points.length > 8 && i % 2 && i !== points.length - 1 ? '' : p.label}
            </text>
          ))}
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={SERIES.s1} stopOpacity={0.14} />
              <stop offset="1" stopColor={SERIES.s1} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {area && <path d={area} fill={`url(#${gid})`} />}
          <path d={path} fill="none" stroke={SERIES.s1} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke={TEXT_3} strokeWidth={1} />}
          {defined.map((p) => (
            <circle key={p.i} cx={x(p.i)} cy={y(p.value)} r={hover === p.i ? 6 : 4} fill={SERIES.s1} stroke={SURFACE} strokeWidth={2} />
          ))}
          {last && (
            <text x={x(last.i) + 10} y={y(last.value)} dy="0.32em" fontSize={12} fontWeight={600} fill="#172b4d">{format(last.value)}</text>
          )}
          {/* Hit areas: full-height bands, wider than the dots. */}
          {points.map((_, i) => {
            const half = points.length <= 1 ? plotW / 2 : plotW / (points.length - 1) / 2;
            return <rect key={i} x={x(i) - half} y={PAD.top} width={half * 2} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />;
          })}
        </svg>
        {hp && hover !== null && (
          <Tooltip x={x(hover)} y={hp.value !== null ? y(hp.value) : PAD.top + plotH / 2} h={height}>
            <div className="font-semibold">{hp.label}{hp.sublabel ? ` · ${hp.sublabel}` : ''}</div>
            <div className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: SERIES.s1 }} />{valueName}: {hp.value === null ? 'no check-ins' : format(hp.value)}</div>
          </Tooltip>
        )}
      </div>
    </ChartFrame>
  );
}

export interface StackDatum {
  label: string;
  sublabel?: string;
  a: number;
  b: number;
}

export function StackedColumns({ title, subtitle, data, names, height = 220 }: { title: string; subtitle?: string; data: StackDatum[]; names: [string, string]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const plotW = W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const max = Math.max(1, ...data.map((d) => d.a + d.b));
  const step = max <= 5 ? 1 : max <= 10 ? 2 : Math.ceil(max / 5);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const band = plotW / Math.max(1, data.length);
  const colW = Math.min(24, band * 0.6);
  const cx_ = (i: number) => PAD.left + band * i + band / 2;
  const h = (v: number) => (v / top) * plotH;
  const base = PAD.top + plotH;
  const GAP = 2;
  const hd = hover !== null ? data[hover] : null;

  /** Rect with only the top corners rounded (data-end), square at the baseline. */
  const topRounded = (x0: number, y0: number, w: number, hh: number) => {
    const r = Math.min(4, hh, w / 2);
    return `M${x0},${y0 + hh} L${x0},${y0 + r} Q${x0},${y0} ${x0 + r},${y0} L${x0 + w - r},${y0} Q${x0 + w},${y0} ${x0 + w},${y0 + r} L${x0 + w},${y0 + hh} Z`;
  };

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      legend={
        <div className="mb-1 flex gap-4 text-xs text-[var(--sp-text-subtle)]">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: SERIES.s1 }} />{names[0]}</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: SERIES.s2 }} />{names[1]}</span>
        </div>
      }
      table={
        <table className="w-full text-left text-xs">
          <thead className="text-slate-500"><tr><th className="py-1">Retro</th><th>{names[0]}</th><th>{names[1]}</th></tr></thead>
          <tbody>{data.map((d, i) => <tr key={i} className="border-t border-[var(--sp-border)]"><td className="py-1">{d.label}{d.sublabel ? ` · ${d.sublabel}` : ''}</td><td className="tabular-nums">{d.a}</td><td className="tabular-nums">{d.b}</td></tr>)}</tbody>
        </table>
      }
    >
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={`${title}. ${data.map((d) => `${d.label}: ${d.a} ${names[0]}, ${d.b} ${names[1]}`).join('; ')}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={base - h(t)} y2={base - h(t)} stroke={GRID} strokeWidth={1} />
              <text x={PAD.left - 8} y={base - h(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={TEXT_3}>{t}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x0 = cx_(i) - colW / 2;
            const ha = h(d.a);
            const hb = h(d.b);
            const total = d.a + d.b;
            return (
              <g key={i} opacity={hover === null || hover === i ? 1 : 0.55}>
                {d.a > 0 && (d.b > 0 ? <rect x={x0} y={base - ha} width={colW} height={ha} fill={SERIES.s1} /> : <path d={topRounded(x0, base - ha, colW, ha)} fill={SERIES.s1} />)}
                {d.b > 0 && <path d={topRounded(x0, base - ha - hb, colW, Math.max(0, hb - (d.a > 0 ? GAP : 0)))} fill={SERIES.s2} />}
                {total > 0 && <text x={cx_(i)} y={base - ha - hb - 6} textAnchor="middle" fontSize={11} fill={TEXT_2}>{total}</text>}
                <text x={cx_(i)} y={height - 12} textAnchor="middle" fontSize={11} fill={TEXT_2}>{data.length > 8 && i % 2 && i !== data.length - 1 ? '' : d.label}</text>
                <rect x={cx_(i) - band / 2} y={PAD.top} width={band} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
              </g>
            );
          })}
        </svg>
        {hd && hover !== null && (
          <Tooltip x={cx_(hover)} y={Math.max(PAD.top + 20, base - h(hd.a + hd.b))} h={height}>
            <div className="font-semibold">{hd.label}{hd.sublabel ? ` · ${hd.sublabel}` : ''}</div>
            <div className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: SERIES.s1 }} />{names[0]}: {hd.a}</div>
            <div className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: SERIES.s2 }} />{names[1]}: {hd.b}</div>
          </Tooltip>
        )}
      </div>
    </ChartFrame>
  );
}

/** Ranked horizontal bars for recurring topics (single series: no legend). */
export function TopicBars({ topics }: { topics: Array<{ topic: string; count: number; retros: number }> }) {
  const max = Math.max(1, ...topics.map((t) => t.retros));
  return (
    <section className="rounded-xl border border-[var(--sp-border)] bg-white p-4">
      <h3 className="text-sm font-semibold">Recurring topics</h3>
      <p className="mb-3 text-xs text-[var(--sp-text-subtle)]">How many retros each card tag or group theme came up in</p>
      {!topics.length ? (
        <p className="py-6 text-center text-sm text-slate-500">No recurring topics yet - tag cards with #hashtags or group them into themes.</p>
      ) : (
        <ul className="space-y-1.5">
          {topics.map((t) => (
            <li key={t.topic} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-sm" title={`${t.count} mention(s) across ${t.retros} retro(s)`}>
              <span className="truncate">{t.topic}</span>
              <span className="h-2.5 rounded-r-[4px]" style={{ width: `${(t.retros / max) * 100}%`, background: SERIES.s1, minWidth: 4 }} />
              <span className="text-xs text-slate-500 tabular-nums">{t.retros} retro{t.retros === 1 ? '' : 's'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
