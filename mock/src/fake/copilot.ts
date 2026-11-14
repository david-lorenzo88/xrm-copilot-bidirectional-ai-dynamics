import { ActionIds, type PowerAppsContent } from "@collections/contract";
import type { ActionHandler, CopilotApi, SendPromptOptions } from "@collections/pcf-bridge/bridge";

export type CopilotEvent =
  | { type: "enabled"; enabled: boolean }
  | { type: "context"; content: PowerAppsContent }
  | { type: "panel-opened" }
  | { type: "prompt"; text: string; options?: SendPromptOptions }
  | { type: "action"; action: string; data: unknown; source: "widget" | "card"; handlers: number }
  | { type: "action-error"; action: string; error: string };

/** Base fields the platform merges into every updateContext call. */
const BASE_CONTEXT = { appId: "mock-collections-workspace", appType: "ModelDrivenApp", orgId: "mock-org", geo: "EU", schemaVersion: "1.0" };

/**
 * In-browser stand-in for Xrm.Copilot: same method names, an event bus instead of
 * the real side panel. All methods are no-ops while disabled, like the real API.
 */
export class FakeCopilot implements CopilotApi {
  private enabled = true;
  private readonly handlers = new Map<string, ActionHandler[]>();
  private readonly listeners = new Set<(e: CopilotEvent) => void>();
  private defaultsOn = false;
  context: (PowerAppsContent & typeof BASE_CONTEXT) | undefined;

  constructor(private readonly builtIns: Partial<Record<string, ActionHandler>> = {}) {}

  on(listener: (e: CopilotEvent) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  private emit(e: CopilotEvent) {
    this.listeners.forEach((l) => l(e));
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.emit({ type: "enabled", enabled });
  }
  isEnabled() {
    return this.enabled;
  }

  // ── Xrm.Copilot surface ────────────────────────────────────────────────
  async isM365CopilotEnabled() {
    return this.enabled;
  }
  async openM365CopilotPanel() {
    if (this.enabled) this.emit({ type: "panel-opened" });
  }
  async sendPromptToM365Copilot(text: string, options?: SendPromptOptions) {
    if (this.enabled) this.emit({ type: "prompt", text, options });
  }
  async updateContext(content: PowerAppsContent) {
    if (!this.enabled) return;
    this.context = { ...BASE_CONTEXT, ...content };
    this.emit({ type: "context", content: this.context });
  }
  addActionHandler(actionId: string, handler: ActionHandler) {
    this.handlers.set(actionId, [...(this.handlers.get(actionId) ?? []), handler]);
  }
  removeActionHandler(actionId: string, handler?: ActionHandler) {
    this.handlers.set(actionId, handler ? (this.handlers.get(actionId) ?? []).filter((h) => h !== handler) : []);
  }
  addDefaultActionHandlers() {
    this.defaultsOn = true;
  }
  removeDefaultActionHandlers() {
    this.defaultsOn = false;
  }
  async getCurrentAgent() {
    return { gptId: "T_contoso.collections.agent", name: "Collections (mock)" };
  }

  // ── Host side ──────────────────────────────────────────────────────────
  /** An agent action arrived (widget postMessage or Adaptive Card submit). Handlers run sequentially. */
  async deliverAction(action: string, data: unknown, source: "widget" | "card"): Promise<void> {
    if (!this.enabled) return;
    const list = [...(this.handlers.get(action) ?? [])];
    const builtIn = this.builtIns[action];
    if (list.length === 0 && this.defaultsOn && builtIn) list.push(builtIn);
    this.emit({ type: "action", action, data, source, handlers: list.length });
    for (const handler of list) {
      try {
        await handler(data);
      } catch (err) {
        this.emit({ type: "action-error", action, error: (err as Error).message });
      }
    }
  }
}

export const BUILT_IN_ACTIONS = [ActionIds.OpenRecord, ActionIds.NavigateToView] as const;
