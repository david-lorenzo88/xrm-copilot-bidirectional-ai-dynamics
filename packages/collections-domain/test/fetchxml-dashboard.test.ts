import { describe, expect, it } from "vitest";
import { createDashboardSpec, fetchXmlEntityName } from "@collections/contract";
import {
  BC_TABLES,
  WORKLIST_ENTITIES,
  buildDashboardData,
  buildOpenInvoicesFetchXml,
  buildOverdueInvoicesFetchXml,
  buildPrioritizedWorklistFetchXml,
  escapeXml,
} from "../src";
import { FIXTURE_AS_OF, createRandom, fixtures, generateFixtures } from "../src/fixtures";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const now = new Date("2026-11-27T09:00:00Z");

describe("FetchXML builders", () => {
  it("escapes XML", () => {
    expect(escapeXml(`a<b>&'"`)).toBe("a&lt;b&gt;&amp;&apos;&quot;");
  });

  it("builds the overdue view filter", () => {
    const xml = buildOverdueInvoicesFetchXml({ asOf: FIXTURE_AS_OF, customerNo: "C-1001", top: 50 });
    expect(xml).toMatch(/^<fetch top="50"><entity name="dyn365bc_salesinvoice_v2_0">/);
    expect(xml).toContain('operator="on-or-before" value="2026-11-26"');
    expect(xml).toContain('<condition attribute="dyn365bc_customernumber" operator="eq" value="C-1001"/>');
    expect(fetchXmlEntityName(xml)).toBe(WORKLIST_ENTITIES[0]);
    expect(buildOverdueInvoicesFetchXml({ asOf: FIXTURE_AS_OF })).not.toContain(`attribute="dyn365bc_customernumber" operator`);
  });

  it("builds the open-invoice query for the dashboard", () => {
    expect(buildOpenInvoicesFetchXml(["C-1001", "C&2"])).toContain("<value>C&amp;2</value>");
    expect(buildOpenInvoicesFetchXml()).not.toContain('operator="in"');
  });

  it("builds the prioritised worklist", () => {
    const xml = buildPrioritizedWorklistFetchXml([ID]);
    expect(xml).toContain(`<condition attribute="${BC_TABLES.salesInvoice.columns.id}" operator="in"><value>${ID}</value></condition>`);
    expect(xml).toContain('descending="true"');
    expect(() => buildPrioritizedWorklistFetchXml([])).toThrow(RangeError);
  });
});

describe("dashboard data", () => {
  const { customers, invoices } = fixtures;

  it("builds overdue by customer × aging bucket", () => {
    const spec = createDashboardSpec({ id: ID, now });
    const data = buildDashboardData(spec, customers, invoices, FIXTURE_AS_OF);
    expect(data.columns.map((c) => c.key)).toEqual(["current", "1-30", "31-60", "61-90", "90+"]);
    expect(data.rows[0]!.label).toBe("Fabrikam, Inc.");
    expect(data.rows[0]!.cells["90+"]!.overdueAmount).toBe(48_500);
    expect(data.rows.every((r) => r.total.overdueAmount > 0)).toBe(true);
    const sumRows = data.rows.reduce((s, r) => s + r.total.overdueAmount, 0);
    expect(Math.round(sumRows)).toBe(Math.round(data.totals.overdueAmount));
    expect(data.totals.byColumn["current"]!.overdueAmount).toBe(0);
    expect(data.currency).toBe("EUR");
  });

  it("applies bucket, amount, customer and topN filters", () => {
    const spec = createDashboardSpec({ id: ID, now, filters: { bucketIds: ["61-90", "90+"], minAmount: 5_000, topN: 2 } });
    const data = buildDashboardData(spec, customers, invoices, FIXTURE_AS_OF);
    expect(data.columns.map((c) => c.key)).toEqual(["61-90", "90+"]);
    expect(data.rows.length).toBeLessThanOrEqual(2);
    const only = buildDashboardData(createDashboardSpec({ id: ID, now, filters: { customerNos: ["C-1002"], minDaysOverdue: 1, currency: "EUR" } }), customers, invoices, FIXTURE_AS_OF);
    expect(only.rows.map((r) => r.key)).toEqual(["C-1002"]);
    const none = buildDashboardData(createDashboardSpec({ id: ID, now, filters: { currency: "USD" } }), customers, invoices, FIXTURE_AS_OF);
    expect(none.rows).toEqual([]);
    expect(none.currency).toBe("USD");
  });

  it("supports other dimensions and measures", () => {
    const bySales = buildDashboardData(createDashboardSpec({ id: ID, now, groupBy: ["salesperson", "agingBucket"], measures: ["invoiceCount"] }), customers, invoices, FIXTURE_AS_OF);
    expect(bySales.rows.map((r) => r.key).sort()).toEqual(["JR", "KH", "PS"]);
    expect(bySales.measure).toBe("invoiceCount");
    const byCurrency = buildDashboardData(createDashboardSpec({ id: ID, now, groupBy: ["agingBucket", "currency"], measures: ["openAmount"] }), customers, invoices, FIXTURE_AS_OF);
    expect(byCurrency.columns).toEqual([{ key: "EUR", label: "EUR" }]);
    expect(byCurrency.rows.map((r) => r.key)).toContain("current");
    const customerCols = buildDashboardData(createDashboardSpec({ id: ID, now, groupBy: ["agingBucket", "customer"] }), customers, invoices, FIXTURE_AS_OF);
    expect(customerCols.columns[0]!.key).toBe("C-1001");
    const unknownSp = buildDashboardData(createDashboardSpec({ id: ID, now, groupBy: ["salesperson", "currency"] }), [], invoices, FIXTURE_AS_OF);
    expect(unknownSp.rows.map((r) => r.key)).toEqual(["(none)"]);
  });
});

describe("fixtures", () => {
  it("are deterministic and shaped for the demo", () => {
    expect(fixtures.customers).toHaveLength(25);
    expect(fixtures.invoices.length).toBeGreaterThanOrEqual(290);
    expect(generateFixtures().invoices[42]).toEqual(fixtures.invoices[42]);
    expect(generateFixtures(1).invoices[0]!.id).not.toBe(fixtures.invoices[0]!.id);
    const big = fixtures.invoices.find((i) => i.totalAmount === 48_500)!;
    expect(big).toMatchObject({ customerName: "Fabrikam, Inc.", dueDate: "2026-08-19", status: "Open" });
    expect(new Set(fixtures.invoices.map((i) => i.id)).size).toBe(fixtures.invoices.length);
    expect(fixtures.invoices.filter((i) => i.status === "Paid").every((i) => i.closedDate && i.remainingAmount === 0)).toBe(true);
  });

  it("generate GUID-shaped ids", () => {
    const r = createRandom(7);
    expect(r.guid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(r.int(3, 3)).toBe(3);
  });
});
