import { ActionPayloadSchemas, isKnownActionId, type ActionId, type ActionPayload } from "./actions";

/** postMessage event name a widget uses to send an action to the hosting app. */
export const COPILOT_CHAT_ACTION_EVENT = "powerapps.copilot.chat.action";

export interface CopilotChatActionMessage<A extends ActionId = ActionId> {
  eventName: typeof COPILOT_CHAT_ACTION_EVENT;
  action: A;
  actionData: ActionPayload<A>;
}

/** Builds (and validates) the message a widget posts to `window.parent.parent`. */
export function createChatActionMessage<A extends ActionId>(action: A, actionData: ActionPayload<A>): CopilotChatActionMessage<A> {
  const data = ActionPayloadSchemas[action].parse(actionData) as ActionPayload<A>;
  return { eventName: COPILOT_CHAT_ACTION_EVENT, action, actionData: data };
}

export function isCopilotChatActionMessage(value: unknown): value is CopilotChatActionMessage {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return m.eventName === COPILOT_CHAT_ACTION_EVENT && isKnownActionId(m.action) && "actionData" in m;
}

/** Same action, as Adaptive Card `Action.Submit` data (the other documented route). */
export function createAdaptiveCardSubmitData<A extends ActionId>(action: A, actionData: ActionPayload<A>) {
  return { type: "PowerApps" as const, action, actionData: ActionPayloadSchemas[action].parse(actionData) as ActionPayload<A> };
}
