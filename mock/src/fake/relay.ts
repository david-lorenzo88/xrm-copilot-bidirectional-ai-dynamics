import { isCopilotChatActionMessage } from "@collections/contract";
import type { FakeCopilot } from "./copilot";

/** Widget windows we created; messages from anywhere else are ignored. */
export const widgetWindows = new Set<MessageEventSource>();

/**
 * What the real Copilot pane does for us: a widget posts
 * { eventName: 'powerapps.copilot.chat.action', action, actionData } to
 * window.parent.parent, and the host routes it to Xrm.Copilot action handlers.
 */
export function installWidgetRelay(copilot: FakeCopilot): () => void {
  const onMessage = (event: MessageEvent) => {
    if (!event.source || !widgetWindows.has(event.source)) return;
    if (!isCopilotChatActionMessage(event.data)) return;
    void copilot.deliverAction(event.data.action, event.data.actionData, "widget");
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
