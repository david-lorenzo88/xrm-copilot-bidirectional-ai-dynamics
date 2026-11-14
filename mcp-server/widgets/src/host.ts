import * as React from "react";
import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createChatActionMessage, type ActionId, type ActionPayload } from "@collections/contract";

/** One MCP App per widget document. Copilot hosts it; ontoolresult delivers the tool output. */
export const app = new App({ name: "contoso-collections-widget", version: "1.0.0" });

/**
 * Widget → model-driven app. The model-driven app's Copilot pane relays this
 * message to the handler registered with Xrm.Copilot.addActionHandler(action, …).
 */
export function postAppAction<A extends ActionId>(action: A, actionData: ActionPayload<A>): void {
  const message = createChatActionMessage(action, actionData); // validates against the contract
  // VERIFY: documented target is window.parent.parent (widget → renderer frame → host).
  window.parent.parent.postMessage(message, "*");
}

type Listener = (result: CallToolResult) => void;
const listeners = new Set<Listener>();
let latest: CallToolResult | undefined;
let pendingInput: Record<string, unknown> | undefined;

// Register before connect() so the first notification is not missed.
app.ontoolinput = (params) => {
  pendingInput = params.arguments;
};
app.ontoolresult = (result) => {
  latest = result as CallToolResult;
  listeners.forEach((l) => l(latest!));
};

export const connected = app.connect(new PostMessageTransport(window.parent, window.parent));

/** Latest tool result's structured content (from the agent's call or our own callServerTool). */
export function useToolResult<T>(): [T | undefined, (next: CallToolResult) => void, string | undefined] {
  const [state, setState] = React.useState<CallToolResult | undefined>(latest);
  React.useEffect(() => {
    listeners.add(setState);
    return () => void listeners.delete(setState);
  }, []);
  const error = state?.isError ? state.content.map((c) => (c.type === "text" ? c.text : "")).join(" ") : undefined;
  return [state && !state.isError ? (state.structuredContent as T) : undefined, setState, error];
}

/** Calls one of our server tools from inside the widget (a user-initiated change). */
export async function callTool<T>(name: string, args: Record<string, unknown>): Promise<{ result: CallToolResult; data?: T }> {
  const result = await app.callServerTool({ name, arguments: args });
  return { result, data: result.isError ? undefined : (result.structuredContent as T) };
}

export function toolInput(): Record<string, unknown> | undefined {
  return pendingInput;
}
