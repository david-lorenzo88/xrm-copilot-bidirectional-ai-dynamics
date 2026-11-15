import { describe, expect, it, vi } from "vitest";
import { ActionIds, createDashboardSpec, type PowerAppsContent } from "@collections/contract";
import { buildPrioritizedWorklistFetchXml, prioritizeWorklist } from "@collections/domain";
import { FIXTURE_AS_OF, fixtures } from "@collections/domain/fixtures";
import { DEFAULT_SETTINGS, createCollectionsBridge, getCopilot, type ActionHandler, type CopilotApi, type SidePane } from "../CollectionsBridge/bridge";
import { FixtureDataService } from "../CollectionsBridge/testing/fixture-data";

function fakeCopilot(enabled = true) {
  const handlers = new Map<string, ActionHandler[]>();
  const contexts: PowerAppsContent[] = [];
  const copilot: CopilotApi & { dispatch(id: string, data: unknown): Promise<void> } = {
    isM365CopilotEnabled: vi.fn(async () => enabled),
    openM365CopilotPanel: vi.fn(async () => {}),
    sendPromptToM365Copilot: vi.fn(async () => {}),
    updateContext: vi.fn(async (c: PowerAppsContent) => void contexts.push(c)),
    addActionHandler: (id, h) => handlers.set(id, [...(handlers.get(id) ?? []), h]),
    removeActionHandler: (id, h) => handlers.set(id, (handlers.get(id) ?? []).filter((x) => x !== h)),
    async dispatch(id, data) {
      for (const h of handlers.get(id) ?? []) await h(data);
    },
  };
  return { copilot, handlers, contexts };
}

function setup(enabled = true) {
  const fake = fakeCopilot(enabled);
  const panes: { options: unknown; navigated: unknown[] }[] = [];
  const sidePanes = {
    createPane: vi.fn(async (options: unknown): Promise<SidePane> => {
      const entry = { options, navigated: [] as unknown[] };
      panes.push(entry);
      return { navigate: async (input) => void entry.navigated.push(input) };
    }),
    getPane: vi.fn(() => undefined),
  };
  const navigation = { navigateTo: vi.fn(async () => {}), openConfirmDialog: vi.fn(async () => ({ confirmed: true })) };
  const data = new FixtureDataService();
  const bridge = createCollectionsBridge({ copilot: fake.copilot, sidePanes, navigation, data, settings: { ...DEFAULT_SETTINGS, gptId: "T_collections.agent" }, today: () => FIXTURE_AS_OF });
  return { ...fake, panes, sidePanes, navigation, data, bridge };
}

const fabrikamItems = prioritizeWorklist(fixtures.customers, fixtures.invoices, FIXTURE_AS_OF, { customerNo: "C-1001" });

describe("beat 1: context publishing", () => {
  it("checks availability, publishes context and opens the panel once", async () => {
    const { bridge, copilot, contexts } = setup();
    await bridge.setRecord({ customerNo: "C-1001", recordId: fixtures.customers[0]!.id });
    expect(copilot.isM365CopilotEnabled).toHaveBeenCalled();
    expect(contexts[0]).toMatchObject({ entity: "dyn365bc_customer_v2_0", customerNo: "C-1001", customerName: "Fabrikam, Inc.", view: "Overdue invoices" });
    expect(String(contexts[0]!.filterXML)).toContain("C-1001");
    expect(copilot.openM365CopilotPanel).toHaveBeenCalledTimes(1);
    expect(bridge.store.get().copilot).toBe("enabled");
    await bridge.setRecord({ customerNo: "C-1001", recordId: fixtures.customers[0]!.id });
    expect(contexts).toHaveLength(1); // unchanged record → no republish
  });

  it("degrades when Copilot is disabled or missing", async () => {
    const off = setup(false);
    await off.bridge.setRecord({ customerNo: "C-1001" });
    expect(off.copilot.updateContext).not.toHaveBeenCalled();
    expect(off.bridge.store.get().copilot).toBe("disabled");
    await off.bridge.analyze();
    expect(off.bridge.store.get().notice?.intent).toBe("warning");

    const none = createCollectionsBridge({ data: new FixtureDataService(), settings: DEFAULT_SETTINGS, today: () => FIXTURE_AS_OF });
    await none.setRecord({ customerNo: "C-1001" });
    expect(none.store.get()).toMatchObject({ copilot: "unavailable", customerName: "Fabrikam, Inc." });
    await none.analyze();
    expect(none.store.get().notice?.text).toMatch(/not available/);
    expect(getCopilot(undefined)).toBeUndefined();
    expect(getCopilot({ Copilot: { updateContext() {} } as unknown as CopilotApi })).toBeUndefined();
  });
});

