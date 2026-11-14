import * as React from "react";
import { Button } from "@fluentui/react-components";
import { ActionIds, type DashboardFilters } from "@collections/contract";
import { AgingDashboard } from "@collections/ui";
import type { DashboardResult } from "../../src/tools/handlers";
import { app, callTool, postAppAction, useToolResult } from "./host";
import { ToolError, Waiting, mount } from "./WidgetShell";

/** Mirror the spec into the app: the PCF persists it and renders the same <AgingDashboard>. */
function showInApp({ spec }: DashboardResult): void {
  postAppAction(ActionIds.RenderDashboard, { dashboardId: spec.id, spec });
}

function AgingDashboardWidget({ dark }: { dark: boolean }) {
  const [result, setResult, error] = useToolResult<DashboardResult>();
  const [busy, setBusy] = React.useState(false);
  const mirrored = React.useRef<string | undefined>(undefined);

  React.useEffect(() => {
    const key = result && `${result.spec.id}@${result.spec.version}`;
    if (result && key !== mirrored.current) {
      mirrored.current = key;
      showInApp(result);
    }
  }, [result]);

  if (error) return <ToolError message={error} />;
  if (!result) return <Waiting label="Building dashboard…" />;
  const { spec, data } = result;

  // In-widget change: write through the server (last write wins), then mirror and tell the model.
  const onFiltersChange = async (filters: DashboardFilters) => {
    setBusy(true);
    try {
      const { result: r, data: next } = await callTool<DashboardResult>("update_dashboard", { dashboardId: spec.id, expectedVersion: spec.version, patch: { filters } });
      setResult(r);
      if (next && app.getHostCapabilities()?.updateModelContext) {
        await app.updateModelContext({
          content: [{ type: "text", text: `User changed dashboard ${spec.id} filters in the widget: ${JSON.stringify(next.spec.filters)} (now v${next.spec.version}).` }],
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const ask = () =>
    app.sendMessage({ role: "user", content: [{ type: "text", text: "Which customers drive the 90+ bucket, and what should I do about them today?" }] });

  return (
    <AgingDashboard
      spec={spec}
      data={data}
      dark={dark}
      onFiltersChange={busy ? undefined : onFiltersChange}
      actions={
        <>
          <Button size="small" appearance="primary" onClick={() => showInApp(result)}>
            Show in app
          </Button>
          <Button size="small" appearance="subtle" onClick={ask}>
            Ask about 90+
          </Button>
        </>
      }
    />
  );
}

mount(AgingDashboardWidget);
