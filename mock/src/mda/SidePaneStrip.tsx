import * as React from "react";
import { Badge, Button, Caption1, Tab, TabList, Text, makeStyles, tokens } from "@fluentui/react-components";
import { daysOverdue, type Invoice } from "@collections/domain";
import { FIXTURE_AS_OF } from "@collections/domain/fixtures";
import { formatDate, formatMoney, overdueBadgeColor } from "@collections/ui";
import { mda } from "../fake/mda-store";
import { useStore } from "./useStore";

const useStyles = makeStyles({
  root: { width: "320px", flexShrink: 0, display: "flex", flexDirection: "column", borderLeft: `1px solid ${tokens.colorNeutralStroke2}`, background: tokens.colorNeutralBackground1 },
  body: { padding: "12px 16px", display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto" },
  field: { display: "flex", justifyContent: "space-between", borderBottom: `1px solid ${tokens.colorNeutralStroke3}`, padding: "4px 0" },
});

/** Xrm.App.sidePanes, rendered: one tab per pane, each showing the invoice "form". */
export function SidePaneStrip({ invoices }: { invoices: readonly Invoice[] }) {
  const styles = useStyles();
  const { panes, selectedPane } = useStore(mda);
  if (panes.length === 0) return null;
  const pane = panes.find((p) => p.paneId === selectedPane) ?? panes[0]!;
  const inv = invoices.find((i) => i.id === pane.record?.entityId);
  const days = inv ? daysOverdue(inv.dueDate, FIXTURE_AS_OF) : 0;
  const close = () => mda.set((s) => ({ panes: s.panes.filter((p) => p.paneId !== pane.paneId), selectedPane: undefined }));

  return (
    <aside className={styles.root} aria-label="Side panes">
      <TabList size="small" selectedValue={pane.paneId} onTabSelect={(_, d) => mda.set({ selectedPane: String(d.value) })}>
        {panes.map((p) => (
          <Tab key={p.paneId} value={p.paneId}>{p.title}</Tab>
        ))}
      </TabList>
      <div className={styles.body}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Text weight="semibold" size={400}>Sales invoice {inv?.number ?? pane.title}</Text>
          <Button size="small" appearance="subtle" onClick={close}>Close</Button>
        </div>
        <Caption1>{pane.record?.entityName}</Caption1>
        {inv ? (
          <>
            <Badge appearance="filled" color={overdueBadgeColor(days)}>{days > 0 ? `${days} days overdue` : "Not yet due"}</Badge>
            {[
              ["Customer", `${inv.customerName} (${inv.customerNumber})`],
              ["Invoice date", formatDate(inv.invoiceDate)],
              ["Due date", formatDate(inv.dueDate)],
              ["Total", formatMoney(inv.totalAmount, inv.currency)],
              ["Remaining", formatMoney(inv.remainingAmount, inv.currency)],
              ["Status", inv.status],
            ].map(([k, v]) => (
              <div key={k} className={styles.field}><Caption1>{k}</Caption1><Text size={200}>{v}</Text></div>
            ))}
          </>
        ) : (
          <Caption1>Loading record…</Caption1>
        )}
      </div>
    </aside>
  );
}