describe("beat 2: the agent operates the app", () => {
  it("sends the analyze prompt to our agent, naming the customer", async () => {
    const { bridge, copilot } = setup();
    await bridge.setRecord({ customerNo: "C-1001" });
    await bridge.analyze();
    const [prompt, options] = vi.mocked(copilot.sendPromptToM365Copilot).mock.calls[0]!;
    expect(prompt).toBe("Use the Collections tools to analyze the payment behavior of Fabrikam, Inc. (C-1001) and prioritize what to chase today.");
    expect(options).toEqual({ gptId: "T_collections.agent" });
  });

  it("Build aging dashboard sends the beat-3 prompt to our agent", async () => {
    const { bridge, copilot } = setup();
    await bridge.setRecord({ customerNo: "C-1001" });
    await bridge.buildDashboard();
    expect(vi.mocked(copilot.sendPromptToM365Copilot).mock.calls.at(-1)).toEqual([
      "Use the Collections tools to build me a dashboard of overdue by customer and aging bucket.",
      { gptId: "T_collections.agent" },
    ]);
  });

  it("OpenInvoices opens one side pane per invoice", async () => {
    const { copilot, panes, data } = setup();
    const critical = fabrikamItems.filter((i) => i.critical);
    await copilot.dispatch(ActionIds.OpenInvoices, { invoiceIds: critical.map((i) => i.invoiceId), invoiceNumbers: critical.map((i) => i.invoiceNo) });
    expect(panes).toHaveLength(critical.length);
    expect(panes[0]!.options).toMatchObject({ title: critical[0]!.invoiceNo, canClose: true });
    expect(panes[0]!.navigated[0]).toEqual({ pageType: "entityrecord", entityName: "dyn365bc_salesinvoice_v2_0", entityId: critical[0]!.invoiceId });
    expect(data.actionLog.at(-1)).toMatchObject({ actionId: ActionIds.OpenInvoices, outcome: "handled" });
  });

  it("ShowWorklist renders the ranked list in-app and can switch the grid view", async () => {
    const { copilot, bridge } = setup();
    const ids = fabrikamItems.map((i) => i.invoiceId);
    await copilot.dispatch(ActionIds.ShowWorklist, { title: "Chase today", fetchXml: buildPrioritizedWorklistFetchXml(ids), invoiceIds: ids });
    expect(bridge.store.get().worklist?.items.map((i) => i.invoiceId)).toEqual(ids);
    bridge.closeWorklist();
    expect(bridge.store.get().worklist).toBeUndefined();
  });

  it("rejects payloads that fail the allow-list and audits them", async () => {
    const { copilot, bridge, panes, data } = setup();
    await copilot.dispatch(ActionIds.OpenInvoices, { invoiceIds: ["'; DROP TABLE"] });
    await copilot.dispatch(ActionIds.ShowWorklist, { title: "x", fetchXml: '<fetch><entity name="systemuser"/></fetch>' });
    expect(panes).toHaveLength(0);
    expect(bridge.store.get().notice?.text).toMatch(/entity not allowed: systemuser/);
    expect(data.actionLog.filter((e) => e.outcome === "rejected")).toHaveLength(2);
  });

  it("unwraps an { action, actionData } envelope if the platform sends one", async () => {
    const { copilot, panes } = setup();
    await copilot.dispatch(ActionIds.OpenInvoices, { action: ActionIds.OpenInvoices, actionData: { invoiceIds: [fabrikamItems[0]!.invoiceId] } });
    expect(panes).toHaveLength(1);
  });
});

describe("beat 3: shared dashboard state", () => {
  it("RenderDashboard persists the spec, renders it and republishes context; in-app filter changes bump the version", async () => {
    const { copilot, bridge, data, contexts } = setup();
    await bridge.setRecord({ customerNo: "C-1001" });
    const spec = createDashboardSpec({ id: "0f8fad5b-d9cb-469f-a165-70867728950e", now: new Date("2026-11-27T09:00:00Z") });
    await copilot.dispatch(ActionIds.RenderDashboard, { dashboardId: spec.id, spec });
    expect(data.dashboards.get(spec.id)).toEqual(spec);
    expect(bridge.store.get().dashboard?.data.rows[0]!.label).toBe("Fabrikam, Inc.");
    expect(contexts.at(-1)).toMatchObject({ dashboardId: spec.id, dashboardVersion: 1 });

    await bridge.changeDashboardFilters({ bucketIds: ["90+"] });
    expect(data.dashboards.get(spec.id)).toMatchObject({ version: 2, updatedBy: "app", filters: { bucketIds: ["90+"] } });
    expect(contexts.at(-1)).toMatchObject({ dashboardVersion: 2, dashboardFilters: { bucketIds: ["90+"] } });
    await bridge.askAboutDashboard();
    expect(vi.mocked(copilot.sendPromptToM365Copilot).mock.calls.at(-1)).toEqual([
      "Use the Collections tools to read the latest aging dashboard (v2, changed in the app) and tell me what it shows now.",
      { gptId: "T_collections.agent" },
    ]);

    // An older spec from the widget does not win.
    await copilot.dispatch(ActionIds.RenderDashboard, { spec });
    expect(bridge.store.get().dashboard?.spec.version).toBe(2);
    await copilot.dispatch(ActionIds.RenderDashboard, { dashboardId: "7c9e6679-7425-40de-944b-e07fc1f90ae7" });
    expect(bridge.store.get().notice).toMatchObject({ intent: "error" });
    bridge.closeDashboard();
    expect(bridge.store.get().dashboard).toBeUndefined();
  });
});

describe("LogFollowUp: propose, confirm, write locally", () => {
  it("writes only after confirmation", async () => {
    const { copilot, navigation, data, bridge } = setup();
    await copilot.dispatch(ActionIds.LogFollowUp, { customerNo: "C-1001", note: "Promised to pay SI-104008", promiseDate: "2026-12-04", promisedAmount: 48500 });
    expect(navigation.openConfirmDialog).toHaveBeenCalled();
    expect(data.actionLog.find((e) => e.kind === "followUp")).toMatchObject({ customerNo: "C-1001" });
    navigation.openConfirmDialog.mockResolvedValueOnce({ confirmed: false });
    await copilot.dispatch(ActionIds.LogFollowUp, { customerNo: "C-1001", note: "second" });
    expect(data.actionLog.filter((e) => e.kind === "followUp")).toHaveLength(1);
    expect(bridge.store.get().notice?.text).toBe("Follow-up not logged");
  });
});

describe("lifecycle", () => {
  it("unregisters every handler on dispose", () => {
    const { bridge, handlers } = setup();
    expect([...handlers.values()].every((h) => h.length === 1)).toBe(true);
    bridge.dispose();
    expect([...handlers.values()].every((h) => h.length === 0)).toBe(true);
  });
});
