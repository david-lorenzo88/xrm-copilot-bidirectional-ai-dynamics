/**
 * Dataverse logical names: the single place to change them.
 *
 * The Business Central virtual tables use the `dyn365bc_` prefix plus the BC API
 * entity name and version. VERIFY: column names below follow the BC API v2.0
 * field names lower-cased with the `dyn365bc_` prefix. Confirm each one in your
 * environment (Power Apps → Tables → <table> → Columns) after enabling the
 * virtual tables; entity set names can also differ (check
 * /api/data/v9.2/EntityDefinitions(LogicalName='…')?$select=EntitySetName).
 */
export const BC_TABLES = {
  customer: {
    logicalName: "dyn365bc_customer_v2_0",
    entitySet: "dyn365bc_customer_v2_0s",
    columns: {
      id: "dyn365bc_customer_v2_0id",
      number: "dyn365bc_number",
      name: "dyn365bc_displayname",
      currency: "dyn365bc_currencycode",
      creditLimit: "dyn365bc_creditlimit",
      balanceDue: "dyn365bc_balancedue",
      salesperson: "dyn365bc_salespersoncode",
      city: "dyn365bc_city",
    },
  },
  salesInvoice: {
    logicalName: "dyn365bc_salesinvoice_v2_0",
    entitySet: "dyn365bc_salesinvoice_v2_0s",
    columns: {
      id: "dyn365bc_salesinvoice_v2_0id",
      number: "dyn365bc_number",
      customerId: "dyn365bc_customerid",
      customerNumber: "dyn365bc_customernumber",
      customerName: "dyn365bc_customername",
      invoiceDate: "dyn365bc_invoicedate",
      dueDate: "dyn365bc_duedate",
      totalAmount: "dyn365bc_totalamountincludingtax",
      remainingAmount: "dyn365bc_remainingamount",
      currency: "dyn365bc_currencycode",
      status: "dyn365bc_status",
    },
  },
  /**
   * Payment history. The standard BC API v2.0 has no customer ledger entries
   * endpoint, so this points at the custom API page in /bc (publisher "contoso",
   * group "collections", entity "customerLedgerEntry", version v1.0).
   * VERIFY: the virtual table name the BC catalog generates for a custom API page.
   */
  customerLedgerEntry: {
    logicalName: "dyn365bc_customerledgerentry_v1_0",
    entitySet: "dyn365bc_customerledgerentry_v1_0s",
    columns: {
      id: "dyn365bc_customerledgerentry_v1_0id",
      documentNo: "dyn365bc_documentnumber",
      customerNumber: "dyn365bc_customernumber",
      dueDate: "dyn365bc_duedate",
      closedAtDate: "dyn365bc_closedatdate",
      open: "dyn365bc_open",
    },
  },
} as const;

/** Local (native) Dataverse tables owned by this solution. Never written to BC. */
export const LOCAL_TABLES = {
  dashboard: {
    logicalName: "contoso_collectiondashboard",
    entitySet: "contoso_collectiondashboards",
    columns: {
      id: "contoso_collectiondashboardid",
      name: "contoso_name",
      specJson: "contoso_specjson",
      version: "contoso_version",
      customerNo: "contoso_customerno",
      /** Lookup to the customer virtual table. VERIFY: lookup navigation property name. */
      customer: "contoso_customer",
    },
  },
  action: {
    logicalName: "contoso_collectionaction",
    entitySet: "contoso_collectionactions",
    columns: {
      id: "contoso_collectionactionid",
      name: "contoso_name",
      actionId: "contoso_actionid",
      customerNo: "contoso_customerno",
      payloadJson: "contoso_payloadjson",
      note: "contoso_note",
      promiseDate: "contoso_promisedate",
      promisedAmount: "contoso_promisedamount",
      outcome: "contoso_outcome",
      source: "contoso_source",
    },
  },
} as const;

/** Entities that agent-supplied FetchXML may target. Feed this to the contract's action guard. */
export const WORKLIST_ENTITIES = [BC_TABLES.salesInvoice.logicalName] as const;
