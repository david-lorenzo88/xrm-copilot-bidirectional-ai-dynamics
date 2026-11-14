import * as React from "react";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { widgetWindows } from "../fake/relay";

export interface WidgetFrameProps {
  client: Client;
  resourceUri: string;
  args: Record<string, unknown>;
  result: CallToolResult;
  onUserMessage: (text: string) => void;
  onModelContext: (text: string) => void;
}

/**
 * Hosts a ui:// widget the way an MCP Apps host does: read the resource, load it in
 * a sandboxed iframe, and bridge it to the MCP client (tool input/result, callServerTool…).
 */
export function WidgetFrame({ client, resourceUri, args, result, onUserMessage, onModelContext }: WidgetFrameProps) {
  const ref = React.useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = React.useState(240);

  React.useEffect(() => {
    const iframe = ref.current!;
    const win = iframe.contentWindow!;
    widgetWindows.add(win);
    const bridge = new AppBridge(
      client,
      { name: "Mock Microsoft 365 Copilot", version: "1.0.0" },
      { openLinks: {}, serverTools: {}, updateModelContext: { text: {} }, message: { text: {} } },
      { hostContext: { theme: "light", displayMode: "inline", availableDisplayModes: ["inline"], platform: "web" } },
    );
    bridge.oninitialized = () => {
      void bridge.sendToolInput({ arguments: args });
      void bridge.sendToolResult(result);
    };
    bridge.onsizechange = ({ height: h }) => h && setHeight(Math.min(Math.max(h, 120), 1600));
    bridge.onmessage = async ({ content }) => {
      onUserMessage(content.map((c) => (c.type === "text" ? c.text : "")).join(" "));
      return {};
    };
    bridge.onupdatemodelcontext = async ({ content }) => {
      onModelContext((content ?? []).map((c) => (c.type === "text" ? c.text : "")).join(" "));
      return {};
    };
    bridge.onopenlink = async ({ url }) => {
      window.open(url, "_blank", "noopener");
      return {};
    };
    let cancelled = false;
    (async () => {
      await bridge.connect(new PostMessageTransport(win, win));
      const res = await client.readResource({ uri: resourceUri });
      const html = res.contents[0] && "text" in res.contents[0] ? res.contents[0].text : "<p>Widget not found</p>";
      if (!cancelled) iframe.srcdoc = html;
    })().catch((err: Error) => {
      if (!cancelled) iframe.srcdoc = `<pre style="color:#b10e1c">Widget failed: ${err.message}</pre>`;
    });
    return () => {
      cancelled = true;
      widgetWindows.delete(win);
      void bridge.close();
    };
    // The widget is rendered once per tool result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <iframe
      ref={ref}
      title={resourceUri}
      sandbox="allow-scripts allow-forms allow-popups"
      style={{ width: "100%", height, border: "1px solid #e1dfdd", borderRadius: 8, background: "white" }}
    />
  );
}
