import { CUSTOM_ACTION_IDS, createActionGuard, type ParsedAction } from "@collections/contract";
import { WORKLIST_ENTITIES } from "@collections/domain";
import type { ActionHandler, CopilotApi } from "./xrm";

/** The app's allow-list: only our four actions, FetchXML only against the invoice table. */
export const actionGuard = createActionGuard({ allowed: CUSTOM_ACTION_IDS, allowedEntities: WORKLIST_ENTITIES });

export interface ActionCallbacks {
  run(action: ParsedAction): Promise<void>;
  rejected(actionId: string, error: string, data: unknown): void;
}

/**
 * Agent → app. Registers one handler per custom action; every payload goes
 * through the contract's allow-list before anything happens.
 * Returns the cleanup function (call it from the control's destroy()).
 */
export function registerActionHandlers(copilot: CopilotApi, callbacks: ActionCallbacks): () => void {
  const registered = CUSTOM_ACTION_IDS.map((actionId) => {
    const handler: ActionHandler = async (actionData) => {
      const parsed = actionGuard.parse(actionId, unwrap(actionId, actionData));
      if (!parsed.ok) return callbacks.rejected(actionId, parsed.error, actionData);
      await callbacks.run(parsed);
    };
    copilot.addActionHandler(actionId, handler);
    return [actionId, handler] as const;
  });
  return () => registered.forEach(([actionId, handler]) => copilot.removeActionHandler(actionId, handler));
}

/**
 * VERIFY: the reference says the handler receives the action data payload. If the
 * tenant delivers the whole envelope ({ action, actionData }) instead, unwrap it here.
 */
function unwrap(actionId: string, raw: unknown): unknown {
  const r = raw as { action?: unknown; actionData?: unknown } | null;
  return r && typeof r === "object" && r.action === actionId && "actionData" in r ? r.actionData : raw;
}
