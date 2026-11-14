#!/usr/bin/env node
/**
 * Seeds Business Central (API v2.0) with the repository's own demo fixtures
 * (packages/collections-domain/src/fixtures): ~25 customers, ~300 posted sales
 * invoices and the customer payments that closed the paid ones, so ageing and
 * payment behaviour (days late, trend) come from real BC ledger entries.
 * Fabrikam (fixture C-1001) is the hero: worsening payer, one EUR 48,500 invoice 100 days overdue.
 *
 *   az login --tenant <tenant-id>                       # account with BC permissions (SUPER or D365 BUS FULL ACCESS)
 *   node deploy/bc-seed.mjs --dry-run                   # plan + request counts; no network, no sign-in needed
 *   node deploy/bc-seed.mjs                             # do it (idempotent: re-run to resume)
 *
 * Options
 *   --dry-run                 print the planned requests (with counts) instead of sending them
 *   --verbose                 print every request (dry-run: every planned request)
 *   --as-of YYYY-MM-DD        demo day the data is aligned to (default 2026-11-27). Fixture dates are shifted by
 *                             (as-of - 2026-11-27) days, so the patterns stay identical
 *   --prefix DEMO-            marks everything this script creates: customer "DEMO-C-1001", invoice external
 *                             document no. "DEMO-SI-104001", payment document no. "DEMO-PAY-104001"
 *   --steps a,b,c             subset of customers,invoices,payments (default: all three, in that order)
 *   --item <no>               invoice line = this item (default: first unblocked Service item, else Non-Inventory, else Inventory)
 *   --account <no>            invoice line = this G/L account instead of an item
 *   --bal-account <no>        G/L account (bank/cash) that balances the payment journal batch (default: discovered)
 *   --batch DEMOPAY           customer payment journal batch this script creates and owns
 *   --tenant <id>             Entra tenant (default: from `az account show`)
 *   --environment <name>      BC environment (default: BC_ENVIRONMENT in deploy/tenant.env)
 *   --company <name>          BC company (default: BC_COMPANY in deploy/tenant.env)
 *
 * Auth: `az account get-access-token --resource https://api.businesscentral.dynamics.com` (delegated, Azure CLI
 * client; confirmed to work in the demo tenant). If a tenant blocks the Azure CLI client for BC, the fallback is an
 * app registration with the delegated permission "Dynamics 365 Business Central / Financials.ReadWrite.All" (admin
 * consent, "Allow public client flows" = Yes) and a device-code sign-in with @azure/msal-node (already a dependency of
 * mcp-server): PublicClientApplication({ auth: { clientId, authority: https://login.microsoftonline.com/<tenant> } })
 * .acquireTokenByDeviceCode({ scopes: ["https://api.businesscentral.dynamics.com/Financials.ReadWrite.All"] }).
 * It is documented, not wired in; replace getToken() below with that call if you ever need it.
 *
 * Safety: never deletes anything. Only creates records under the prefix and only changes records it created
 * (draft invoices it left behind, its own journal batch). Existing customers/invoices with the same
 * number/external document number are skipped, never modified. Tokens are never printed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const BC_RESOURCE = "https://api.businesscentral.dynamics.com";
const OWNER_MARKER = "xrm-copilot-collections";
const FIXTURE_SEED = 20261127;
/** VERIFY: customerPayments.amount sign. A payment credits the customer, so it is negative in a cash receipt journal. Checked by a one-payment canary before the rest. */
const PAYMENT_SIGN = -1;
const PAYMENT_CHUNK = 50;

// ------------------------------------------------------------------ output helpers
const tty = process.stderr.isTTY;
const color = (code, text) => (tty ? `\x1b[${code}m${text}\x1b[0m` : text);
function die(msg) {
  console.error(`${color(31, "ERROR")} ${msg}`);
  process.exit(1);
}
const log = (msg) => console.error(`${color(1, "==>")} ${msg}`);
const ok = (msg) => console.error(` ${color(32, "ok")} ${msg}`);
const warn = (msg) => console.error(`${color(33, "warn")} ${msg}`);
const round2 = (n) => Math.round(n * 100) / 100;
const eur = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DAY = 86_400_000;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const odataStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ------------------------------------------------------------------ args
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) die(`${name} needs a value`);
  return v;
};
if (flag("-h") || flag("--help")) {
  const src = readFileSync(fileURLToPath(import.meta.url), "utf8");
  console.log(src.slice(src.indexOf("/**") + 3, src.indexOf("*/")).replace(/^ \* ?/gm, ""));
  process.exit(0);
}
const known = new Set(["--dry-run", "--verbose", "--as-of", "--prefix", "--steps", "--item", "--account", "--bal-account", "--batch", "--tenant", "--environment", "--company"]);
for (const a of argv) if (a.startsWith("--") && !known.has(a)) die(`Unknown option ${a} (see --help)`);

