import { describe, expect, it } from "vitest";
import { BC_TABLES, FORMATTED_VALUE, rankedWorklist, rowToCustomer, rowToInvoice } from "../src";
import { FIXTURE_AS_OF, fixtures } from "../src/fixtures";

const C = BC_TABLES.customer.columns;
const I = BC_TABLES.salesInvoice.columns;

describe("Dataverse row mapping", () => {
  it("maps customers with defaults", () => {
    expect(rowToCustomer({ [C.id]: "1", [C.number]: "C-1", [C.name]: "A", [C.creditLimit]: "500" })).toEqual({
      id: "1", number: "C-1", name: "A", currency: "EUR", paymentTermsDays: 30, creditLimit: 500, salesperson: "", city: undefined,
    });
    expect(rowToCustomer({ [C.city]: "Lisbon", [C.currency]: "USD" })).toMatchObject({ city: "Lisbon", currency: "USD" });
  });

  it("maps invoices and status labels", () => {
    const base = { [I.id]: "i", [I.number]: "SI-1", [I.dueDate]: "2026-10-01T00:00:00Z", [I.remainingAmount]: 10, [I.currency]: "EUR" };
    expect(rowToInvoice(base)).toMatchObject({ dueDate: "2026-10-01", status: "Open", remainingAmount: 10 });
    expect(rowToInvoice({ ...base, [`${I.status}${FORMATTED_VALUE}`]: "Paid" }).status).toBe("Paid");
    expect(rowToInvoice({ ...base, [I.status]: "Canceled" }).status).toBe("Canceled");
    expect(rowToInvoice({}).currency).toBe("EUR");
  });
});

describe("rankedWorklist", () => {
  it("follows the given order and derives the rest from aging", () => {
    const open = fixtures.invoices.filter((i) => i.customerNumber === "C-1001" && i.remainingAmount > 0 && i.dueDate < FIXTURE_AS_OF);
    const order = [open[2]!.id, open[0]!.id];
    const items = rankedWorklist(open, order, FIXTURE_AS_OF);
    expect(items.map((i) => i.invoiceId).slice(0, 2)).toEqual(order);
    expect(items.map((i) => i.rank)).toEqual(items.map((_, i) => i + 1));
    expect(items.find((i) => i.daysOverdue > 90)?.suggestedAction).toBe("Call today");
    const current = fixtures.invoices.find((i) => i.remainingAmount > 0 && i.dueDate > FIXTURE_AS_OF)!;
    expect(rankedWorklist([current], [], FIXTURE_AS_OF)[0]).toMatchObject({ suggestedAction: "Monitor" });
  });
});

describe("rankedWorklist with the agent's next steps", () => {
  it("uses the agent's suggested action for each ranked invoice", () => {
    const open = fixtures.invoices.filter((i) => i.customerNumber === "C-1001" && i.remainingAmount > 0 && i.dueDate < FIXTURE_AS_OF);
    const order = open.slice(0, 2).map((i) => i.id);
    const items = rankedWorklist(open, order, FIXTURE_AS_OF, ["Monitor", "Call today"]);
    expect(items[0]).toMatchObject({ invoiceId: order[0], suggestedAction: "Monitor" });
    expect(items[1]).toMatchObject({ invoiceId: order[1], suggestedAction: "Call today" });
  });
});
