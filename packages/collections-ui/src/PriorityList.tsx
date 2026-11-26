import * as React from "react";
import {
  Badge,
  Button,
  Caption1,
  Subtitle2,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { WorklistItem } from "@collections/domain";
import { InvoiceCard, overdueBadgeColor } from "./InvoiceCard";
import { formatMoney } from "./format";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM, padding: tokens.spacingVerticalM, fontFamily: tokens.fontFamilyBase },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: tokens.spacingHorizontalM, flexWrap: "wrap" },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap" },
  nowrap: { whiteSpace: "nowrap" },
  cards: { display: "flex", gap: tokens.spacingHorizontalM, flexWrap: "wrap" },
  num: { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  tableWrap: { overflowX: "auto" },
});

export interface PriorityListProps {
  items: WorklistItem[];
  title?: string;
  subtitle?: string;
  /** "Open critical invoices": the host turns this into OpenInvoices. */
  onOpenCritical?: (items: WorklistItem[]) => void;
  /** "Show chase-today list": the host turns this into ShowWorklist. */
  onShowWorklist?: (items: WorklistItem[]) => void;
  onOpenInvoice?: (item: WorklistItem) => void;
  maxRows?: number;
}

const actionColor = { "Call today": "danger", "Send reminder": "warning", Monitor: "informative" } as const;

/** Prioritised "chase today" list: critical invoices as cards, the rest as a ranked table. */
export function PriorityList({ items, title = "Chase today", subtitle, onOpenCritical, onShowWorklist, onOpenInvoice, maxRows = 15 }: PriorityListProps) {
  const styles = useStyles();
  const critical = items.filter((i) => i.critical);
  const total = items.reduce((s, i) => s + i.remainingAmount, 0);
  const currency = items[0]?.currency ?? "EUR";

  return (
    <section className={styles.root} aria-label={title}>
      <div className={styles.header}>
        <div>
          <Subtitle2>{title}</Subtitle2>
          <div>
            <Caption1 className={styles.muted}>
              {subtitle ?? `${items.length} overdue invoice(s) · ${formatMoney(total, currency)}`}
            </Caption1>
          </div>
        </div>
        <div className={styles.actions}>
          {onOpenCritical && critical.length > 0 && (
            <Button appearance="primary" onClick={() => onOpenCritical(critical)}>
              Open {critical.length} critical invoice{critical.length > 1 ? "s" : ""}
            </Button>
          )}
          {onShowWorklist && items.length > 0 && <Button onClick={() => onShowWorklist(items)}>Show chase-today list</Button>}
        </div>
      </div>

      {critical.length > 0 && (
        <div className={styles.cards}>
          {critical.map((i) => (
            <InvoiceCard key={i.invoiceId} invoice={i} onOpen={onOpenInvoice ? () => onOpenInvoice(i) : undefined} />
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <Caption1 className={styles.muted}>Nothing overdue. Nice.</Caption1>
      ) : (
        <div className={styles.tableWrap}>
          <Table size="small" aria-label={`${title} (table)`}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>#</TableHeaderCell>
                <TableHeaderCell>Invoice</TableHeaderCell>
                <TableHeaderCell>Customer</TableHeaderCell>
                <TableHeaderCell className={styles.num}>Overdue</TableHeaderCell>
                <TableHeaderCell className={styles.num}>Amount</TableHeaderCell>
                <TableHeaderCell>Next step</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.slice(0, maxRows).map((i) => (
                <TableRow key={i.invoiceId} onClick={onOpenInvoice ? () => onOpenInvoice(i) : undefined}>
                  <TableCell>{i.rank}</TableCell>
                  <TableCell>{i.invoiceNo}</TableCell>
                  <TableCell>{i.customerName}</TableCell>
                  <TableCell className={styles.num}>
                    <Badge className={styles.nowrap} appearance="tint" color={overdueBadgeColor(i.daysOverdue)}>
                      {i.daysOverdue} d
                    </Badge>
                  </TableCell>
                  <TableCell className={styles.num}>{formatMoney(i.remainingAmount, i.currency)}</TableCell>
                  <TableCell>
                    <Badge className={styles.nowrap} appearance="outline" color={actionColor[i.suggestedAction]} title={i.reasons.join(" · ")}>
                      {i.suggestedAction}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
