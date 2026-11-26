import {
  ActionIds,
  CONTRACT_VERSION,
  applyDashboardPatch,
  type CollectionsContext,
  type DashboardFilters,
  type DashboardSpec,
  type ParsedAction,
} from "@collections/contract";
import { BC_TABLES, ageInvoices, buildOverdueInvoicesFetchXml, formatIsoDate, round2, type DashboardData, type WorklistItem } from "@collections/domain";
import { computeDashboard, confirmAndLogFollowUp, loadWorklist, navigateToWorklistView, openInvoicesInSidePanes, resolveDashboard } from "./actions";
import { askCopilot, createContextPublisher } from "./context";
import type { CollectionsDataService, CustomerNote } from "./data";
import { registerActionHandlers } from "./handlers";
import { createStore, type Store } from "./store";
import type { CopilotApi, SidePanes, XrmNavigation } from "./xrm";

export interface BridgeSettings {
  /** The declarative agent to target with sendPromptToM365Copilot. */
  gptId?: string;
  autoOpenPanel: boolean;
  viewName: string;
  analyzePrompt: string;
  /** Sent by "Research online": web research on the customer's context; {customer} and {city} are filled in. */
  researchPrompt: string;
  /** Sent by "Build aging dashboard" (beat 3 without typing; works even if the pane left the agent). */
  buildDashboardPrompt: string;
  /** Sent by "Ask Copilot" after an in-app dashboard change; {version} becomes "v4". */
  dashboardPrompt: string;
  /** Optional saved view to switch the grid to on ShowWorklist. */
  worklistViewId?: string;
  /** Demo: show the "Share context with Copilot" switch (before/after for the bridge). */
  showContextSwitch?: boolean;
}

export const DEFAULT_SETTINGS: BridgeSettings = {
  autoOpenPanel: true,
  viewName: "Overdue invoices",
  analyzePrompt: "Use the Collections tools to analyze the payment behavior of {customer} and prioritize what to chase today.",
  researchPrompt:
    "Use web search to research the payment and credit climate for {customer}, based in {city}: late-payment trends, insolvencies and regulation in that country and sector (such as the EU late payment rules). Don't search for the company itself. Then use the Collections tools to propose a research note with a short summary and the source links, so I can insert it into the record.",
  buildDashboardPrompt: "Use the Collections tools to build me a dashboard of overdue by customer and aging bucket.",
  dashboardPrompt: "Use the Collections tools to read the latest aging dashboard ({version}, changed in the app) and tell me what it shows now.",
};

export interface BridgeDeps {
  /** undefined when Xrm.Copilot is missing: the control still works, minus Copilot. */
  copilot?: CopilotApi;
  sidePanes?: SidePanes;
  navigation?: XrmNavigation;
  data: CollectionsDataService;
  settings: BridgeSettings;
  today?: () => string;
}

export interface RecordInfo {
  customerNo?: string;
  recordId?: string;
}

export type Notice = { intent: "info" | "success" | "warning" | "error"; text: string };

export interface BridgeState {
  copilot: "checking" | "enabled" | "disabled" | "unavailable";
  record?: RecordInfo;
  customerName?: string;
  context?: CollectionsContext;
  worklist?: { title: string; items: WorklistItem[] };
  dashboard?: { spec: DashboardSpec; data: DashboardData };
  notice?: Notice;
  busy?: boolean;
  /** Latest confirmed follow-ups and research notes for this customer (shown on the form). */
  notes?: CustomerNote[];
  customerCity?: string;
  /** False = the app keeps the record to itself: nothing published, prompts don't name the customer. */
  shareContext: boolean;
}

export interface CollectionsBridge {
  store: Store<BridgeState>;
  settings: BridgeSettings;
  setRecord(record: RecordInfo): Promise<void>;
  analyze(): Promise<void>;
  /** App → agent: web research on the customer's context, proposed as a note the user inserts. */
  research(): Promise<void>;
  /** Demo switch: share the record with Copilot (default) or not, to show the difference the bridge makes. */
  setShareContext(on: boolean): Promise<void>;
  /** App → agent: build the aging dashboard (the agent asks to confirm, then it renders in both places). */
  buildDashboard(): Promise<void>;
  changeDashboardFilters(filters: DashboardFilters): Promise<void>;
  /** App → agent after an in-app change: authored agents don't get updateContext, so the prompt says so. */
  askAboutDashboard(): Promise<void>;
  /** In-app click on a worklist row (same side-pane behaviour as the agent action). */
  openInvoice(invoiceId: string, invoiceNo: string): Promise<void>;
  closeDashboard(): void;
  closeWorklist(): void;
  dispose(): void;
}

