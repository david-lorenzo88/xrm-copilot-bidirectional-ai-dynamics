import { createStore } from "@collections/pcf-bridge/bridge";

export interface MockPane {
  paneId: string;
  title: string;
  record?: { entityName: string; entityId: string };
}

export interface MockDialog {
  title: string;
  text: string;
  confirmLabel: string;
  cancelLabel: string;
  resolve: (confirmed: boolean) => void;
}

export interface MdaState {
  panes: MockPane[];
  selectedPane?: string;
  /** What the main subgrid shows. */
  grid: { kind: "overdue" } | { kind: "worklist"; title: string } | { kind: "fetch"; title: string; fetchXml: string };
  dialog?: MockDialog;
  log: { at: string; kind: string; text: string; data?: unknown }[];
}

/** UI state of the fake model-driven app (side panes, grid view, dialogs, event log). */
export const mda = createStore<MdaState>({ panes: [], grid: { kind: "overdue" }, log: [] });

export function logEvent(kind: string, text: string, data?: unknown) {
  mda.set((s) => ({ log: [{ at: new Date().toLocaleTimeString(), kind, text, data }, ...s.log].slice(0, 80) }));
}
