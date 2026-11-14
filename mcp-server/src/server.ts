import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CollectionsRepository } from "./repository/types";
import { registerTools } from "./tools/register";
import { registerWidgets, type WidgetSource } from "./widgets";

export const SERVER_INFO = { name: "contoso-collections", version: "1.0.0" } as const;

export interface CollectionsServerOptions {
  repository: CollectionsRepository;
  widgets: WidgetSource;
}

/** Builds the MCP server. Browser-safe: no Node-only imports here (the mock host runs it in-page). */
export function createCollectionsServer({ repository, widgets }: CollectionsServerOptions): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "Collections tools over Business Central data. Always use these tools for numbers; never estimate. " +
      "prioritize_collections and build_aging_dashboard render widgets that also drive the Collections Workspace app.",
  });
  registerWidgets(server, widgets);
  registerTools(server, repository);
  return server;
}
