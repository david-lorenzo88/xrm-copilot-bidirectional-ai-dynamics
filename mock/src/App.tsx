import * as React from "react";
import { makeStyles } from "@fluentui/react-components";
import type { DashboardSpec } from "@collections/contract";
import { DEFAULT_SETTINGS, createCollectionsBridge, getCopilot, getXrm } from "@collections/pcf-bridge/bridge";
import { FixtureDataService } from "@collections/pcf-bridge/testing";
import { FIXTURE_AS_OF, HERO_CUSTOMER_NO, fixtures } from "@collections/domain/fixtures";
import { CopilotPane } from "./copilot/CopilotPane";
import type { McpMode } from "./copilot/mcp";
import { FakeCopilot } from "./fake/copilot";
import { logEvent } from "./fake/mda-store";
import { installWidgetRelay } from "./fake/relay";
import { MOCK_WORKLIST_VIEW_ID, builtInHandlers, createFakeXrm } from "./fake/xrm";
import { ModelDrivenApp } from "./mda/ModelDrivenApp";

const useStyles = makeStyles({
  root: { display: "flex", height: "100%" },
  app: { flexGrow: 1, minWidth: 0 },
  pane: { width: "420px", flexShrink: 0 },
});

// ── Wiring: exactly what the platform + PCF do, with fakes where the platform would be ──
const copilot = new FakeCopilot(builtInHandlers);
copilot.addDefaultActionHandlers();
(window as unknown as { Xrm: unknown }).Xrm = createFakeXrm(copilot); // like window.Xrm in a model-driven app
installWidgetRelay(copilot);

// One map = one contoso_collectiondashboard table, written by both the MCP server and the app.
const dashboards = new Map<string, DashboardSpec>();
const data = new FixtureDataService(undefined, dashboards);
const xrm = getXrm(); // the same adapter the PCF uses
const bridge = createCollectionsBridge({
  copilot: getCopilot(xrm),
  sidePanes: xrm?.App?.sidePanes,
  navigation: xrm?.Navigation,
  data,
  settings: { ...DEFAULT_SETTINGS, gptId: "T_contoso.collections.agent", worklistViewId: MOCK_WORKLIST_VIEW_ID },
  today: () => FIXTURE_AS_OF,
});
const originalAudit = data.audit.bind(data);
data.audit = async (entry) => {
  logEvent("audit", `contoso_collectionaction: ${entry.actionId} ${entry.outcome}`, entry);
  return originalAudit(entry);
};
const originalFollowUp = data.createFollowUp.bind(data);
data.createFollowUp = async (p) => {
  logEvent("write", `contoso_collectionaction: follow-up for ${p.customerNo} (confirmed by user)`, p);
  return originalFollowUp(p);
};

const mode: McpMode = new URLSearchParams(window.location.search).get("mcp") === "http" ? "http" : "in-memory";

export function App() {
  const styles = useStyles();
  const [customerNo, setCustomerNo] = React.useState(HERO_CUSTOMER_NO);
  const customer = fixtures.customers.find((c) => c.number === customerNo)!;

  // PCF updateView equivalent: the bound customer changed → publish context.
  React.useEffect(() => {
    void bridge.setRecord({ customerNo, recordId: customer.id });
  }, [customerNo, customer.id]);

  return (
    <div className={styles.root}>
      <div className={styles.app}>
        <ModelDrivenApp
          bridge={bridge}
          copilot={copilot}
          data={data}
          customers={fixtures.customers}
          invoices={fixtures.invoices}
          customerNo={customerNo}
          onCustomerChange={setCustomerNo}
        />
      </div>
      <div className={styles.pane}>
        <CopilotPane copilot={copilot} mode={mode} dashboards={dashboards} />
      </div>
    </div>
  );
}
