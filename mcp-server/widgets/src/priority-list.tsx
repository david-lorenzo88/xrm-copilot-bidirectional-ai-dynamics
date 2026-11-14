import * as React from "react";
import { Button } from "@fluentui/react-components";
import { ActionIds } from "@collections/contract";
import { PriorityList } from "@collections/ui";
import type { PrioritizeResult } from "../../src/tools/handlers";
import { callTool, postAppAction, useToolResult } from "./host";
import { ToolError, Waiting, mount } from "./WidgetShell";

/** Sends the ready-made app actions from the tool result (navigation only; nothing is written). */
function applyInApp({ actions }: PrioritizeResult): void {
  if (actions.openInvoices) postAppAction(ActionIds.OpenInvoices, actions.openInvoices);
  if (actions.showWorklist) postAppAction(ActionIds.ShowWorklist, actions.showWorklist);
}

function PriorityListWidget() {
  const [result, setResult, error] = useToolResult<PrioritizeResult>();
  const applied = React.useRef<string | undefined>(undefined);

  React.useEffect(() => {
    const key = result?.actions.showWorklist?.fetchXml;
    if (result?.autoApply && key && applied.current !== key) {
      applied.current = key;
      applyInApp(result);
    }
  }, [result]);

  if (error) return <ToolError message={error} />;
  if (!result) return <Waiting label="Prioritizing overdue invoices…" />;

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