const DRY = flag("--dry-run");
const VERBOSE = flag("--verbose");
const AS_OF = opt("--as-of", "2026-11-27");
const PREFIX = opt("--prefix", "DEMO-");
const STEPS = new Set(opt("--steps", "customers,invoices,payments").split(",").map((s) => s.trim()));
const BATCH = opt("--batch", "DEMOPAY").toUpperCase();
if (!/^\d{4}-\d{2}-\d{2}$/.test(AS_OF) || Number.isNaN(Date.parse(AS_OF))) die(`--as-of must be YYYY-MM-DD (got ${AS_OF})`);
if (!/^[A-Z0-9][A-Z0-9-]{0,7}$/.test(PREFIX)) die("--prefix must be 1-8 characters, A-Z 0-9 and '-' (it becomes part of BC Code fields)");
if (!/^[A-Z0-9]{1,10}$/.test(BATCH)) die("--batch must be 1-10 characters A-Z 0-9");
for (const s of STEPS) if (!["customers", "invoices", "payments"].includes(s)) die(`--steps: unknown step ${s}`);
if (flag("--item") && flag("--account")) die("Use --item or --account, not both");

// ------------------------------------------------------------------ settings
function loadEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)=(.*)$/.exec(raw);
    if (!m || raw.trimStart().startsWith("#")) continue;
    out[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}
const tenantEnv = loadEnvFile(process.env.TENANT_ENV ?? join(HERE, "tenant.env"));
const setting = (k) => process.env[k] || tenantEnv[k];
const BC_ENVIRONMENT = opt("--environment", setting("BC_ENVIRONMENT"));
const BC_COMPANY = opt("--company", setting("BC_COMPANY"));
if (!BC_ENVIRONMENT || !BC_COMPANY) die("Set BC_ENVIRONMENT and BC_COMPANY in deploy/tenant.env (or pass --environment/--company).");

