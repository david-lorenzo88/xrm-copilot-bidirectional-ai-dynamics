# Business Central extension (optional)

`CollectionsLedgerApi` adds one read-only API page, `contoso/collections/v1.0/customerLedgerEntries`,
because the standard API v2.0 has no customer ledger endpoint with **Closed at Date**. Payment-behaviour
analysis needs that date to know when an invoice was actually paid.

- Not compiled in this repository (no AL toolchain here). Open the folder in VS Code with the AL
  Language extension, download symbols from your sandbox, and publish.
- After publishing, enable the API as a virtual table in Dataverse (Business Central Virtual Table
  catalog). **VERIFY** the generated logical name. The code expects `dyn365bc_customerledgerentry_v1_0`
  with columns `dyn365bc_documentnumber`, `dyn365bc_closedatdate`, `dyn365bc_open`,
  `dyn365bc_customernumber`, `dyn365bc_duedate`. Change `packages/collections-domain/src/schema.ts`
  if yours differ.
- Without it, the MCP server still works: it logs a warning and analyses open invoices only.

Seed data: `npm run fixtures:export` writes the demo customers/invoices (`packages/collections-domain/out/fixtures/*.json`, git-ignored) with
the same patterns as the mock (Fabrikam worsening with a 48,500 invoice 100 days overdue, Northwind
chronic, Tailspin improving). Load them into a sandbox with a configuration package or the BC API,
then adjust dates so "today" lines up (the fixtures assume 27 Nov 2026).
