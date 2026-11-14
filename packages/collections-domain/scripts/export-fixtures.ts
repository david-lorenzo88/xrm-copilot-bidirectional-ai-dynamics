/**
 * Writes the demo fixtures to JSON so they can seed a Business Central sandbox
 * (e.g. through a configuration package or the BC API) with the same patterns.
 *   npm run fixtures:export -- ./out
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fixtures } from "../src/fixtures";

const outDir = resolve(process.argv[2] ?? "out/fixtures");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "customers.json"), JSON.stringify(fixtures.customers, null, 2));
writeFileSync(join(outDir, "invoices.json"), JSON.stringify(fixtures.invoices, null, 2));
console.log(`Wrote ${fixtures.customers.length} customers and ${fixtures.invoices.length} invoices to ${outDir}`);
