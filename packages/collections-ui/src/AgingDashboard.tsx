import * as React from "react";
import {
  Badge,
  Caption1,
  Subtitle2,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  ToggleButton,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { DashboardFilters, DashboardSpec } from "@collections/contract";
import type { DashboardData } from "@collections/domain";
import { StackedBarChart } from "./StackedBarChart";
import { formatDate, formatMoney } from "./format";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM, padding: tokens.spacingVerticalM, fontFamily: tokens.fontFamilyBase },
  header: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: tokens.spacingHorizontalM, flexWrap: "wrap" },
  filters: { display: "flex", gap: tokens.spacingHorizontalXS, flexWrap: "wrap", alignItems: "center" },
  num: { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  totalRow: { fontWeight: tokens.fontWeightSemibold },
  muted: { color: tokens.colorNeutralForeground3 },
  tableWrap: { overflowX: "auto" },
});

export interface AgingDashboardProps {
  spec: DashboardSpec;
  data: DashboardData;
  /** When provided, bucket chips become toggles; the host persists the change. */
  onFiltersChange?: (filters: DashboardFilters) => void;
  /** Extra controls (e.g. "Show in app") rendered in the header. */
  actions?: React.ReactNode;
  dark?: boolean;
  maxRows?: number;
}

/** Spec-driven aging dashboard: overdue by customer × aging bucket, as a stacked bar chart and a matrix. */
export function AgingDashboard({ spec, data, onFiltersChange, actions, dark, maxRows = 10 }: AgingDashboardProps) {
  const styles = useStyles();
  const measure = data.measure;
  const fmt = (v: number) => (measure === "invoiceCount" ? String(v) : formatMoney(v, data.currency));
  const selected = spec.filters.bucketIds ?? [];
  const showChart = spec.visual !== "table";
  const showTable = spec.visual !== "stackedBar";

  const toggleBucket = (id: string) => {
    if (!onFiltersChange) return;
    const all = spec.buckets.map((b) => b.id);
    const current = selected.length ? selected : all;
    const next = current.includes(id) ? current.filter((b) => b !== id) : all.filter((b) => b === id || current.includes(b));
    // Empty or "everything" both mean: no bucket filter.
    onFiltersChange({ ...spec.filters, bucketIds: next.length && next.length < all.length ? next : undefined });
  };

  return (
    <section className={styles.root} aria-label={spec.title}>
      <div className={styles.header}>
        <div>
          <Subtitle2>{spec.title}</Subtitle2>
          <div>
            <Caption1 className={styles.muted}>
              {measureLabel(measure)} · as of {formatDate(data.asOf)} · v{spec.version} ({spec.updatedBy})
            </Caption1>
          </div>
        </div>
        <Badge appearance="tint" color="informative" size="large">
          Total {fmt(data.totals[measure])}
        </Badge>
      </div>

      <div className={styles.filters} role="group" aria-label="Aging buckets">
        {spec.buckets.map((b) => (
          <ToggleButton
            key={b.id}
            size="small"
            shape="circular"
            checked={selected.length === 0 || selected.includes(b.id)}
            disabled={!onFiltersChange}
            onClick={() => toggleBucket(b.id)}
          >
            {b.label}
          </ToggleButton>
        ))}
        {spec.filters.minAmount !== undefined && <Badge appearance="outline">≥ {formatMoney(spec.filters.minAmount, data.currency, true)}</Badge>}
        {spec.filters.customerNos?.length ? <Badge appearance="outline">{spec.filters.customerNos.length} customer(s)</Badge> : null}
        {actions}
      </div>

      {data.rows.length === 0 ? (
        <Caption1 className={styles.muted}>No open invoices match this dashboard's filters.</Caption1>
      ) : (
        <>
          {showChart && <StackedBarChart data={data} dark={dark} maxRows={maxRows} />}
          {showTable && (
            <div className={styles.tableWrap}>
              <Table size="small" aria-label={`${spec.title} (table)`}>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>{dimensionLabel(spec.groupBy[0])}</TableHeaderCell>
                    {data.columns.map((c) => (
                      <TableHeaderCell key={c.key} className={styles.num}>
                        {c.label}
                      </TableHeaderCell>
                    ))}
                    <TableHeaderCell className={styles.num}>Total</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.slice(0, maxRows).map((r) => (
                    <TableRow key={r.key}>
                      <TableCell>{r.label}</TableCell>
                      {data.columns.map((c) => (
                        <TableCell key={c.key} className={styles.num}>
                          {r.cells[c.key]?.[measure] ? fmt(r.cells[c.key]![measure]) : "–"}
                        </TableCell>
                      ))}
                      <TableCell className={styles.num}>{fmt(r.total[measure])}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className={styles.totalRow}>
                    <TableCell>All {data.rows.length > maxRows ? `(${data.rows.length})` : ""}</TableCell>
                    {data.columns.map((c) => (
                      <TableCell key={c.key} className={styles.num}>
                        {fmt(data.totals.byColumn[c.key]?.[measure] ?? 0)}
                      </TableCell>
                    ))}
                    <TableCell className={styles.num}>{fmt(data.totals[measure])}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function measureLabel(m: DashboardData["measure"]): string {
  return { overdueAmount: "Overdue amount", openAmount: "Open amount", invoiceCount: "Invoice count" }[m];
}

function dimensionLabel(d: DashboardSpec["groupBy"][number]): string {
  return { customer: "Customer", agingBucket: "Aging bucket", salesperson: "Salesperson", currency: "Currency" }[d];
}
