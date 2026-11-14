import { fetchXmlEntityName } from "@collections/contract";
import type { SidePane, SidePanes, XrmLike, XrmNavigation } from "@collections/pcf-bridge/bridge";
import type { FakeCopilot } from "./copilot";
import { logEvent, mda, type MockPane } from "./mda-store";

export const MOCK_WORKLIST_VIEW_ID = "00000000-0000-0000-0000-00000000c0de";

function paneHandle(pane: MockPane): SidePane {
  return {
    paneId: pane.paneId,
    title: pane.title,
    async navigate(input) {
      mda.set((s) => ({ panes: s.panes.map((p) => (p.paneId === pane.paneId ? { ...p, record: { entityName: input.entityName, entityId: input.entityId } } : p)) }));
      logEvent("sidePanes", `pane "${pane.title}" → ${input.entityName}(${input.entityId.slice(0, 8)}…)`);
    },
    select() {
      mda.set({ selectedPane: pane.paneId });
    },
  };
}

const sidePanes: SidePanes = {
  async createPane(options) {
    const pane: MockPane = { paneId: options.paneId ?? `pane-${Date.now()}`, title: options.title ?? "Pane" };
    mda.set((s) => ({ panes: [...s.panes, pane], selectedPane: pane.paneId }));
    logEvent("sidePanes", `createPane "${pane.title}"`);
    return paneHandle(pane);
  },
  getPane(paneId) {
    const pane = mda.get().panes.find((p) => p.paneId === paneId);
    return pane ? paneHandle(pane) : undefined;
  },
};

const navigation: XrmNavigation = {
  async navigateTo(pageInput) {
    logEvent("navigateTo", JSON.stringify(pageInput));
    if (pageInput.pageType === "entitylist" && pageInput.viewId === MOCK_WORKLIST_VIEW_ID) mda.set({ grid: { kind: "worklist", title: "Chase today" } });
    return undefined;
  },
  openConfirmDialog(strings) {
    logEvent("dialog", `openConfirmDialog "${strings.title ?? ""}"`);
    return new Promise((resolve) =>
      mda.set({
        dialog: {
          title: strings.title ?? "Confirm",
          text: strings.text,
          confirmLabel: strings.confirmButtonLabel ?? "OK",
          cancelLabel: strings.cancelButtonLabel ?? "Cancel",
          resolve: (confirmed) => {
            mda.set({ dialog: undefined });
            resolve({ confirmed });
          },
        },
      }),
    );
  },
};

/** The fake `window.Xrm`: Copilot + side panes + navigation, enough for the bridge. */
export function createFakeXrm(copilot: FakeCopilot): XrmLike {
  return { Copilot: copilot, App: { sidePanes }, Navigation: navigation };
}

/** Platform defaults for the two built-in actions (used when addDefaultActionHandlers is on). */
export const builtInHandlers = {
  "MS.PA.CopilotChat.OpenRecord": async (data: unknown) => {
    const { entity, recordId } = data as { entity: string; recordId: string };
    const pane = await sidePanes.createPane({ title: entity, paneId: `rec-${recordId}`, canClose: true });
    await pane.navigate({ pageType: "entityrecord", entityName: entity, entityId: recordId });
  },
  "MS.PA.CopilotChat.NavigateToView": async (data: unknown) => {
    const { fetchXml } = data as { fetchXml: string };
    mda.set({ grid: { kind: "fetch", title: `View (${fetchXmlEntityName(fetchXml) ?? "?"})`, fetchXml } });
  },
};
