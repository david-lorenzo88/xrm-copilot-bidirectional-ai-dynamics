# Dataverse solution: `ContosoCollections`

This folder describes the unmanaged solution and has scripts to build it. It does **not** contain a
hand-written unpacked solution. Solution XML (forms, sitemap, app module) is brittle to write by hand,
so the honest workflow is: create the pieces once in the maker portal (or with the scripts below),
then `pac solution clone` them into source control and pack and import from there.

| Path | What it is |
|---|---|
| `tables/*.json` | Definitions of the two local tables (columns, types, notes) |
| `scripts/create-tables.mjs` | Creates those tables via the Web API metadata endpoints (`--dry-run` prints payloads). Untested against a live org; the maker portal is a fine alternative |
| `scripts/solution.sh` / `solution.ps1` | `clone`, `init`, `sync`, `build`, `import`, `push` wrappers around `pac` and `dotnet build` |
| `solution/ContosoCollections/` | Created by `solution.sh clone` (or `init`); `bin/` and `obj/` are git-ignored |

## Publisher

- Prefix **`ppn`**. If the environment already has a publisher with this prefix, reuse it (same unique name) instead of creating a second one. All local names in this repository use it.

## Components

### 1. Business Central virtual tables (referenced, not owned)

Enable them in the environment (see `docs/setup.md` §2). They appear as `dyn365bc_*` tables. Do **not**
add them to this solution. They belong to the Business Central Virtual Table solution.

| Table | Used for |
|---|---|
| `dyn365bc_customer_v2_0` | Customer form (hosts the PCF), context, risk |
| `dyn365bc_salesinvoice_v2_0` | Overdue invoices view, side panes, aging |
| `dyn365bc_customerledgerentry_v1_0` (custom API page, see `/bc`) | Paid dates for payment behavior |

The logical/column names the code uses are in one place: `packages/collections-domain/src/schema.ts`.

### 2. Local tables (owned)

- **`ppn_collectiondashboard`**: the shared dashboard state (`ppn_specjson`, `ppn_version`, `ppn_customerno`, optional `ppn_customer` lookup). See `tables/ppn_collectiondashboard.json`.
- **`ppn_collectionaction`**: audit of every agent action the app handled, rejected or failed, plus confirmed follow-ups. See `tables/ppn_collectionaction.json`.

### 3. PCF control `ppn_Contoso.CollectionsBridge`

Added with `pac solution add-reference` (the scripts do it). Place it on the **Customer main form**
(`dyn365bc_customer_v2_0`), bound to the customer number column, in a full-width one-column section
near the top. Properties:

| Property | Value |
|---|---|
| `customerNumber` (bound) | `dyn365bc_number` |
| `gptId` | The Collections agent id (see `docs/setup.md` §6, read it with `Xrm.Copilot.getCurrentAgent()`) |
| `autoOpenPanel` | Yes |
| `viewName` | `Overdue invoices` |
| `analyzePrompt` | (optional) your own wording |
| `worklistViewId` | (optional) GUID of the *Chase today* view. If set, ShowWorklist navigates there; if empty, the control renders the ranked list itself |

### 4. Views on `dyn365bc_salesinvoice_v2_0`

| View | Filter | Sort | Columns |
|---|---|---|---|
| **Overdue invoices** (default for the app) | Remaining amount > 0 **and** Due date older than today | Due date ascending | Number, Customer name, Due date, Remaining amount, Currency |
| **Chase today** | Same filter | Remaining amount descending | Same + Customer number |

The PCF reports the *Overdue invoices* filter to Copilot as FetchXML (built by
`buildOverdueInvoicesFetchXml`). Virtual tables have limited aggregate support, so there are no
aggregate views; aging is computed in code.

Add an **Overdue invoices** subgrid to the Customer main form (related records: invoices of this customer).

### 5. Forms

- **Customer (main)**: header (number, name, balance due, credit limit), CollectionsBridge section, Overdue invoices subgrid.
- **Sales invoice (main)**: number, customer, invoice/due date, total, remaining, status. This is what side panes open.
- **Collection dashboard (main)**: name, version, customer number, spec JSON (read-only for most users).
- **Collection action (main)**: read-only audit form.

### 6. Model-driven app **Collections Workspace** (`ppn_CollectionsWorkspace`)

Sitemap:

```
Collections
├── Customers            → dyn365bc_customer_v2_0 (Active customers)
├── Overdue invoices     → dyn365bc_salesinvoice_v2_0 (Overdue invoices view)
└── Insights
    ├── Dashboards       → ppn_collectiondashboard
    └── Follow-ups & audit → ppn_collectionaction
```

App settings: **Copilot → Microsoft 365 Copilot** on, and set the **default agent** to *Collections*
(see `docs/setup.md` §8). Starter prompts are not shown when a default agent is set.

### 7. Security role **Collections Agent User**

| Table | Privileges |
|---|---|
| `dyn365bc_customer_v2_0`, `dyn365bc_salesinvoice_v2_0`, ledger entries | Read (Organization). The virtual table provider enforces BC permissions too |
| `ppn_collectiondashboard` | Create, Read, Write (User), Append/Append To |
| `ppn_collectionaction` | Create, Read (User); no Write/Delete (audit) |
| App | Collections Workspace |

The MCP server reads and writes **as the user** (on-behalf-of), so this role is also the agent's ceiling.

## Typical flow

```bash
pac auth create --environment https://yourorg.crm4.dynamics.com
node dataverse/scripts/create-tables.mjs --solution ContosoCollections   # or create in the maker portal
# build the views, forms, app and role in the maker portal, inside the ContosoCollections solution
dataverse/scripts/solution.sh clone     # source-control it
dataverse/scripts/solution.sh build     # PCF (production) + solution zip
dataverse/scripts/solution.sh import    # into test/prod
```
