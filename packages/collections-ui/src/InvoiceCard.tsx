import * as React from "react";
import { Badge, Button, Caption1, Card, CardHeader, Text, makeStyles, tokens } from "@fluentui/react-components";
import { formatDate, formatMoney } from "./format";

export interface InvoiceCardData {
  invoiceId: string;
  invoiceNo: string;
  customerName: string;
  dueDate: string;
  daysOverdue: number;
  remainingAmount: number;
  currency: string;
  reasons?: string[];
  critical?: boolean;
}

const useStyles = makeStyles({
  card: { minWidth: "200px", maxWidth: "320px" },
  amount: { fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold, fontVariantNumeric: "tabular-nums" },
  reasons: { color: tokens.colorNeutralForeground3 },
});

export function overdueBadgeColor(days: number): "success" | "warning" | "severe" | "danger" {
  if (days <= 0) return "success";
  if (days <= 30) return "warning";
  if (days <= 60) return "severe";
  return "danger";
}

export interface InvoiceCardProps {
  invoice: InvoiceCardData;
  onOpen?: (invoice: InvoiceCardData) => void;
}

export function InvoiceCard({ invoice, onOpen }: InvoiceCardProps) {
  const styles = useStyles();
  const overdue = invoice.daysOverdue > 0 ? `${invoice.daysOverdue} days overdue` : "Not yet due";
  return (
    <Card className={styles.card} size="small" aria-label={`Invoice ${invoice.invoiceNo}`}>
      <CardHeader
        header={<Text weight="semibold">{invoice.invoiceNo}</Text>}
        description={<Caption1>{invoice.customerName}</Caption1>}
        action={
          <Badge appearance="filled" color={overdueBadgeColor(invoice.daysOverdue)}>
            {overdue}
          </Badge>
        }
      />
      <div className={styles.amount}>{formatMoney(invoice.remainingAmount, invoice.currency)}</div>
      <Caption1>Due {formatDate(invoice.dueDate)}</Caption1>
      {invoice.reasons?.length ? <Caption1 className={styles.reasons}>{invoice.reasons.join(" · ")}</Caption1> : null}
      {onOpen && (
        <Button size="small" appearance={invoice.critical ? "primary" : "secondary"} onClick={() => onOpen(invoice)}>
          Open invoice
        </Button>
      )}
    </Card>
  );
}
