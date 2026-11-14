import { describe, expect, it } from "vitest";
import { createDashboardSpec } from "@collections/contract";
import { BC_TABLES, FORMATTED_VALUE as FORMATTED, LOCAL_TABLES } from "@collections/domain";
import { DataverseClient, DataverseError, odataString } from "../src/repository/dataverse-client";
import { DataverseRepository } from "../src/repository/dataverse";

const C = BC_TABLES.customer.columns;
const I = BC_TABLES.salesInvoice.columns;
const L = BC_TABLES.customerLedgerEntry.columns;
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

type Route = (url: URL, init: RequestInit) => { status?: number; body?: unknown } | undefined;

function fakeDataverse(route: Route) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const r = route(url, init) ?? { status: 404 };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
  const client = new DataverseClient({ url: "https://contoso.crm4.dynamics.com/", getToken: async () => "dv-token", fetchImpl });
  return { repo: new DataverseRepository(client), calls };
}

describe("DataverseRepository", () => {
  it("maps BC virtual-table rows and sends the OBO token", async () => {
    const { repo, calls } = fakeDataverse((url) => {
      if (url.pathname.endsWith(BC_TABLES.customer.entitySet)) {
        return { body: { value: [{ [C.id]: ID, [C.number]: "C-1001", [C.name]: "Fabrikam, Inc.", [C.currency]: "EUR", [C.creditLimit]: 60000, [C.salesperson]: "JR" }] } };
      }
    });
    const c = await repo.findCustomer({ customerNo: "C-1001" });
    expect(c).toMatchObject({ id: ID, number: "C-1001", name: "Fabrikam, Inc.", creditLimit: 60000 });
    expect(calls[0]!.url.pathname).toBe(`/api/data/v9.2/${BC_TABLES.customer.entitySet}`);
    expect(calls[0]!.url.searchParams.get("$filter")).toContain(`${C.number} eq 'C-1001'`);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer dv-token");
    expect(await repo.findCustomer({})).toBeUndefined();
  });

  it("joins ledger close dates onto paid invoices and degrades if the ledger table is missing", async () => {
    let ledger = true;
    const { repo } = fakeDataverse((url) => {
      if (url.pathname.endsWith(BC_TABLES.salesInvoice.entitySet)) {
        return {
          body: {
            value: [
              { [I.id]: ID, [I.number]: "SI-1", [I.customerNumber]: "C-1001", [I.dueDate]: "2026-10-01", [I.invoiceDate]: "2026-09-01", [I.totalAmount]: 100, [I.remainingAmount]: 0, [`${I.status}${FORMATTED}`]: "Paid" },
              { [I.id]: ID, [I.number]: "SI-2", [I.customerNumber]: "C-1001", [I.dueDate]: "2026-11-01T00:00:00Z", [I.invoiceDate]: "2026-10-01", [I.totalAmount]: 50, [I.remainingAmount]: 50, [I.status]: "Open" },
            ],
          },
        };
      }
      if (url.pathname.endsWith(BC_TABLES.customerLedgerEntry.entitySet)) {
        return ledger ? { body: { value: [{ [L.documentNo]: "SI-1", [L.closedAtDate]: "2026-10-20" }] } } : { status: 400, body: { error: "no such table" } };
      }
    });
    const invoices = await repo.listInvoices({ customerNos: ["C-1001"], since: "2025-11-27" });
    expect(invoices[0]).toMatchObject({ status: "Paid", closedDate: "2026-10-20" });
    expect(invoices[1]).toMatchObject({ status: "Open", dueDate: "2026-11-01" });
    expect(invoices[1]!.closedDate).toBeUndefined();
    ledger = false;
    const fresh = fakeDataverse((url) => (url.pathname.endsWith(BC_TABLES.customerLedgerEntry.entitySet) ? { status: 400 } : { body: { value: [] } }));
    expect(await fresh.repo.listInvoices({})).toEqual([]);
    expect(await fresh.repo.listInvoices({ openOnly: true })).toEqual([]);
  });

  it("stores dashboard specs in ppn_collectiondashboard with last-write-wins", async () => {
    const stored = new Map<string, Record<string, unknown>>();
    const { repo, calls } = fakeDataverse((url, init) => {
      const m = /ppn_collectiondashboards\((.+)\)/.exec(url.pathname);
      if (!m) return undefined;
      if (init.method === "PATCH") {
        stored.set(m[1]!, JSON.parse(String(init.body)));
        return { status: 204 };
      }
      const row = stored.get(m[1]!);
      return row ? { body: row } : { status: 404 };
    });
    const spec = createDashboardSpec({ id: ID, now: new Date("2026-11-27T09:00:00Z"), filters: { customerNos: ["C-1001"] } });
    expect(await repo.getDashboard(ID)).toBeUndefined();
    await repo.saveDashboard(spec);
    expect(stored.get(ID)).toMatchObject({ [LOCAL_TABLES.dashboard.columns.version]: 1, [LOCAL_TABLES.dashboard.columns.customerNo]: "C-1001" });
    expect(await repo.getDashboard(ID)).toEqual(spec);
    const older = await repo.saveDashboard({ ...spec, title: "older", updatedAt: "2026-11-26T00:00:00.000Z" });
    expect(older.title).toBe(spec.title);
    expect(calls.filter((c) => c.init.method === "PATCH")).toHaveLength(1);
  });

  it("surfaces Dataverse errors", async () => {
    const { repo } = fakeDataverse(() => ({ status: 403, body: { error: { message: "no privilege" } } }));
    await expect(repo.listCustomers()).rejects.toBeInstanceOf(DataverseError);
    const missing = fakeDataverse(() => undefined);
    await expect(missing.repo.listCustomers()).rejects.toThrow(/Entity set not found/);
  });

  it("escapes OData string literals", () => {
    expect(odataString("O'Brien")).toBe("'O''Brien'");
  });
});
