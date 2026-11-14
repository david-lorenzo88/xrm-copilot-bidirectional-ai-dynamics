import * as React from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import type { DashboardData } from "@collections/domain";
import { formatMoney } from "./format";
import { bucketColor } from "./palette";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  legend: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalM, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 },
  swatch: { display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", marginRight: "6px", verticalAlign: "middle" },
  readout: { minHeight: "18px", fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 },
  svg: { width: "100%", height: "auto", overflow: "visible" },
});

export interface StackedBarChartProps {
  data: DashboardData;
  maxRows?: number;
  dark?: boolean;
}

const ROW_H = 26;
const BAR_H = 16;
const LABEL_W = 170;
const WIDTH = 640;
const VALUE_W = 80;
const GAP = 2;

/** Rect with only the right (data-end) corners rounded; the baseline end stays square. */
function dataEndPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return `M${x},${y}H${x + w - rr}A${rr},${rr} 0 0 1 ${x + w},${y + rr}V${y + h - rr}A${rr},${rr} 0 0 1 ${x + w - rr},${y + h}H${x}Z`;
}

/** Horizontal stacked bars: one bar per row, one segment per column (aging bucket). Plain SVG. */
export function StackedBarChart({ data, maxRows = 10, dark = false }: StackedBarChartProps) {
  const styles = useStyles();
  const [hover, setHover] = React.useState<string | undefined>();
  const rows = data.rows.slice(0, maxRows);
  const max = Math.max(1, ...rows.map((r) => r.total[data.measure]));
  const plotW = WIDTH - LABEL_W - VALUE_W;
  const height = rows.length * ROW_H + 4;
  const fmt = (v: number) => (data.measure === "invoiceCount" ? String(v) : formatMoney(v, data.currency, true));

  return (
    <div className={styles.root}>
      <div className={styles.legend} aria-hidden="true">
        {data.columns.map((c, i) => (
          <span key={c.key}>
            <span className={styles.swatch} style={{ background: bucketColor(i, data.columns.length, dark) }} />
            {c.label}
          </span>
        ))}
      </div>
      <div className={styles.readout} aria-live="polite">
        {hover ?? "Hover a segment for details"}
      </div>
      <svg className={styles.svg} viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label="Overdue amount by customer and aging bucket">
        {rows.map((row, ri) => {
          const y = ri * ROW_H + (ROW_H - BAR_H) / 2;
          let x = LABEL_W;
          const segments = data.columns
            .map((c, ci) => ({ c, ci, v: row.cells[c.key]?.[data.measure] ?? 0 }))
            .filter((s) => s.v > 0);
          return (
            <g key={row.key}>
              <text x={LABEL_W - 8} y={y + BAR_H - 4} textAnchor="end" fontSize={12} style={{ fill: tokens.colorNeutralForeground1 }}>
                {row.label.length > 24 ? `${row.label.slice(0, 23)}…` : row.label}
              </text>
              {segments.map((s, si) => {
                const w = (s.v / max) * plotW;
                const segX = x;
                x += w;
                const drawW = Math.max(0.5, si < segments.length - 1 ? w - GAP : w);
                const label = `${row.label} · ${s.c.label}: ${fmt(s.v)}`;
                const fill = bucketColor(s.ci, data.columns.length, dark);
                const isLast = si === segments.length - 1;
                const common = {
                  fill,
                  opacity: hover && hover !== label ? 0.55 : 1,
                  onMouseEnter: () => setHover(label),
                  onMouseLeave: () => setHover(undefined),
                };
                return isLast ? (
                  <path key={s.c.key} d={dataEndPath(segX, y, drawW, BAR_H, 4)} {...common}>
                    <title>{label}</title>
                  </path>
                ) : (
                  <rect key={s.c.key} x={segX} y={y} width={drawW} height={BAR_H} {...common}>
                    <title>{label}</title>
                  </rect>
                );
              })}
              <text x={x + 6} y={y + BAR_H - 4} fontSize={12} style={{ fill: tokens.colorNeutralForeground2 }}>
                {fmt(row.total[data.measure])}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
