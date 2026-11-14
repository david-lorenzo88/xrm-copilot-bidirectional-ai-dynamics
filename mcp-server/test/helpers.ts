import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MockRepository } from "../src/repository/mock";
import { createCollectionsServer } from "../src/server";
import type { WidgetSource } from "../src/widgets";

export const stubWidgets: WidgetSource = async (key) => `<!doctype html><html><body data-widget="${key}"></body></html>`;

/** Real server + real client over an in-memory transport, backed by the fixtures. */
export async function connect(repository = new MockRepository()) {
  const server = createCollectionsServer({ repository, widgets: stubWidgets });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = async <T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
    const first = result.content[0];
    return { ...result, data: result.structuredContent as T, text: first?.type === "text" ? first.text : "" };
  };
  return { client, server, repository, call };
}
