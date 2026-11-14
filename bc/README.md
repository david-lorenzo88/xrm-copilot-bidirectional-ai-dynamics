# Business Central extension (optional)

`CollectionsLedgerApi` adds one read-only API page, `ppn/collections/v1.0/customerLedgerEntries`,
because the standard API v2.0 has no customer ledger endpoint with **Closed at Date**. Payment-behaviour
analysis needs that date to know when an invoice was actually paid.

- Build and install: `bash deploy/bc-extension.sh` (AL CLI from NuGet, symbols from Microsoft's public
  symbol feeds, install as a per-tenant extension through the automation API, then the Dataverse virtual
  table). Targets BC 29 (runtime 16.0). Bump `version` in `app.json` before re-publishing.
- Installed in the demo tenant as *Collections Ledger API* 1.0.0.0 by Power Platform Ninja. The BC catalog
  names custom APIs `<entity>_<publisher>_<group>_<version>`, so the virtual table is
  `dyn365bc_customerledgerentry_ppn_collections_v1_0` (entity set `dyn365bc_customerledgerentries_ppn_collections_v1_0`).
- Without it, the MCP server still works: it logs a warning and analyses open invoices only.

Seed data: `npm run fixtures:export` writes the demo customers/invoices (`packages/collections-domain/out/fixtures/*.json`, git-ignored) with
the same patterns as the mock (Fabrikam worsening with a 48,500 invoice 100 days overdue, Northwind
chronic, Tailspin improving). Load them into a sandbox with a configuration package or the BC API,
then adjust dates so "today" lines up (the fixtures assume 27 Nov 2026).
