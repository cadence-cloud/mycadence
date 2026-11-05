"use client";
import { useState } from "react";
import { formatDate } from "@/lib/time";

/**
 * Single-series measure over time. One hue (brand navy),
 * 2px line, 8px markers with a surface ring, recessive axis, per-point hover.
 * Values are only what was recorded — no trend lines, projections, or targets.
 */
const SERIES = "#005596"; // brand navy

export function MeasureChart({ points, unit, label }: { points: { date: string; value: number }[]; unit: string; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return null;
  const W = 560, H = 140, PL = 36, PR = 12, PT = 14, PB = 24;
  const toDay = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
  const xs = points.map((p) => toDay(p.date));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const vmax = Math.max(...points.map((p) => p.value));
  const yMax = vmax === 0 ? 1 : niceCeil(vmax);
  const sx = (d: number) => PL + ((d - x0) / Math.max(1, x1 - x0)) * (W - PL - PR);
  const sy = (v: number) => PT + (1 - v / yMax) * (H - PT - PB);
  const path = points.map((p, i) => `${i ? "L" : "M"}${sx(xs[i]).toFixed(1)},${sy(p.value).toFixed(1)}`).join("");
  const h = hover != null ? points[hover] : null;
  return (
    <div className="relative mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${label} over time. Exact values are in the table below.`}>
        {[0, yMax / 2, yMax].map((t) => (
          <g key={t}>
            <line x1={PL} x2={W - PR} y1={sy(t)} y2={sy(t)} stroke="#e4ded0" strokeWidth={1} />
            <text x={PL - 6} y={sy(t) + 4} textAnchor="end" fontSize={11} fill="#5c6058">{+t.toFixed(1)}</text>
          </g>
        ))}
        <text x={PL} y={H - 6} fontSize={11} fill="#5c6058">{formatDate(points[0].date, { month: "short", day: "numeric" })}</text>
        <text x={W - PR} y={H - 6} fontSize={11} fill="#5c6058" textAnchor="end">{formatDate(points[points.length - 1].date, { month: "short", day: "numeric" })}</text>
        <path d={path} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${formatDate(p.date)}: ${p.value} ${unit}`}>
            <circle cx={sx(xs[i])} cy={sy(p.value)} r={14} fill="transparent" />
            <circle cx={sx(xs[i])} cy={sy(p.value)} r={hover === i ? 5.5 : 4} fill={SERIES} stroke="#fff" strokeWidth={2} />
          </g>
        ))}
      </svg>
      {h && hover != null && (
        <div className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-sand-200 bg-white px-2.5 py-1.5 text-xs shadow-sm" style={{ left: `${(sx(xs[hover]) / W) * 100}%`, top: `${(sy(h.value) / H) * 100}%` }}>
          <span className="block text-muted">{formatDate(h.date, { month: "short", day: "numeric" })}</span>
          <span className="font-semibold text-ink">{h.value} {unit}</span>
        </div>
      )}
    </div>
  );
}

function niceCeil(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