/** Wires context publishing, the "Analyze" prompt and the four action handlers together. */
export function createCollectionsBridge(deps: BridgeDeps): CollectionsBridge {
  const { copilot, data, settings } = deps;
  const today = deps.today ?? (() => formatIsoDate(new Date()));
  const store = createStore<BridgeState>({ copilot: copilot ? "checking" : "unavailable", shareContext: true });
  let publish = copilot ? createContextPublisher(copilot) : undefined;
  let panelOpened = false;

  const notify = (notice: Notice) => store.set({ notice });

  async function refreshContext(openPanel: boolean): Promise<void> {
    const { record, dashboard } = store.get();
    if (!record?.customerNo) return;
    const asOf = today();
    const [customer, invoices] = await Promise.all([data.findCustomer(record.customerNo), data.openInvoices([record.customerNo])]);
    const overdue = ageInvoices(invoices, asOf).filter((i) => i.daysOverdue > 0);
    const context: CollectionsContext = {
      contractVersion: CONTRACT_VERSION,
      entity: BC_TABLES.customer.logicalName,
      recordId: record.recordId ?? customer?.id,
      customerNo: record.customerNo,
      customerName: customer?.name,
      view: settings.viewName,
      filterXML: buildOverdueInvoicesFetchXml({ asOf, customerNo: record.customerNo }),
      overdueTotal: round2(overdue.reduce((s, i) => s + i.remainingAmount, 0)),
      currency: customer?.currency ?? invoices[0]?.currency,
      ...(dashboard ? { dashboardId: dashboard.spec.id, dashboardVersion: dashboard.spec.version, dashboardFilters: dashboard.spec.filters } : {}),
    };
    store.set({ context, customerName: customer?.name, customerCity: customer?.city });
    if (!publish || !copilot) return;
    if (!store.get().shareContext) {
      // Context switched off: still check Copilot and open the pane, but tell it nothing about the record.
      const enabled = await copilot.isM365CopilotEnabled();
      store.set({ copilot: enabled ? "enabled" : "disabled" });
      if (enabled && openPanel && settings.autoOpenPanel && !panelOpened) {
        await copilot.openM365CopilotPanel();
        panelOpened = true;
      }
      return;
    }
    const result = await publish(context, openPanel && settings.autoOpenPanel && !panelOpened);
    if (result === "published" && openPanel) panelOpened = true;
    if (result !== "unchanged") store.set({ copilot: result === "disabled" ? "disabled" : "enabled" });
  }

  async function loadNotes(): Promise<void> {
    const customerNo = store.get().record?.customerNo;
    if (!customerNo) return;
    const notes = await data.listNotes(customerNo).catch((err: Error) => {
      console.warn("[CollectionsBridge] notes unavailable", err);
      return undefined;
    });
    if (notes) store.set({ notes });
  }

  async function showDashboard(spec: DashboardSpec): Promise<void> {
    store.set({ dashboard: { spec, data: await computeDashboard(data, spec, today()) } });
    await refreshContext(false); // the agent's next turn sees dashboardId + version + filters
  }

  async function run(action: ParsedAction): Promise<void> {
    switch (action.action) {
      case ActionIds.OpenInvoices:
        if (!deps.sidePanes) throw new Error("Side panes are not available here");
        await openInvoicesInSidePanes(deps.sidePanes, action.data);
        return notify({ intent: "success", text: `Opened ${action.data.invoiceIds.length} invoice(s) in side panes` });
      case ActionIds.ShowWorklist:
        store.set({ worklist: await loadWorklist(data, action.data, today()) });
        await navigateToWorklistView(deps.navigation, settings.worklistViewId);
        return notify({ intent: "success", text: `Showing "${action.data.title}"` });
      case ActionIds.RenderDashboard: {
        const spec = await resolveDashboard(data, action.data);
        if (!spec) throw new Error(`Dashboard ${action.data.dashboardId} not found`);
        return showDashboard(spec);
      }
      case ActionIds.LogFollowUp: {
        if (!deps.navigation) throw new Error("Confirmation dialog not available");
        const id = await confirmAndLogFollowUp(deps.navigation, data, action.data);
        const what = action.data.kind === "research" ? "Research note" : "Follow-up";
        if (id) await loadNotes();
        return notify(id ? { intent: "success", text: `${what} saved to this record` } : { intent: "info", text: `${what} not saved` });
      }
      default:
        throw new Error(`No in-app behaviour for ${action.action}`);
    }
  }

  const audit = (entry: Parameters<CollectionsDataService["audit"]>[0]) =>
    data.audit({ customerNo: store.get().record?.customerNo, ...entry }).catch((err: Error) => console.warn("[CollectionsBridge] audit failed", err));

  const unregister = copilot
    ? registerActionHandlers(copilot, {
        async run(action) {
          try {
            store.set({ busy: true });
            await run(action);
            void audit({ actionId: action.action, outcome: "handled", payload: action.data });
          } catch (err) {
            notify({ intent: "error", text: (err as Error).message });
            void audit({ actionId: action.action, outcome: "failed", payload: action.data, detail: (err as Error).message });
          } finally {
            store.set({ busy: false });
          }
        },
        rejected(actionId, error, payload) {
          notify({ intent: "warning", text: `Ignored ${actionId}: ${error}` });
          void audit({ actionId, outcome: "rejected", payload, detail: error });
        },
      })
    : undefined;

  return {
    store,
    settings,
    async setRecord(record) {
      const current = store.get().record;
      if (current?.customerNo === record.customerNo && current?.recordId === record.recordId) return;
      store.set({ record, worklist: undefined, notes: undefined });
      await refreshContext(true).catch((err: Error) => notify({ intent: "error", text: err.message }));
      await loadNotes();
    },
    async analyze() {
      if (!copilot) return notify({ intent: "warning", text: "Microsoft 365 Copilot is not available in this app" });
      if (store.get().copilot === "disabled") return notify({ intent: "warning", text: "Microsoft 365 Copilot is turned off for this app or user" });
      const { context, shareContext } = store.get();
      // Without shared context the prompt says "this customer" and nothing else: the agent can't know which.
      await askCopilot(copilot, settings.analyzePrompt, shareContext ? context : undefined, settings.gptId);
    },
    async setShareContext(on) {
      if (store.get().shareContext === on) return;
      store.set({ shareContext: on });
      if (!copilot) return;
      if (!on) {
        // Withdraw what was published (only the table stays) and start the de-duplication afresh.
        await Promise.resolve(copilot.updateContext({ entity: BC_TABLES.customer.logicalName }));
        publish = createContextPublisher(copilot);
      }
      await refreshContext(false).catch((err: Error) => notify({ intent: "error", text: err.message }));
    },
    async research() {
      if (!copilot) return notify({ intent: "warning", text: "Microsoft 365 Copilot is not available in this app" });
      if (store.get().copilot === "disabled") return notify({ intent: "warning", text: "Microsoft 365 Copilot is turned off for this app or user" });
      const { context, shareContext, customerCity } = store.get();
      const prompt = settings.researchPrompt.split("{city}").join(customerCity || "its home country");
      await askCopilot(copilot, prompt, shareContext ? context : undefined, settings.gptId);
    },
    async buildDashboard() {
      if (!copilot) return notify({ intent: "warning", text: "Microsoft 365 Copilot is not available in this app" });
      if (store.get().copilot === "disabled") return notify({ intent: "warning", text: "Microsoft 365 Copilot is turned off for this app or user" });
      await copilot.sendPromptToM365Copilot(settings.buildDashboardPrompt, settings.gptId ? { gptId: settings.gptId } : undefined);
    },
    async changeDashboardFilters(filters) {
      const current = store.get().dashboard;
      if (!current) return;
      const saved = await data.saveDashboard(applyDashboardPatch(current.spec, { filters }, "app"));
      await showDashboard(saved);
    },
    async askAboutDashboard() {
      const spec = store.get().dashboard?.spec;
      if (!copilot || !spec) return;
      await copilot.sendPromptToM365Copilot(settings.dashboardPrompt.split("{version}").join(`v${spec.version}`), settings.gptId ? { gptId: settings.gptId } : undefined);
    },
    async openInvoice(invoiceId, invoiceNo) {
      if (deps.sidePanes) await openInvoicesInSidePanes(deps.sidePanes, { invoiceIds: [invoiceId], invoiceNumbers: [invoiceNo] });
    },
    closeDashboard: () => store.set({ dashboard: undefined }),
    closeWorklist: () => store.set({ worklist: undefined }),
    dispose: () => unregister?.(),
  };
}
