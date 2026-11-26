import * as React from "react";
import { Button, Caption1, Card, Text } from "@fluentui/react-components";
import { ActionIds } from "@collections/contract";
import { PriorityList } from "@collections/ui";
import type { FollowUpProposal, PrioritizeResult } from "../../src/tools/handlers";
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

function PriorityListWidget() {
  const [result, setResult, error] = useToolResult<PrioritizeResult | FollowUpProposal>();
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
  if ("kind" in result) return <FollowUpCard proposal={result} />;

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
