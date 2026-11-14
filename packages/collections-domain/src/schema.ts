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
    entitySet: "dyn365bc_customers_v2_0", // verified in the demo tenant
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
    entitySet: "dyn365bc_salesinvoices_v2_0", // verified in the demo tenant
    columns: {
      id: "dyn365bc_salesinvoice_v2_0id",
      number: "dyn365bc_number",
      /** Lookup to the customer virtual table (dyn365bc_customer_customerid), read as its _value column. */
      customerId: "_dyn365bc_customer_customerid_value",
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
   * endpoint, so this points at the custom API page in /bc (API publisher "ppn",
   * group "collections", entity "customerLedgerEntry", version v1.0). The BC catalog
   * names custom APIs <entity>_<publisher>_<group>_<version> (verified in the demo tenant).
   */
  customerLedgerEntry: {
    logicalName: "dyn365bc_customerledgerentry_ppn_collections_v1_0",
    entitySet: "dyn365bc_customerledgerentries_ppn_collections_v1_0",
    columns: {
      id: "dyn365bc_customerledgerentry_ppn_collections_v1_0id",
      documentNo: "dyn365bc_documentnumber",
      customerNumber: "dyn365bc_customernumber",
      dueDate: "dyn365bc_duedate",
      closedAtDate: "dyn365bc_closedatdate",
      open: "dyn365bc_open",
    },
  },
} as const;

/** BC sales invoice status "Open" (posted, not fully paid) as the virtual table's choice value. Verified in the demo tenant. */
export const BC_INVOICE_STATUS_OPEN = 200000003;

/** Local (native) Dataverse tables owned by this solution. Never written to BC. */
export const LOCAL_TABLES = {
  dashboard: {
    logicalName: "ppn_collectiondashboard",
    entitySet: "ppn_collectiondashboards",
    columns: {
      id: "ppn_collectiondashboardid",
      name: "ppn_name",
      specJson: "ppn_specjson",
      version: "ppn_version",
      customerNo: "ppn_customerno",
      /** Lookup to the customer virtual table. VERIFY: lookup navigation property name. */
      customer: "ppn_customer",
    },
  },
  action: {
    logicalName: "ppn_collectionaction",
    entitySet: "ppn_collectionactions",
    columns: {
      id: "ppn_collectionactionid",
      name: "ppn_name",
      actionId: "ppn_actionid",
      customerNo: "ppn_customerno",
      payloadJson: "ppn_payloadjson",
      note: "ppn_note",
      promiseDate: "ppn_promisedate",
      promisedAmount: "ppn_promisedamount",
      outcome: "ppn_outcome",
      source: "ppn_source",
    },
  },
} as const;

/** Entities that agent-supplied FetchXML may target. Feed this to the contract's action guard. */
export const WORKLIST_ENTITIES = [BC_TABLES.salesInvoice.logicalName] as const;
