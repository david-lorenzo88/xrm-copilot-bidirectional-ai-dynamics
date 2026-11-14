import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MockRepository } from "@collections/mcp-server/mock-repository";
import { createCollectionsServer } from "@collections/mcp-server/server";
import { WIDGETS, type WidgetSource } from "@collections/mcp-server/widgets";
// Built by `npm run build:widgets` (npm run demo does it first).
import agingDashboardHtml from "../../../mcp-server/dist/widgets/aging-dashboard.html?raw";
import priorityListHtml from "../../../mcp-server/dist/widgets/priority-list.html?raw";

export type McpMode = "in-memory" | "http";

const bundledWidgets: WidgetSource = async (key) => (key === "priorityList" ? priorityListHtml : agingDashboardHtml);

/**
 * In-memory (default): the real MCP server code runs in this page with the
 * MockRepository: real tools, real protocol, no network.
 * http: a running server (`npm run demo:http`), through the Vite proxy.
 */
export async function connectMcp(mode: McpMode): Promise<Client> {
  const client = new Client({ name: "mock-m365-copilot", version: "1.0.0" });
  if (mode === "http") {
    await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", window.location.href)));
    return client;
  }
  const server = createCollectionsServer({ repository: new MockRepository(), widgets: bundledWidgets });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

export { WIDGETS };
