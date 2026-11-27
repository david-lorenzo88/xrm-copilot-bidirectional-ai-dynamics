#!/usr/bin/env node
/**
 * Binds the CollectionsBridge PCF on the "Collections customer" form (built by app-builder) to the
 * customer number cell, for all three form factors, with a fallback text control, the shape the
 * Power Apps form designer writes (see microsoft/power-platform-skills, pcf plugin, form XML fixtures).
 * Then publishes only that table. Idempotent.
 *
 *   node deploy/bind-pcf.mjs [--dry-run]
 *
 * gptId comes from the app's default-agent environment variable (set in the app designer's Agents
 * panel), or --gpt-id <id>. Requires `az` signed in to the tenant (Dataverse token).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry-run");
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, "deploy", "tenant.env"), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const ORG = (env.DATAVERSE_URL ?? "").replace(/\/$/, "");
const ENTITY = "dyn365bc_customer_v2_0";
const FORM_NAME = arg("--form", "Collections customer");
const FIELD = "dyn365bc_number";
const CONTROL = `${env.PUBLISHER_PREFIX ?? "ppn"}_Contoso.CollectionsBridge`;
const CUSTOM_CONTROL_CLASSID = "{F9A8A302-114E-466A-B582-6771B2AE0D92}";
const TEXT_CONTROL_ID = "{4273EDBD-AC1D-40d3-9FB2-095C621B552D}";
const DEFAULT_AGENT_ENV_VAR = "ppn_M365CopilotDefaultAgent_collectionsworkspace";

const ok = (m) => console.log(` ok ${m}`);
const die = (m) => {
  console.error(`ERROR ${m}`);
  process.exit(1);
};
const token = execFileSync("az", ["account", "get-access-token", "--resource", ORG, "--query", "accessToken", "-o", "tsv"], { encoding: "utf8" }).trim();
async function api(method, p, body) {
  const res = await fetch(`${ORG}/api/data/v9.2/${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json", "If-Match": "*" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) die(`${method} ${p} -> ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}
const q = (s) => encodeURIComponent(s);

// gptId: explicit, else the app's default-agent environment variable
let gptId = arg("--gpt-id");
if (!gptId) {
  const v = await api("GET", `environmentvariablevalues?$select=value&$filter=${q(`schemaname eq '${DEFAULT_AGENT_ENV_VAR}'`)}`);
  gptId = v?.value?.[0]?.value;
  if (!gptId) die(`no --gpt-id and ${DEFAULT_AGENT_ENV_VAR} has no value: set the default agent in the app designer (Agents panel)`);
}
ok(`agent ${gptId}`);

const forms = await api("GET", `systemforms?$select=formid,name,formxml&$filter=${q(`objecttypecode eq '${ENTITY}' and name eq '${FORM_NAME}' and type eq 2`)}`);
const form = forms.value[0];
if (!form) die(`form '${FORM_NAME}' on ${ENTITY} not found (build the app with app-builder first)`);
let xml = form.formxml;

// The editable "New customer" form, opened pre-filled when Copilot proposes a new customer (optional).
const newCustomerForm = (await api("GET", `systemforms?$select=formid&$filter=${q(`objecttypecode eq '${ENTITY}' and name eq 'New customer' and type eq 2`)}`)).value[0];
if (newCustomerForm) ok(`New customer form ${newCustomerForm.formid}`);

// 1. The cell control for the customer number: give it the custom-control class id and a uniqueid.
const cellRe = new RegExp(`<control\\b[^>]*\\bdatafieldname="${FIELD}"[^>]*/>`);
const cell = xml.match(cellRe)?.[0];
if (!cell) die(`no ${FIELD} cell on form '${FORM_NAME}'`);
const uniqueid = cell.match(/uniqueid="(\{[^"]+\})"/)?.[1] ?? `{${crypto.randomUUID()}}`;
let newCell = cell.replace(/\bclassid="\{[^"]+\}"/, `classid="${CUSTOM_CONTROL_CLASSID}"`);
if (!/uniqueid=/.test(newCell)) newCell = newCell.replace(/\/>$/, ` uniqueid="${uniqueid}" />`);
xml = xml.replace(cell, newCell);

// 2. Its control description: fallback text control + the PCF on all three form factors.
// Fields Copilot may fill in (unsaved; the user saves the form, which writes to Business Central).
const EDITABLE = { creditLimit: "dyn365bc_creditlimit", blocked: "dyn365bc_blocked" };
const params = [
  `<customerNumber>${FIELD}</customerNumber>`,
  ...Object.entries(EDITABLE).filter(([, col]) => new RegExp(`datafieldname="${col}"`).test(xml)).map(([prop, col]) => `<${prop}>${col}</${prop}>`),
  `<gptId static="true" type="SingleLine.Text">${gptId}</gptId>`,
  `<autoOpenPanel static="true" type="TwoOptions">true</autoOpenPanel>`,
  `<viewName static="true" type="SingleLine.Text">Overdue invoices</viewName>`,
  // Demo date from deploy/tenant.env (DEMO_AS_OF); empty = the real date.
  ...(env.DEMO_AS_OF ? [`<asOfDate static="true" type="SingleLine.Text">${env.DEMO_AS_OF}</asOfDate>`] : []),
  ...(newCustomerForm ? [`<newCustomerFormId static="true" type="SingleLine.Text">${newCustomerForm.formid}</newCustomerFormId>`] : []),
  // Demo: the "Share context with Copilot" switch (SHOW_CONTEXT_SWITCH=true in tenant.env).
  ...(env.SHOW_CONTEXT_SWITCH === "true" ? [`<showContextSwitch static="true" type="TwoOptions">true</showContextSwitch>`] : []),
  // Same scope as the MCP server (CUSTOMER_NUMBER_PREFIX), so the in-app dashboard matches the widget.
  ...(env.CUSTOMER_NUMBER_PREFIX ? [`<customerNumberPrefix static="true" type="SingleLine.Text">${env.CUSTOMER_NUMBER_PREFIX}</customerNumberPrefix>`] : []),
].join("");
const description =
  `<controlDescription forControl="${uniqueid}">` +
  `<customControl id="${TEXT_CONTROL_ID}"><parameters><datafieldname>${FIELD}</datafieldname></parameters></customControl>` +
  [0, 1, 2].map((f) => `<customControl formFactor="${f}" name="${CONTROL}"><parameters>${params}</parameters></customControl>`).join("") +
  `</controlDescription>`;
const existingDesc = new RegExp(`<controlDescription forControl="${uniqueid.replace(/[{}]/g, "\\$&")}"[\\s\\S]*?</controlDescription>`, "i");
if (existingDesc.test(xml)) xml = xml.replace(existingDesc, description);
else if (xml.includes("<controlDescriptions>")) xml = xml.replace("<controlDescriptions>", `<controlDescriptions>${description}`);
else if (xml.includes("<controlDescriptions />")) xml = xml.replace("<controlDescriptions />", `<controlDescriptions>${description}</controlDescriptions>`);
else xml = xml.replace(/<\/form>\s*$/, `<controlDescriptions>${description}</controlDescriptions></form>`);

// 2b. Unlock the editable cells (app-builder's readOnly can't be cleared by a rebuild).
for (const col of Object.values(EDITABLE)) {
  xml = xml.replace(new RegExp(`<control\\b[^>]*\\bdatafieldname="${col}"[^>]*/>`, "g"), (c) => c.replace(/\s+disabled="true"/, ""));
}

// 3. Hide the cell label: the control renders its own header.
xml = xml.replace(new RegExp(`(<cell\\b)([^>]*>\\s*<labels>[\\s\\S]*?</labels>\\s*${newCell.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`), (m, a, b) => (/showlabel=/.test(b) ? m : `${a} showlabel="false"${b}`));

if (xml === form.formxml) {
  ok("already bound");
} else if (DRY) {
  console.log(`[dry-run] PATCH systemforms(${form.formid}) formxml (cell ${uniqueid} -> ${CONTROL})`);
} else {
  await api("PATCH", `systemforms(${form.formid})`, { formxml: xml });
  ok(`bound ${CONTROL} to ${FIELD} on '${FORM_NAME}' (cell ${uniqueid})`);
}
if (!DRY) {
  await api("POST", "PublishXml", { ParameterXml: `<importexportxml><entities><entity>${ENTITY}</entity></entities></importexportxml>` });
  const check = await api("GET", `systemforms(${form.formid})?$select=formxml`);
  const bound = check.formxml.includes(`name="${CONTROL}"`) && check.formxml.includes(`forControl="${uniqueid}"`);
  bound ? ok(`published ${ENTITY}; binding present after publish`) : die("binding not found after publish");
}
