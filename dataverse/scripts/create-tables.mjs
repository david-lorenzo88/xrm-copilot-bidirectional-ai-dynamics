#!/usr/bin/env node
/**
 * Creates the two local tables from ../tables/*.json via the Dataverse Web API
 * metadata endpoints, inside an (existing) unmanaged solution.
 *
 *   export DATAVERSE_URL=https://yourorg.crm4.dynamics.com
 *   export DATAVERSE_TOKEN=$(az account get-access-token --resource $DATAVERSE_URL --query accessToken -o tsv)
 *   node dataverse/scripts/create-tables.mjs --solution ContosoCollections [--dry-run]
 *
 * Untested against a live environment from this repo: run with --dry-run first and
 * read the payloads. Creating the tables in the maker portal is a fine alternative.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const solution = args[args.indexOf("--solution") + 1] ?? "ContosoCollections";
const url = process.env.DATAVERSE_URL?.replace(/\/+$/, "");
const token = process.env.DATAVERSE_TOKEN;
if (!dryRun && (!url || !token)) {
  console.error("Set DATAVERSE_URL and DATAVERSE_TOKEN (or pass --dry-run).");
  process.exit(1);
}

const LANG = 1033;
const label = (text) => ({ "@odata.type": "Microsoft.Dynamics.CRM.Label", LocalizedLabels: [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", Label: text, LanguageCode: LANG }] });
// Schema names may be lower case; the logical name is the lower-cased schema name.
const schema = (logical) => logical;
const required = { Value: "None", CanBeChanged: true, ManagedPropertyLogicalName: "canmodifyrequirementlevelsettings" };

function attribute(col) {
  const base = { SchemaName: schema(col.logicalName), DisplayName: label(col.displayName), Description: label(col.description ?? ""), RequiredLevel: required };
  switch (col.type) {
    case "String":
      return { "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata", ...base, MaxLength: col.maxLength, FormatName: { Value: "Text" } };
    case "Memo":
      return { "@odata.type": "Microsoft.Dynamics.CRM.MemoAttributeMetadata", ...base, MaxLength: col.maxLength, Format: "TextArea" };
    case "Integer":
      return { "@odata.type": "Microsoft.Dynamics.CRM.IntegerAttributeMetadata", ...base, MinValue: col.min, MaxValue: col.max, Format: "None" };
    case "Decimal":
      return { "@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata", ...base, Precision: col.precision, MinValue: col.min, MaxValue: col.max };
    case "DateOnly":
      return { "@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata", ...base, Format: "DateOnly", DateTimeBehavior: { Value: "DateOnly" } };
    default:
      throw new Error(`Unsupported column type ${col.type}`);
  }
}

function entity(def) {
  return {
    "@odata.type": "Microsoft.Dynamics.CRM.EntityMetadata",
    SchemaName: schema(def.logicalName),
    DisplayName: label(def.displayName),
    DisplayCollectionName: label(def.displayCollectionName),
    Description: label(def.description),
    OwnershipType: def.ownership,
    HasActivities: false,
    HasNotes: false,
    IsActivity: false,
    Attributes: [
      {
        "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
        SchemaName: schema(def.primaryName.logicalName),
        IsPrimaryName: true,
        MaxLength: def.primaryName.maxLength,
        FormatName: { Value: "Text" },
        DisplayName: label(def.primaryName.displayName),
        RequiredLevel: { ...required, Value: "ApplicationRequired" },
      },
    ],
  };
}

async function post(path, body) {
  if (dryRun) return console.log(`POST ${path}\n${JSON.stringify(body, null, 2)}\n`);
  const res = await fetch(`${url}/api/data/v9.2/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", "OData-Version": "4.0", "MSCRM.SolutionUniqueName": solution },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  console.log(`✓ ${path}`);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "tables");
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const def = JSON.parse(readFileSync(join(dir, file), "utf8"));
  console.log(`# ${def.logicalName}`);
  await post("EntityDefinitions", entity(def));
  for (const col of def.columns) await post(`EntityDefinitions(LogicalName='${def.logicalName}')/Attributes`, attribute(col));
}
console.log(dryRun ? "Dry run only." : "Done. Publish customizations, then add forms/views (see dataverse/README.md).");
