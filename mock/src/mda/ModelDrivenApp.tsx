import * as React from "react";
import {
  Badge,
  Button,
  Caption1,
  Dropdown,
  Option,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { ageInvoices, type Customer, type Invoice } from "@collections/domain";
import { FIXTURE_AS_OF } from "@collections/domain/fixtures";
import { CollectionsBridgeApp } from "@collections/pcf-bridge/app";
import type { CollectionsBridge } from "@collections/pcf-bridge/bridge";
import type { FixtureDataService } from "@collections/pcf-bridge/testing";
import { formatDate, formatMoney, overdueBadgeColor } from "@collections/ui";
import type { FakeCopilot } from "../fake/copilot";
import { mda } from "../fake/mda-store";
import { ConfirmDialog } from "./ConfirmDialog";
import { EventLog } from "./EventLog";
import { SidePaneStrip } from "./SidePaneStrip";
import { useStore } from "./useStore";

const useStyles = makeStyles({
  shell: { display: "flex", flexDirection: "column", height: "100%", minWidth: 0 },
  topbar: { height: "48px", display: "flex", alignItems: "center", gap: "16px", padding: "0 16px", background: "#0b2e5c", color: "white", flexShrink: 0 },
  body: { display: "flex", flexGrow: 1, minHeight: 0 },
  nav: { width: "180px", flexShrink: 0, background: tokens.colorNeutralBackground3, padding: "12px 0", display: "flex", flexDirection: "column" },
  navItem: { padding: "8px 16px", fontSize: tokens.fontSizeBase300 },
  navActive: { background: tokens.colorNeutralBackground1, borderLeft: `3px solid ${tokens.colorBrandBackground}`, fontWeight: tokens.fontWeightSemibold },
  main: { flexGrow: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px", minWidth: 0 },
  card: { background: tokens.colorNeutralBackground1, borderRadius: tokens.borderRadiusLarge, padding: "14px 16px", boxShadow: tokens.shadow2 },
  fields: { display: "grid", gridTemplateColumns: "repeat(4, minmax(120px, 1fr))", gap: "10px 20px", marginTop: "10px" },
  num: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
});

const NAV = ["Customers", "Overdue invoices", "Dashboards", "Follow-ups"];

export interface ModelDrivenAppProps {
  bridge: CollectionsBridge;
  copilot: FakeCopilot;
  data: FixtureDataService;
  customers: readonly Customer[];
  invoices: readonly Invoice[];
  customerNo: string;
  onCustomerChange: (customerNo: string) => void;
}

/** A stand-in for the Collections Workspace model-driven app: customer form + the real PCF UI. */
export function ModelDrivenApp({ bridge, copilot, customers, invoices, customerNo, onCustomerChange }: ModelDrivenAppProps) {
  const styles = useStyles();
  const { grid } = useStore(mda);
  const bridgeState = useStore(bridge.store);
  const [copilotOn, setCopilotOn] = React.useState(copilot.isEnabled());
  const customer = customers.find((c) => c.number === customerNo)!;
  const open = ageInvoices(invoices.filter((i) => i.customerNumber === customerNo), FIXTURE_AS_OF);
  const overdue = open.filter((i) => i.daysOverdue > 0).sort((a, b) => b.daysOverdue - a.daysOverdue);

  const rows =
    grid.kind === "worklist" && bridgeState.worklist
      ? bridgeState.worklist.items.map((w) => ({ id: w.invoiceId, number: w.invoiceNo, customer: w.customerName, due: w.dueDate, days: w.daysOverdue, amount: w.remainingAmount, rank: w.rank as number | undefined, next: w.suggestedAction as string | undefined }))
      : overdue.map((i) => ({ id: i.id, number: i.number, customer: i.customerName, due: i.dueDate, days: i.daysOverdue, amount: i.remainingAmount, rank: undefined, next: undefined }));
  const gridTitle = grid.kind === "worklist" ? `${bridgeState.worklist?.title ?? "Chase today"} (prioritized by Copilot)` : grid.kind === "fetch" ? grid.title : "Overdue invoices";

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Text weight="semibold" style={{ color: "white" }}>Power Apps</Text>
        <Text style={{ color: "white", opacity: 0.85 }}>|</Text>
        <Text style={{ color: "white" }}>Collections Workspace</Text>
        <Badge appearance="outline" style={{ color: "white", borderColor: "white" }}>mock host</Badge>
        <span style={{ flexGrow: 1 }} />
        <Switch
          checked={copilotOn}
          label={<span style={{ color: "white" }}>M365 Copilot enabled</span>}
          onChange={(_, d) => {
            copilot.setEnabled(d.checked);
            setCopilotOn(d.checked);
          }}
        />
      </header>
      <div className={styles.body}>
        <nav className={styles.nav} aria-label="Sitemap">
          {NAV.map((n) => (
            <div key={n} className={mergeClasses(styles.navItem, n === "Customers" && styles.navActive)}>{n}</div>
          ))}
        </nav>

        <main className={styles.main}>
          <section className={styles.card} aria-label="Customer form">
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Text size={600} weight="semibold">{customer.name}</Text>
              <Caption1>Customer (Business Central) · {customer.number}</Caption1>
              <span style={{ flexGrow: 1 }} />
              <Dropdown
                aria-label="Switch customer"
                value={customer.name}
                selectedOptions={[customerNo]}
                onOptionSelect={(_, d) => d.optionValue && onCustomerChange(d.optionValue)}
              >
                {customers.slice(0, 8).map((c) => (
                  <Option key={c.number} value={c.number}>{c.name}</Option>
                ))}
              </Dropdown>
            </div>
            <div className={styles.fields}>
              {[
                ["City", customer.city ?? ""],
                ["Credit limit", formatMoney(customer.creditLimit, customer.currency)],
                ["Open balance", formatMoney(open.reduce((s, i) => s + i.remainingAmount, 0), customer.currency)],
                ["Salesperson", customer.salesperson],
              ].map(([k, v]) => (
                <div key={k}><Caption1 block>{k}</Caption1><Text>{v}</Text></div>
              ))}
            </div>
          </section>

          <section className={styles.card} aria-label="CollectionsBridge control">
            <Caption1 block style={{ marginBottom: 8, color: tokens.colorNeutralForeground3 }}>CollectionsBridge (PCF control, same code as the real control)</Caption1>
            <CollectionsBridgeApp bridge={bridge} />
          </section>

          <section className={styles.card} aria-label={gridTitle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Text weight="semibold">{gridTitle}</Text>
              <span style={{ flexGrow: 1 }} />
              {grid.kind !== "overdue" && <Button size="small" appearance="subtle" onClick={() => mda.set({ grid: { kind: "overdue" } })}>Back to Overdue invoices</Button>}
            </div>
            <Table size="small">
              <TableHeader>
                <TableRow>
                  {grid.kind === "worklist" && <TableHeaderCell>#</TableHeaderCell>}
                  <TableHeaderCell>Invoice</TableHeaderCell>
                  <TableHeaderCell>Customer</TableHeaderCell>
                  <TableHeaderCell>Due date</TableHeaderCell>
                  <TableHeaderCell className={styles.num}>Days overdue</TableHeaderCell>
                  <TableHeaderCell className={styles.num}>Remaining</TableHeaderCell>
                  {grid.kind === "worklist" && <TableHeaderCell>Next step</TableHeaderCell>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} onClick={() => void bridge.openInvoice(r.id, r.number)} style={{ cursor: "pointer" }}>
                    {grid.kind === "worklist" && <TableCell>{r.rank}</TableCell>}
                    <TableCell>{r.number}</TableCell>
                    <TableCell>{r.customer}</TableCell>
                    <TableCell>{formatDate(r.due)}</TableCell>
                    <TableCell className={styles.num}><Badge appearance="tint" color={overdueBadgeColor(r.days)}>{r.days}</Badge></TableCell>
                    <TableCell className={styles.num}>{formatMoney(r.amount)}</TableCell>
                    {grid.kind === "worklist" && <TableCell>{r.next}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </main>

        <SidePaneStrip invoices={invoices} />
      </div>
      <EventLog />
      <ConfirmDialog />
    </div>
  );
}
