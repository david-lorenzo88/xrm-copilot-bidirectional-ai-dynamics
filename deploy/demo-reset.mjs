#!/usr/bin/env node
/**
 * Puts the demo back to its starting state after a rehearsal.
 *
 *   node deploy/demo-reset.mjs [--all] [--dry-run]
 *
 * Always: Fabrikam (DEMO-C-1001) back to credit limit 60,000 and not blocked. This writes through the
 * Business Central virtual table, so it changes the BC customer (the demo customer this repo created).
 * --all: also deletes this demo's dashboards (ppn_collectiondashboard), the follow-up / research notes and
 * audit rows for DEMO-C-* customers (ppn_collectionaction), and customers created in rehearsals (DEMO-C-
 * numbers above the 25 seeded ones, deleted in BC). Nothing else in BC or Dataverse is touched.
 * Requires `az` signed in to the tenant (Dataverse token).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry-run");
const ALL = process.argv.includes("--all");
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, "deploy", "tenant.env"), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const ORG = (env.DATAVERSE_URL ?? "").replace(/\/$/, "");
const PREFIX = env.CUSTOMER_NUMBER_PREFIX || "DEMO-C-";
const SEEDED_MAX = 1025; // deploy/bc-seed.mjs created DEMO-C-1001 … DEMO-C-1025
const HERO = { number: "DEMO-C-1001", creditLimit: 60000, blocked: 200000000 }; // 200000000 = not blocked
const token = execFileSync("az", ["account", "get-access-token", "--resource", ORG, "--query", "accessToken", "-o", "tsv"], { encoding: "utf8" }).trim();
const q = (s) => encodeURIComponent(s);

async function api(method, p, body) {
  if (DRY && method !== "GET") return console.log(`[dry-run] ${method} ${p}${body ? ` ${JSON.stringify(body)}` : ""}`);
  const res = await fetch(`${ORG}/api/data/v9.2/${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json", "If-Match": "*" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const c = (await api("GET", `dyn365bc_customers_v2_0?$select=dyn365bc_customer_v2_0id,dyn365bc_creditlimit,dyn365bc_blocked&$filter=${q(`dyn365bc_number eq '${HERO.number}'`)}`)).value[0];
if (!c) throw new Error(`${HERO.number} not found`);
if (c.dyn365bc_creditlimit === HERO.creditLimit && c.dyn365bc_blocked === HERO.blocked) console.log(` ok ${HERO.number} already at ${HERO.creditLimit}, not blocked`);
else {
  await api("PATCH", `dyn365bc_customers_v2_0(${c.dyn365bc_customer_v2_0id})`, { dyn365bc_creditlimit: HERO.creditLimit, dyn365bc_blocked: HERO.blocked });
  console.log(` ok ${HERO.number}: credit limit ${c.dyn365bc_creditlimit} -> ${HERO.creditLimit}, blocked ${c.dyn365bc_blocked} -> ${HERO.blocked} (written to BC)`);
}

if (ALL) {
  const dashboards = (await api("GET", "ppn_collectiondashboards?$select=ppn_collectiondashboardid")).value;
  for (const d of dashboards) await api("DELETE", `ppn_collectiondashboards(${d.ppn_collectiondashboardid})`);
  console.log(` ok ${dashboards.length} dashboard(s) ${DRY ? "would be " : ""}deleted`);
  const actions = (await api("GET", `ppn_collectionactions?$select=ppn_collectionactionid&$filter=${q(`startswith(ppn_customerno,'${PREFIX}') or ppn_customerno eq null`)}`)).value;
  for (const a of actions) await api("DELETE", `ppn_collectionactions(${a.ppn_collectionactionid})`);
  console.log(` ok ${actions.length} note/audit row(s) ${DRY ? "would be " : ""}deleted`);
  const created = (await api("GET", `dyn365bc_customers_v2_0?$select=dyn365bc_customer_v2_0id,dyn365bc_number,dyn365bc_displayname&$filter=${q(`startswith(dyn365bc_number,'${PREFIX}')`)}`)).value
    .filter((x) => Number(x.dyn365bc_number.slice(PREFIX.length)) > SEEDED_MAX);
  for (const x of created) await api("DELETE", `dyn365bc_customers_v2_0(${x.dyn365bc_customer_v2_0id})`);
  console.log(` ok ${created.length} rehearsal customer(s) ${DRY ? "would be " : ""}deleted in BC${created.length ? `: ${created.map((x) => `${x.dyn365bc_number} ${x.dyn365bc_displayname}`).join(", ")}` : ""}`);
}