function azAccountTenant() {
  try {
    return execFileSync("az", ["account", "show", "--query", "tenantId", "-o", "tsv"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
  } catch {
    return undefined;
  }
}
let TENANT = opt("--tenant") ?? azAccountTenant();
if (!TENANT) {
  if (!DRY) die("No tenant: sign in with `az login --tenant <tenant-id>` or pass --tenant <tenant-id>.");
  TENANT = "<tenant-id>";
  warn("not signed in to az: using placeholders (live run needs `az login --tenant <tenant-id>`)");
}
const API_ROOT = `${BC_RESOURCE}/v2.0/${TENANT}/${encodeURIComponent(BC_ENVIRONMENT)}/api/v2.0`;

// ------------------------------------------------------------------ fixtures (the repo's own data set)
let fixturesModule;
try {
  const { tsImport } = await import("tsx/esm/api");
  fixturesModule = await tsImport(join(ROOT, "packages/collections-domain/src/fixtures/index.ts"), import.meta.url);
} catch (err) {
  die(`Could not load the fixtures with tsx (run \`npm install\` at the repository root first): ${err.message}`);
}
const { FIXTURE_AS_OF, HERO_CUSTOMER_NO, generateFixtures } = fixturesModule;
const fx = generateFixtures(FIXTURE_SEED, FIXTURE_AS_OF);
const hero = fx.customers.find((c) => c.number === HERO_CUSTOMER_NO);
if (!hero || !hero.name.startsWith("Fabrikam")) die(`Fixture hero ${HERO_CUSTOMER_NO} is not Fabrikam: the fixtures changed, review this script.`);

const SHIFT = daysBetween(FIXTURE_AS_OF, AS_OF);
const shift = (d) => (d ? addDays(d, SHIFT) : undefined);
const customerNo = (n) => `${PREFIX}${n}`;
const plan = {
  customers: fx.customers.map((c) => ({
    fixture: c,
    number: customerNo(c.number),
    body: { number: customerNo(c.number), displayName: c.name, city: c.city, creditLimit: c.creditLimit, salespersonCode: c.salesperson },
  })),
  invoices: fx.invoices.map((i) => ({
    fixture: i,
    ext: `${PREFIX}${i.number}`,
    customerNumber: customerNo(i.customerNumber),
    invoiceDate: shift(i.invoiceDate),
    dueDate: shift(i.dueDate),
    total: i.totalAmount,
    paidOn: shift(i.closedDate),
    paymentDocNo: `${PREFIX}PAY-${i.number.replace(/^SI-/, "")}`,
  })),
};
for (const c of plan.customers) if (c.number.length > 20) die(`Customer number ${c.number} is longer than 20 characters: shorten --prefix.`);
for (const i of plan.invoices) if (i.paymentDocNo.length > 20) die(`Document number ${i.paymentDocNo} is longer than 20 characters: shorten --prefix.`);

// ------------------------------------------------------------------ plan summary
const TODAY = new Date().toISOString().slice(0, 10);
const paidPlan = plan.invoices.filter((i) => i.paidOn);
const allDates = [...plan.invoices.map((i) => i.invoiceDate), ...paidPlan.map((i) => i.paidOn)].sort();
const minDate = allDates[0];
const maxDate = allDates.at(-1);
const futurePostings = allDates.filter((d) => d > TODAY).length;

log(`Business Central ${BC_ENVIRONMENT} / ${BC_COMPANY} (tenant ${TENANT})`);
console.error(`    as-of ${AS_OF} (fixture dates shifted ${SHIFT >= 0 ? "+" : ""}${SHIFT} days), prefix ${PREFIX}, steps ${[...STEPS].join(",")}`);
console.error(`    ${plan.customers.length} customers, ${plan.invoices.length} invoices (${plan.invoices.length - paidPlan.length} stay open, ${paidPlan.length} paid), ${paidPlan.length} payments`);
console.error(`    posting dates ${minDate} .. ${maxDate}${futurePostings ? `; ${futurePostings} of them are after today (${TODAY})` : ""}`);
{
  const rows = plan.customers.map((c) => {
    const inv = plan.invoices.filter((i) => i.customerNumber === c.number);
    const open = inv.filter((i) => !i.paidOn);
    const late = inv.filter((i) => i.paidOn).map((i) => daysBetween(i.dueDate, i.paidOn));
    const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
    return { c, inv: inv.length, open: open.length, openAmt: open.reduce((a, i) => a + i.total, 0), first: avg(late.slice(0, 3)), last: avg(late.slice(-3)) };
  });
  console.error("    customer        name                         inv open     open EUR  days late first3 -> last3");
  for (const r of rows) console.error(`    ${r.c.number.padEnd(15)} ${r.c.fixture.name.slice(0, 28).padEnd(28)} ${String(r.inv).padStart(3)} ${String(r.open).padStart(4)} ${eur(r.openAmt).padStart(12)}  ${String(r.first).padStart(6)} -> ${r.last}`);
  const big = plan.invoices.find((i) => i.customerNumber === customerNo(HERO_CUSTOMER_NO) && i.total === 48_500);
  if (big) console.error(`    hero: ${hero.name} ${customerNo(HERO_CUSTOMER_NO)}, ${big.ext} EUR 48,500 due ${big.dueDate}, ${daysBetween(big.dueDate, AS_OF)} days overdue on ${AS_OF}`);
}
if (futurePostings) warn(`${futurePostings} postings are dated after today. BC accepts them only if the allowed posting range (General Ledger Setup / User Setup "Allow Posting From/To") covers ${maxDate}.`);

// ------------------------------------------------------------------ auth
let tokenCache;
async function getToken() {
  if (tokenCache && tokenCache.expiresAt - Date.now() > 5 * 60_000) return tokenCache.token;
  let out;
  try {
    out = execFileSync("az", ["account", "get-access-token", "--resource", BC_RESOURCE, "--tenant", TENANT, "--query", "{e:expires_on,o:expiresOn,t:accessToken}", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const stderr = String(err.stderr ?? "").split("\n").filter((l) => !/eyJ/.test(l)).join("\n").trim();
    die(`az could not get a Business Central token:\n${stderr}\n\nIf the Azure CLI client is not allowed for Business Central in this tenant, see the device-code fallback in the header of deploy/bc-seed.mjs.`);
  }
  const j = JSON.parse(out);
  tokenCache = { token: j.t, expiresAt: j.e ? Number(j.e) * 1000 : Date.parse(j.o) };
  return tokenCache.token;
}

// ------------------------------------------------------------------ HTTP (live) or recorder (dry run)
class BcError extends Error {
  constructor(status, method, url, body) {
    const msg = body?.error?.message ?? (typeof body === "string" ? body : JSON.stringify(body));
    super(`${method} ${url.replace(API_ROOT, "")} -> ${status}: ${msg}`);
    this.status = status;
    this.code = body?.error?.code;
    this.bcMessage = msg ?? "";
  }
}

const recorded = new Map();
let dryIds = 0;
function record(method, url, body) {
  const path = url.replace(API_ROOT, "");
  const key = `${method.padEnd(5)} ${path.replace(/\(([^)]*)\)/g, "(…)").replace(/'[^']*'/g, "'…'")}`;
  const entry = recorded.get(key) ?? { count: 0, example: path, body };
  entry.count++;
  recorded.set(key, entry);
  if (VERBOSE) console.error(`[dry-run] ${method} ${path}${body ? ` ${JSON.stringify(body)}` : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function http(method, path, body, headers = {}) {
  const url = path.startsWith("http") ? path : `${companyRoot}/${path}`;
  if (DRY) {
    record(method, url, body);
    if (method === "GET") return /\?|s$|Lines$|Payments$/.test(path.split("?")[0].split("/").at(-1) ?? "") ? { value: [] } : {};
    if (method === "POST" && /Microsoft\.NAV\./.test(path)) return null;
    if (method === "POST") return { id: `<new-id-${++dryIds}>`, "@odata.etag": "W/\"<etag>\"", ...body };
    return { ...body };
  }
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${await getToken()}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if (attempt < 5) {
        await sleep(2 ** attempt * 1000);
        continue;
      }
      throw new Error(`${method} ${path}: network error ${err.message}`);
    }
    if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 6) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000 + Math.random() * 500;
      warn(`${res.status} from BC, retrying in ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    if (res.status === 401 && attempt === 0) {
      tokenCache = undefined;
      continue;
    }
    const text = await res.text();
    let parsed = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    if (!res.ok) throw new BcError(res.status, method, url, parsed);
    if (VERBOSE) console.error(`    ${method} ${path} -> ${res.status}`);
    return parsed;
  }
}
const get = (p) => http("GET", p);
const post = (p, b) => http("POST", p, b);
const patch = (p, b, etag) => http("PATCH", p, b, { "If-Match": etag ?? "*" });
async function listAll(path) {
  const out = [];
  let next = path;
  while (next) {
    const page = await get(next);
    out.push(...(page?.value ?? []));
    next = page?.["@odata.nextLink"];
  }
  return out;
}

/** Turns the BC errors we expect into instructions. */
function explain(err, context) {
  const m = String(err.bcMessage ?? err.message);
  if (/allowed posting|posting date is not within|Allow Posting/i.test(m))
    return `${context}: BC refused the posting date.\n  ${m}\n  Set "Allow Posting From/To" in General Ledger Setup (and in User Setup for your user, if set) to cover ${minDate} .. ${maxDate}, check the accounting periods exist for that range, then re-run (already posted documents are skipped).`;
  if (/posting group/i.test(m))
    return `${context}: a posting group is missing.\n  ${m}\n  API v2.0 cannot set posting groups. In BC open Customers, filter No. = ${PREFIX}*, and set Gen. Bus. Posting Group, VAT Bus. Posting Group and Customer Posting Group (copy them from an existing CRONUS customer, or apply a customer template), then re-run.`;
  if (/manual|No\. Series|number series/i.test(m))
    return `${context}: the number series does not accept manual numbers.\n  ${m}\n  Enable "Manual Nos." on the customer No. Series (Sales & Receivables Setup -> Customer Nos.), or pick a --prefix that fits it, then re-run.`;
  if (err.status === 401 || err.status === 403)
    return `${context}: not authorised (${err.status}).\n  ${m}\n  The signed-in user needs BC permissions in ${BC_COMPANY} (e.g. D365 BUS FULL ACCESS) and a BC licence.`;
  return `${context}: ${err.message}`;
}

// ------------------------------------------------------------------ main
let companyRoot = `${API_ROOT}/companies(<company-id>)`;
let demoPaymentTerms; // { id, code } applied to this script's customers (and to drafts created before it was set)
const stats = { customersCreated: 0, customersSkipped: 0, invoicesCreated: 0, invoicesResumed: 0, invoicesPosted: 0, invoicesSkipped: 0, paymentsCreated: 0, paymentsSkipped: 0, journalPosts: 0 };

try {
  await main();
} catch (err) {
  die(err instanceof BcError ? explain(err, "Request failed") : err.stack ?? String(err));
}

async function main() {
  // Company
  log(`Company '${BC_COMPANY}'`);
  const companies = await listAll(`${API_ROOT}/companies?$filter=name eq ${odataStr(BC_COMPANY)}&$select=id,name,displayName`);
  if (companies[0]) {
    companyRoot = `${API_ROOT}/companies(${companies[0].id})`;
    ok(`${companies[0].name} (${companies[0].id})`);
  } else if (!DRY) {
    const all = await listAll(`${API_ROOT}/companies?$select=name`);
    die(`Company '${BC_COMPANY}' not found in ${BC_ENVIRONMENT}. Companies: ${all.map((c) => c.name).join(", ") || "(none)"}`);
  }

  const info = (await listAll("companyInformation?$select=currencyCode,displayName"))[0];
  if (!DRY && info?.currencyCode && info.currencyCode !== "EUR") warn(`Company currency is ${info.currencyCode}, the fixtures are EUR. Amounts are posted in ${info.currencyCode} as if they were EUR.`);

  // Accounting periods cover the range?
  const periods = await listAll("accountingPeriods?$select=startingDate,closed&$orderby=startingDate");
  if (!DRY) {
    if (!periods.length) warn("No accounting periods returned; BC may refuse posting dates (create a fiscal year covering the range).");
    else {
      const first = periods[0].startingDate;
      const last = addDays(periods.at(-1).startingDate, 31);
      if (minDate < first || maxDate > last) warn(`Accounting periods run ${first} .. ~${last}; the seed needs ${minDate} .. ${maxDate}. Create the missing fiscal year first (Accounting Periods -> Create Year).`);
      else ok(`accounting periods cover ${minDate} .. ${maxDate}`);
    }
  }

  // ---------------------------------------------------------------- customers
  const customerIds = new Map();
  log(`Customers (${PREFIX}C-*)`);
  const existingCustomers = await listAll(`customers?$filter=startswith(number,${odataStr(`${PREFIX}C-`)})&$select=id,number,displayName`);
  for (const c of existingCustomers) customerIds.set(c.number, c.id);
  if (STEPS.has("customers")) {
    let withSalesperson = true;
    for (const c of plan.customers) {
      if (customerIds.has(c.number)) {
        stats.customersSkipped++;
        continue;
      }
      const body = { ...c.body };
      if (!withSalesperson) delete body.salespersonCode;
      let created;
      try {
        created = await post("customers", body);
      } catch (err) {
        if (withSalesperson && err instanceof BcError && /salesperson/i.test(err.bcMessage)) {
          warn(`salesperson code ${body.salespersonCode} not accepted in ${BC_COMPANY}; creating customers without salesperson`);
          withSalesperson = false;
          delete body.salespersonCode;
          created = await post("customers", body);
        } else throw err instanceof BcError ? new Error(explain(err, `Creating customer ${c.number}`)) : err;
      }
      customerIds.set(c.number, created.id);
      stats.customersCreated++;
    }
    ok(`${stats.customersCreated} created, ${stats.customersSkipped} already there`);
  }
  for (const c of plan.customers) if (!customerIds.has(c.number)) customerIds.set(c.number, DRY ? `<customer-id ${c.number}>` : undefined);
  if (STEPS.has("customers") || STEPS.has("invoices")) await ensurePostingGroups();

  // ---------------------------------------------------------------- invoices
  const invoiceState = new Map(); // ext -> posted invoice { id, number, status, totalAmountIncludingTax, remainingAmount }
  const select = "$select=id,number,externalDocumentNumber,status,customerNumber,invoiceDate,dueDate,totalAmountExcludingTax,totalAmountIncludingTax,remainingAmount";
  log(`Sales invoices (external document no. ${PREFIX}SI-*)`);
  const existingInvoices = await listAll(`salesInvoices?$filter=startswith(externalDocumentNumber,${odataStr(`${PREFIX}SI-`)})&${select}`);
  const byExt = new Map(existingInvoices.map((i) => [i.externalDocumentNumber, i]));

  if (STEPS.has("invoices")) {
    const line = await resolveLineTarget();
    let ratio = 1; // totalAmountIncludingTax / totalAmountExcludingTax, learnt from the first invoice (VAT)
    for (const p of plan.invoices) {
      let inv = byExt.get(p.ext);
      if (inv && inv.status !== "Draft") {
        invoiceState.set(p.ext, inv);
        stats.invoicesSkipped++;
        continue;
      }
      const customerId = customerIds.get(p.customerNumber);
      if (!customerId) die(`Customer ${p.customerNumber} does not exist in BC: run with --steps customers first.`);
      try {
        let lines = [];
        if (inv) {
          stats.invoicesResumed++;
          lines = await listAll(`salesInvoices(${inv.id})/salesInvoiceLines`);
          // A draft created before the customer had payment terms keeps none; give it ours.
          if (demoPaymentTerms && !DRY) await patch(`salesInvoices(${inv.id})`, { paymentTermsId: demoPaymentTerms.id }, inv["@odata.etag"]);
        } else {
          inv = await post("salesInvoices", { customerId, invoiceDate: p.invoiceDate, postingDate: p.invoiceDate, dueDate: p.dueDate, externalDocumentNumber: p.ext });
          stats.invoicesCreated++;
        }
        if (!lines.length) {
          await post(`salesInvoices(${inv.id})/salesInvoiceLines`, {
            ...line.body,
            description: `Demo services ${p.fixture.number}`,
            quantity: 1,
            unitPrice: round2(p.total / ratio),
          });
        }
        if (!DRY) {
          let cur = await get(`salesInvoices(${inv.id})?${select}`);
          if (Math.abs(cur.totalAmountIncludingTax - p.total) > 0.01 && cur.totalAmountExcludingTax > 0) {
            ratio = cur.totalAmountIncludingTax / cur.totalAmountExcludingTax;
            const [l] = await listAll(`salesInvoices(${inv.id})/salesInvoiceLines`);
            await patch(`salesInvoices(${inv.id})/salesInvoiceLines(${l.id})`, { unitPrice: round2(p.total / ratio) }, l["@odata.etag"]);
            cur = await get(`salesInvoices(${inv.id})?${select}`);
          }
          if (cur.invoiceDate !== p.invoiceDate) {
            await patch(`salesInvoices(${inv.id})`, { invoiceDate: p.invoiceDate, postingDate: p.invoiceDate, dueDate: p.dueDate }, cur["@odata.etag"]);
          } else if (cur.dueDate !== p.dueDate) {
            await patch(`salesInvoices(${inv.id})`, { dueDate: p.dueDate }, cur["@odata.etag"]);
          }
        } else {
          record("PATCH", `${companyRoot}/salesInvoices(${inv.id}) [only if BC recalculated the dates or VAT changed the total]`, { dueDate: p.dueDate });
        }
        await post(`salesInvoices(${inv.id})/Microsoft.NAV.post`);
        stats.invoicesPosted++;
        if (!DRY) {
          const posted = await get(`salesInvoices(${inv.id})?${select}`).catch(() => undefined) ??
            (await listAll(`salesInvoices?$filter=externalDocumentNumber eq ${odataStr(p.ext)}&${select}`))[0];
          if (!posted || posted.status === "Draft") die(`Invoice ${p.ext} did not post (status ${posted?.status ?? "unknown"}). Check it in BC, then re-run.`);
          invoiceState.set(p.ext, posted);
          if (stats.invoicesPosted % 25 === 0) ok(`${stats.invoicesPosted} posted so far`);
        } else invoiceState.set(p.ext, { id: inv.id, number: `<posted ${p.ext}>`, status: "Open", totalAmountIncludingTax: p.total, remainingAmount: p.total });
      } catch (err) {
        // Stop at the first failure: the draft (ours) stays and the next run resumes it.
        if (err instanceof BcError) die(explain(err, `Invoice ${p.ext} (${p.invoiceDate})`));
        throw err;
      }
    }
    ok(`${stats.invoicesCreated} created, ${stats.invoicesResumed} drafts resumed, ${stats.invoicesPosted} posted, ${stats.invoicesSkipped} already posted`);
    if (!DRY) {
      const off = plan.invoices.filter((p) => invoiceState.has(p.ext) && Math.abs(invoiceState.get(p.ext).totalAmountIncludingTax - p.total) > 0.05);
      if (off.length) warn(`${off.length} invoices differ from the fixture total by more than 5 cents (VAT rounding); ageing uses BC's amounts.`);
      const due = plan.invoices.filter((p) => invoiceState.has(p.ext) && invoiceState.get(p.ext).dueDate !== p.dueDate);
      if (due.length) warn(`${due.length} posted invoices have a different due date than planned (e.g. ${due[0].ext}: ${invoiceState.get(due[0].ext).dueDate} vs ${due[0].dueDate}); ageing would shift. Check whether BC overrides dueDate from payment terms.`);
    }
  } else {
    for (const [ext, inv] of byExt) if (inv.status !== "Draft") invoiceState.set(ext, inv);
  }

  // ---------------------------------------------------------------- payments
  if (!STEPS.has("payments")) return finish();
  log(`Customer payments (journal batch ${BATCH}, document no. ${PREFIX}PAY-*)`);
  const todo = [];
  for (const p of paidPlan) {
    const inv = invoiceState.get(p.ext);
    if (!inv) {
      if (!DRY) warn(`${p.ext} is not posted yet; its payment is skipped (run --steps invoices)`);
      continue;
    }
    if (!DRY && Number(inv.remainingAmount) === 0) {
      stats.paymentsSkipped++;
      continue;
    }
    todo.push({ p, inv });
  }
  if (!todo.length) {
    ok(`nothing to pay (${stats.paymentsSkipped} already paid)`);
    return finish();
  }

  const journal = await ensureJournal();
  const existingLines = await listAll(`customerPaymentJournals(${journal.id})/customerPayments?$select=id,documentNumber`);
  const queued = new Set(existingLines.map((l) => l.documentNumber));
  const pending = todo.filter(({ p }) => !queued.has(p.paymentDocNo));

  const addLine = ({ p, inv }) =>
    post(`customerPaymentJournals(${journal.id})/customerPayments`, {
      customerId: customerIds.get(p.customerNumber),
      postingDate: p.paidOn,
      documentNumber: p.paymentDocNo,
      amount: round2(PAYMENT_SIGN * Number(inv.remainingAmount || inv.totalAmountIncludingTax)),
      appliesToInvoiceId: inv.id,
      description: `Payment ${inv.number}`.slice(0, 100),
    }).then(() => stats.paymentsCreated++);
  const postJournal = async () => {
    try {
      await post(`customerPaymentJournals(${journal.id})/Microsoft.NAV.post`);
      stats.journalPosts++;
    } catch (err) {
      if (err instanceof BcError && (err.status === 404 || /action|not found|Microsoft\.NAV\.post/i.test(err.bcMessage)) && !/posting date|posting group/i.test(err.bcMessage))
        die(`This BC version does not expose posting for customerPaymentJournals via the API (${err.message}).\n  The lines are in journal batch ${BATCH}: open Cash Receipt Journals in BC, choose batch ${BATCH}, Post. Then re-run this script to verify.`);
      if (err instanceof BcError) die(explain(err, `Posting journal batch ${BATCH}`));
      throw err;
    }
  };
  const verifyPaid = async ({ p, inv }) => {
    if (DRY) return;
    const now = await get(`salesInvoices(${inv.id})?$select=id,number,status,remainingAmount`);
    if (Number(now.remainingAmount) !== 0)
      die(`After posting, ${p.ext} still has remaining amount ${now.remainingAmount} (status ${now.status}). The payment sign or application did not work as expected: check PAYMENT_SIGN in deploy/bc-seed.mjs and the posted entries for ${p.paymentDocNo} in BC before re-running.`);
  };

  // Canary: one payment, post, check it closed the invoice; then the rest in chunks.
  if (existingLines.length === 0 && pending.length) {
    const first = pending.shift();
    await addLine(first);
    await postJournal();
    await verifyPaid(first);
    ok(DRY ? `canary: post ${first.p.paymentDocNo} alone, then check ${first.p.ext} is closed before the rest` : `canary payment ${first.p.paymentDocNo} closed ${first.p.ext}`);
  }
  while (pending.length || queued.size) {
    const chunk = pending.splice(0, PAYMENT_CHUNK);
    for (const item of chunk) await addLine(item);
    await postJournal();
    queued.clear();
    if (!DRY && chunk.length) ok(`${stats.paymentsCreated} payments posted so far`);
    if (!pending.length) break;
  }
  if (!DRY) {
    const stillOpen = [];
    for (const { p, inv } of todo) {
      const now = await get(`salesInvoices(${inv.id})?$select=remainingAmount`);
      if (Number(now.remainingAmount) !== 0) stillOpen.push(p.ext);
    }
    if (stillOpen.length) warn(`${stillOpen.length} invoices that should be paid are still open: ${stillOpen.slice(0, 10).join(", ")}${stillOpen.length > 10 ? "…" : ""}`);
    else ok(`all ${todo.length} paid invoices are closed`);
  }
  return finish();
}

/**
 * API v2.0 cannot set posting groups, and customers created through it have none, so invoices
 * can't post. The standard "workflowCustomers" OData page exposes them: copy the most common
 * complete combination used by the company's own customers (or --posting-groups CUST,GENBUS,VATBUS)
 * onto this script's customers only (number starts with PREFIX + "C-").
 */
async function ensurePostingGroups() {
  const odata = `${API_ROOT.replace(/\/api\/v2\.0$/, "/ODataV4")}/Company(${odataStr(BC_COMPANY)})`;
  const fields = ["customerPostingGroup", "genBusPostingGroup", "vatBusPostingGroup"];
  const rows = await listAll(`${odata}/workflowCustomers?$select=id,number,paymentTermsCode,${fields.join(",")}`);
  const ours = rows.filter((r) => r.number.startsWith(`${PREFIX}C-`));
  // Payment terms are required for posting too. The fixtures set each invoice's due date, so the code
  // only has to exist: use --payment-terms, else a plain net-30 term (30D, single settlement).
  const terms = await listAll("paymentTerms?$select=id,code,dueDateCalculation");
  demoPaymentTerms = opt("--payment-terms")
    ? terms.find((t) => t.code === opt("--payment-terms"))
    : terms.find((t) => t.dueDateCalculation === "30D" && !/X/i.test(t.code)) ?? terms[0];
  if (!demoPaymentTerms && !DRY) die(`No payment terms in ${BC_COMPANY}; create one or pass --payment-terms <code>.`);
  const missing = ours.filter((r) => fields.some((f) => !r[f]) || !r.paymentTermsCode);
  if (!missing.length) {
    if (!DRY) ok(`posting groups and payment terms set on all ${ours.length} ${PREFIX}C-* customers`);
    return;
  }
  let groups = opt("--posting-groups")?.split(",");
  if (!groups) {
    const counts = new Map();
    for (const r of rows) {
      if (r.number.startsWith(PREFIX) || fields.some((f) => !r[f])) continue;
      const key = JSON.stringify(fields.map((f) => r[f]));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const best = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (!best) die(`No existing customer in ${BC_COMPANY} has complete posting groups to copy; pass --posting-groups CUST,GENBUS,VATBUS.`);
    groups = JSON.parse(best[0]);
  }
  for (const r of missing) {
    await patch(`${odata}/workflowCustomers(${r.id})`, { ...Object.fromEntries(fields.map((f, i) => [f, groups[i]])), paymentTermsCode: demoPaymentTerms?.code }, r["@odata.etag"]);
  }
  ok(`posting groups ${groups.join(" / ")} and payment terms ${demoPaymentTerms?.code} set on ${missing.length} ${PREFIX}C-* customers`);
}

async function resolveLineTarget() {
  if (opt("--account")) {
    const [a] = await listAll(`accounts?$filter=number eq ${odataStr(opt("--account"))}&$select=id,number,displayName,blocked`);
    if (!a && !DRY) die(`G/L account ${opt("--account")} not found.`);
    ok(`invoice lines use G/L account ${opt("--account")}`);
    return { body: { lineType: "Account", accountId: a?.id ?? "<account-id>" } };
  }
  if (opt("--item")) {
    const [i] = await listAll(`items?$filter=number eq ${odataStr(opt("--item"))}&$select=id,number,displayName,type,blocked`);
    if (!i && !DRY) die(`Item ${opt("--item")} not found.`);
    ok(`invoice lines use item ${opt("--item")}`);
    return { body: { lineType: "Item", itemId: i?.id ?? "<item-id>" } };
  }
  const items = await listAll("items?$filter=blocked eq false&$select=id,number,displayName,type&$top=200");
  const rank = (t) => (/^Service$/i.test(t) ? 0 : /Non/i.test(t) ? 1 : /^Inventory$/i.test(t) ? 2 : 3);
  const pick = items.filter((i) => rank(i.type) < 3).sort((a, b) => rank(a.type) - rank(b.type))[0];
  if (!pick) {
    if (DRY) return { body: { lineType: "Item", itemId: "<discovered service item id>" } };
    die("No unblocked item found. Pass --item <no> or --account <G/L no> (a sales/income account with posting groups).");
  }
  if (rank(pick.type) === 2) warn(`No Service/Non-Inventory item: using inventory item ${pick.number}. Posting fails if the company prevents negative inventory; pass --item or --account then.`);
  ok(`invoice lines use item ${pick.number} ${pick.displayName} (${pick.type})`);
  return { body: { lineType: "Item", itemId: pick.id } };
}

async function ensureJournal() {
  const [existing] = await listAll(`customerPaymentJournals?$filter=code eq ${odataStr(BATCH)}`);
  if (existing) {
    if (!String(existing.displayName ?? "").includes(OWNER_MARKER))
      die(`Payment journal batch ${BATCH} exists and was not created by this script (description '${existing.displayName}'). Pass --batch <another code>.`);
    if (!existing.balancingAccountId || existing.balancingAccountId === "00000000-0000-0000-0000-000000000000")
      die(`Journal batch ${BATCH} has no balancing account. Set one in BC (Cash Receipt Journal batch ${BATCH}) and re-run.`);
    ok(`batch ${BATCH} exists (ours)`);
    return existing;
  }
  let bal;
  if (opt("--bal-account")) {
    [bal] = await listAll(`accounts?$filter=number eq ${odataStr(opt("--bal-account"))}&$select=id,number,displayName`);
    if (!bal && !DRY) die(`G/L account ${opt("--bal-account")} not found.`);
  } else {
    const candidates = await listAll("accounts?$filter=category eq 'Assets' and accountType eq 'Posting' and blocked eq false and directPosting eq true&$select=id,number,displayName,subCategory");
    bal = candidates.find((a) => /bank|banco|cash|caja|tesorer/i.test(`${a.displayName} ${a.subCategory}`));
    if (!bal && !DRY)
      die(`Could not pick a bank/cash G/L account to balance the payments. Pass --bal-account <no>. Candidates: ${candidates.slice(0, 15).map((a) => `${a.number} ${a.displayName}`).join("; ") || "(none)"}`);
  }
  if (bal) ok(`balancing account ${bal.number} ${bal.displayName}`);
  return post("customerPaymentJournals", { code: BATCH, displayName: `Demo payments (${OWNER_MARKER})`, balancingAccountId: bal?.id ?? "<bank G/L account id>" });
}

function finish() {
  if (DRY) {
    console.error("");
    log(`Planned requests (dry run; nothing was sent). Base: ${API_ROOT}`);
    console.error("  count  request");
    for (const [key, e] of recorded) {
      console.error(`  ${String(e.count).padStart(5)}  ${key}`);
      if (e.body && !VERBOSE) console.error(`         e.g. ${JSON.stringify(e.body)}`);
    }
    console.error(`  Live runs add a few GETs per invoice to verify totals and status. A first run on an empty company creates everything above; re-runs skip what exists.`);
    return;
  }
  console.error("");
  log("Done");
  console.error(`  customers ${stats.customersCreated} created / ${stats.customersSkipped} skipped; invoices ${stats.invoicesPosted} posted (${stats.invoicesSkipped} already posted); payments ${stats.paymentsCreated} posted (${stats.paymentsSkipped} already paid), ${stats.journalPosts} journal posts`);
  console.error(`  Next: link BC to Dataverse and enable the virtual tables (docs/setup.md section 2), then deploy/dataverse.sh.`);
}
