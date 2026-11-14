import { RESOURCE_MIME_TYPE, registerAppResource } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** The two MCP Apps widgets. Each is one self-contained HTML file built from @collections/ui. */
export const WIDGETS = {
  priorityList: {
    uri: "ui://collections/priority-list",
    file: "priority-list.html",
    name: "Collections priority list",
    description: "Ranked chase-today list; opens critical invoices and the worklist in the app.",
  },
  agingDashboard: {
    uri: "ui://collections/aging-dashboard",
    file: "aging-dashboard.html",
    name: "Aging dashboard",
    description: "Overdue by customer × aging bucket; mirrors itself into the app.",
  },
} as const;

export type WidgetKey = keyof typeof WIDGETS;
/** Loads a widget's HTML (from disk on Node, from a bundled string in the browser mock). */
export type WidgetSource = (key: WidgetKey) => Promise<string>;

export function registerWidgets(server: McpServer, source: WidgetSource): void {
  for (const [key, w] of Object.entries(WIDGETS) as [WidgetKey, (typeof WIDGETS)[WidgetKey]][]) {
    registerAppResource(server, w.name, w.uri, { description: w.description, _meta: { ui: { prefersBorder: true } } }, async () => ({
      contents: [
        {
          uri: w.uri,
          mimeType: RESOURCE_MIME_TYPE,
          text: await source(key),
          // Single-file build: no external scripts, styles or fetches are needed.
          _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true } },
        },
      ],
    }));
  }
}
