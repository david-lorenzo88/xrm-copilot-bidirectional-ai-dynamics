import type { PowerAppsContent } from "@collections/contract";

/**
 * The slice of the client API this control uses, typed by hand because
 * @types/xrm does not cover Xrm.Copilot yet.
 */
export interface SendPromptOptions {
  /** Target agent (the declarative agent's id). */
  gptId?: string;
  /**
   * VERIFY: the reference says options cover the target agent and whether the
   * prompt is submitted automatically. Confirm the exact property name in the tenant.
   */
  autoSubmit?: boolean;
  [option: string]: unknown;
}

export type ActionHandler = (actionData: unknown) => unknown | Promise<unknown>;

export interface CopilotApi {
  isM365CopilotEnabled(): Promise<boolean>;
  openM365CopilotPanel(): Promise<void> | void;
  sendPromptToM365Copilot(promptText: string, options?: SendPromptOptions): Promise<void> | void;
  updateContext(context: PowerAppsContent): Promise<void> | void;
  addActionHandler(actionId: string, handler: ActionHandler): void;
  removeActionHandler(actionId: string, handler?: ActionHandler): void;
  addDefaultActionHandlers?(): void;
  removeDefaultActionHandlers?(): void;
  getCurrentAgent?(): Promise<unknown>;
}

export interface SidePane {
  paneId?: string;
  title?: string;
  navigate(pageInput: { pageType: "entityrecord"; entityName: string; entityId: string }): Promise<void>;
  select?(): void;
}

export interface SidePanes {
  createPane(options: { title?: string; paneId?: string; canClose?: boolean; width?: number; imageSrc?: string }): Promise<SidePane> | SidePane;
  getPane?(paneId: string): SidePane | undefined;
}

export interface XrmNavigation {
  navigateTo(pageInput: Record<string, unknown>, navigationOptions?: Record<string, unknown>): Promise<unknown>;
  openConfirmDialog(strings: { title?: string; text: string; confirmButtonLabel?: string; cancelButtonLabel?: string }, options?: Record<string, unknown>): Promise<{ confirmed: boolean }>;
}

export interface XrmLike {
  Copilot?: CopilotApi;
  App?: { sidePanes?: SidePanes };
  Navigation?: XrmNavigation;
}

/**
 * Pragmatic but unsupported: PCF controls should use the `context` object, and
 * `window.Xrm` is not part of the PCF contract. Xrm.Copilot and Xrm.App.sidePanes
 * have no PCF equivalent today, so we read it here, in one place. The supported
 * alternative is a form OnLoad script (see docs/architecture.md).
 */
export function getXrm(): XrmLike | undefined {
  const w = globalThis as unknown as { Xrm?: XrmLike; parent?: { Xrm?: XrmLike } };
  if (w.Xrm) return w.Xrm;
  try {
    return w.parent?.Xrm;
  } catch {
    return undefined; // cross-origin parent
  }
}

/** Feature check: Xrm.Copilot exists and has the methods we rely on. */
export function getCopilot(xrm: XrmLike | undefined = getXrm()): CopilotApi | undefined {
  const c = xrm?.Copilot;
  const required: (keyof CopilotApi)[] = ["isM365CopilotEnabled", "updateContext", "sendPromptToM365Copilot", "addActionHandler", "removeActionHandler", "openM365CopilotPanel"];
  return c && required.every((m) => typeof c[m] === "function") ? c : undefined;
}
