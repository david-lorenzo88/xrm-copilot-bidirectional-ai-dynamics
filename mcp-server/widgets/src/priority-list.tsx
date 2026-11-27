import * as React from "react";
import { Button, Caption1, Card, Text } from "@fluentui/react-components";
import { ActionIds } from "@collections/contract";
import { PriorityList } from "@collections/ui";
import type { CustomerUpdateProposal, FollowUpProposal, NewCustomerProposal, PrioritizeResult } from "../../src/tools/handlers";
import { callTool, postAppAction, useToolResult } from "./host";
import { ToolError, Waiting, mount } from "./WidgetShell";

/**
 * On render, only the chase-today list goes to the app (it sits inside the control). Side panes
 * cover the page, so they open when the user clicks "Open N critical invoices" (feedback from the
 * live run: auto-opened panes before the answer was read felt intrusive). Navigation only.
 */
function applyInApp({ actions }: PrioritizeResult): void {
  if (actions.showWorklist) postAppAction(ActionIds.ShowWorklist, actions.showWorklist);
}

/** A write is never automatic: the user sends it, and the app asks once more before storing it. */
function FollowUpCard({ proposal }: { proposal: FollowUpProposal }) {
  const [sent, setSent] = React.useState(false);
  const { payload, customer } = proposal;
  const research = payload.kind === "research";
  return (
    <Card style={{ margin: 12 }}>
      <Text weight="semibold">{research ? "Insert this research into the record?" : "Log this follow-up?"}</Text>
      <Caption1>
        {customer.name} ({customer.number})
      </Caption1>
      <Text style={{ whiteSpace: "pre-wrap" }}>{payload.note}</Text>
      {payload.sources?.length ? (
        <Caption1>
          Sources:{" "}
          {payload.sources.map((s, i) => (
            <React.Fragment key={s.url}>
              {i > 0 && " · "}
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.title}
              </a>
            </React.Fragment>
          ))}
        </Caption1>
      ) : null}
      {payload.promiseDate && <Caption1>Promise to pay by {payload.promiseDate}</Caption1>}
      <div>
        <Button
          appearance="primary"
          disabled={sent}
          onClick={() => {
            postAppAction(ActionIds.LogFollowUp, payload);
            setSent(true);
          }}
        >
          {sent ? "Sent to the app: confirm there" : research ? "Insert into record" : "Log in app"}
        </Button>
      </div>
    </Card>
  );
}

/** Not a write either: the app fills the open form, and the user saves it. */
function CustomerUpdateCard({ proposal }: { proposal: CustomerUpdateProposal }) {
  const [sent, setSent] = React.useState(false);
  const { payload, customer } = proposal;
  const fmt = (v: number) => v.toLocaleString(undefined, { style: "currency", currency: customer.currency || "EUR", maximumFractionDigits: 0 });
  return (
    <Card style={{ margin: 12 }}>
      <Text weight="semibold">Change {customer.name} in Business Central?</Text>
      <Caption1>{customer.number}</Caption1>
      {payload.changes.creditLimit !== undefined && (
        <Text>
          Credit limit: {fmt(customer.creditLimit)} → <b>{fmt(payload.changes.creditLimit)}</b>
        </Text>
      )}
      {payload.changes.blocked !== undefined && (
        <Text>
          Blocked: → <b>{payload.changes.blocked || "not blocked"}</b>
        </Text>
      )}
      <Caption1>{payload.reason}</Caption1>
      <div>
        <Button
          appearance="primary"
          disabled={sent}
          onClick={() => {
            postAppAction(ActionIds.ApplyCustomerChanges, payload);
            setSent(true);
          }}
        >
          {sent ? "Filled in the form: review and Save there" : "Apply to the form"}
        </Button>
      </div>
    </Card>
  );
}

const NEW_CUSTOMER_LABELS: [keyof NewCustomerProposal["payload"]["customer"], string][] = [
  ["number", "No."], ["addressLine1", "Address"], ["postalCode", "Post code"], ["city", "City"], ["country", "Country"],
  ["phoneNumber", "Phone"], ["email", "Email"], ["website", "Website"], ["taxRegistrationNumber", "VAT reg. no."],
  ["currencyCode", "Currency"], ["creditLimit", "Credit limit"],
];

/** Not a write either: the app opens a pre-filled new customer form, and the user saves it. */
function NewCustomerCard({ proposal }: { proposal: NewCustomerProposal }) {
  const [sent, setSent] = React.useState(false);
  const { payload } = proposal;
  return (
    <Card style={{ margin: 12 }}>
      <Text weight="semibold">Create {payload.customer.name} in Business Central?</Text>
      <Caption1>From: {payload.source}</Caption1>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 12, rowGap: 2 }}>
        {NEW_CUSTOMER_LABELS.filter(([k]) => payload.customer[k] !== undefined && payload.customer[k] !== "").map(([k, label]) => (
          <React.Fragment key={k}>
            <Caption1>{label}</Caption1>
            <Text>{String(payload.customer[k])}</Text>
          </React.Fragment>
        ))}
      </div>
      <div>
        <Button
          appearance="primary"
          disabled={sent}
          onClick={() => {
            postAppAction(ActionIds.CreateCustomer, payload);
            setSent(true);
          }}
        >
          {sent ? "Opened in the app: review and Save there" : "Create on the form"}
        </Button>
      </div>
    </Card>
  );
}

function PriorityListWidget() {
  const [result, setResult, error] = useToolResult<PrioritizeResult | FollowUpProposal | CustomerUpdateProposal | NewCustomerProposal>();
  const applied = React.useRef<string | undefined>(undefined);
  const worklist = result && !("kind" in result) ? result : undefined;

  React.useEffect(() => {
    const key = worklist?.actions.showWorklist?.fetchXml;
    if (worklist?.autoApply && key && applied.current !== key) {
      applied.current = key;
      applyInApp(worklist);
    }
  }, [worklist]);

  if (error) return <ToolError message={error} />;
  if (!result) return <Waiting label="Prioritizing overdue invoices…" />;
  if ("kind" in result) {
    if (result.kind === "newCustomerProposal") return <NewCustomerCard proposal={result} />;
    return result.kind === "customerUpdateProposal" ? <CustomerUpdateCard proposal={result} /> : <FollowUpCard proposal={result} />;
  }

  const refresh = async () => {
    const { result: r } = await callTool<PrioritizeResult>("prioritize_collections", { customerNo: result.scope.customerNo, applyInApp: false });
    setResult(r);
  };

  return (
    <>
      <PriorityList
        items={result.items}
        title={result.actions.showWorklist?.title ?? "Chase today"}
        onOpenCritical={() => result.actions.openInvoices && postAppAction(ActionIds.OpenInvoices, result.actions.openInvoices)}
        onShowWorklist={() => result.actions.showWorklist && postAppAction(ActionIds.ShowWorklist, result.actions.showWorklist)}
        onOpenInvoice={(i) => postAppAction(ActionIds.OpenInvoices, { invoiceIds: [i.invoiceId], invoiceNumbers: [i.invoiceNo] })}
      />
      <div style={{ padding: "0 12px 12px" }}>
        <Button size="small" appearance="subtle" onClick={refresh}>
          Refresh
        </Button>
      </div>
    </>
  );
}

mount(PriorityListWidget);
