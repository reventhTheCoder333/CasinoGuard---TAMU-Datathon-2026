import { useEffect, useRef, useState, type ReactNode } from "react";

/** Small SVG charts in CASINOGUARD's style: thin marks, recessive grid, hover tooltips. */

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);

  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

function niceMax(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= value)!;
  return step * power;
}

export interface BarDatum {
  key: string;
  label: ReactNode;
  value: number;
  color: string;
  detail?: string;
}

/** Horizontal bars with a direct value label. Clicking a bar selects it. */
export function HBarChart({
  data,
  format,
  selected,
  onSelect,
  emptyText,
}: {
  data: BarDatum[];
  format: (value: number) => string;
  selected?: string | null;
  onSelect?: (key: string) => void;
  emptyText: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 0);

  if (!data.length || max === 0) return <p className="chart-empty">{emptyText}</p>;

  return (
    <div className="hbar-chart" role="list">
      {data.map((d) => {
        const dimmed = selected && selected !== d.key;
        const Tag = onSelect ? "button" : "div";
        return (
          <Tag
            key={d.key}
            role="listitem"
            className={`hbar-row ${dimmed ? "dimmed" : ""} ${selected === d.key ? "selected" : ""}`}
            onClick={onSelect ? () => onSelect(d.key) : undefined}
            title={d.detail}
            aria-pressed={onSelect ? selected === d.key : undefined}
          >
            <span className="hbar-label">{d.label}</span>
            <span className="hbar-track">
              <span className="hbar-fill" style={{ width: `${(d.value / max) * 100}%`, background: d.color }} />
            </span>
            <span className="hbar-value mono">{format(d.value)}</span>
          </Tag>
        );
      })}
    </div>
  );
}

export interface ColumnDatum {
  key: string;
  label: string;
  tooltip: string;
  segments: { value: number; color: string }[];
}

/** Stacked columns over time, with a hover tooltip per column. */
export function StackedColumnChart({
  data,
  format,
  legend,
  emptyText,
  height = 200,
}: {
  data: ColumnDatum[];
  format: (value: number) => string;
  legend: { label: string; color: string }[];
  emptyText: string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  if (!data.length) return <p className="chart-empty">{emptyText}</p>;

  const totals = data.map((d) => d.segments.reduce((sum, s) => sum + s.value, 0));
  const max = niceMax(Math.max(...totals));
  const margin = { top: 8, right: 8, bottom: 24, left: 46 };
  const innerW = Math.max(width - margin.left - margin.right, 10);
  const innerH = height - margin.top - margin.bottom;
  const slot = innerW / data.length;
  const barW = Math.max(Math.min(slot * 0.7, 36), 2);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.ceil(data.length / Math.max(Math.floor(innerW / 56), 1));
  const y = (v: number) => innerH - (v / max) * innerH;

  return (
    <div className="column-chart" ref={ref}>
      <div className="chart-legend">
        {legend.map((l) => (
          <span key={l.label}><i style={{ background: l.color }} />{l.label}</span>
        ))}
      </div>
      <svg width={width} height={height} role="img" aria-label="Column chart">
        <g transform={`translate(${margin.left},${margin.top})`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={innerW} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={-6} y={y(t)} className="chart-axis" textAnchor="end" dominantBaseline="middle">{format(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            let top = innerH;
            const x = i * slot + (slot - barW) / 2;
            return (
              <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={i * slot} y={0} width={slot} height={innerH} fill="transparent" />
                {d.segments.map((s, j) => {
                  const h = (s.value / max) * innerH;
                  top -= h;
                  return h > 0 ? <rect key={j} x={x} y={top} width={barW} height={Math.max(h - 1, 0.5)} rx={1.5} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.45} /> : null;
                })}
                {i % labelEvery === 0 && (
                  <text x={i * slot + slot / 2} y={innerH + 15} className="chart-axis" textAnchor="middle">{d.label}</text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      {hover !== null && (
        <div
          className="chart-tooltip"
          style={{ left: Math.min(margin.left + hover * slot + slot / 2, width - 150), top: 28 }}
        >
          {data[hover].tooltip}
        </div>
      )}
    </div>
  );
}
