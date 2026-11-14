/**
 * Writes agent/appPackage/mcp-tools.json from the live tool catalogue, so the
 * declarative agent's static tool description never drifts from the server.
 *   npm run export:tools -w mcp-server
 */
import { writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MockRepository } from "../src/repository/mock";
import { createCollectionsServer } from "../src/server";

const server = createCollectionsServer({ repository: new MockRepository(), widgets: async () => "" });
const [a, b] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "export-tools", version: "1.0.0" });
await Promise.all([server.connect(b), client.connect(a)]);
const { tools } = await client.listTools();
const target = new URL("../../agent/appPackage/mcp-tools.json", import.meta.url);
writeFileSync(target, JSON.stringify({ tools }, null, 2) + "\n");
console.log(`Wrote ${tools.length} tools to ${target.pathname}`);
await client.close();
