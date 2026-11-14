import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { createDashboardSpec } from "@collections/contract";
import { buildDashboardData, prioritizeWorklist } from "@collections/domain";
import { FIXTURE_AS_OF, fixtures } from "@collections/domain/fixtures";
import { AgingDashboard, InvoiceCard, PriorityList, bucketColor, formatMoney } from "../src";

const wrap = (ui: React.ReactElement) => render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);
const spec = createDashboardSpec({ id: "0f8fad5b-d9cb-469f-a165-70867728950e", now: new Date("2026-11-27T09:00:00Z") });
const data = buildDashboardData(spec, fixtures.customers, fixtures.invoices, FIXTURE_AS_OF);
const items = prioritizeWorklist(fixtures.customers, fixtures.invoices, FIXTURE_AS_OF, { customerNo: "C-1001" });

describe("AgingDashboard", () => {
  it("renders chart, table and totals from a spec", () => {
    wrap(<AgingDashboard spec={spec} data={data} />);
    expect(screen.getByRole("img", { name: /Overdue amount by customer/ })).toBeTruthy();
    expect(screen.getAllByText("Fabrikam, Inc.").length).toBeGreaterThan(0);
    expect(screen.getByText(/^Total /).textContent).toBe(`Total ${formatMoney(data.totals.overdueAmount)}`);
  });

  it("turns bucket chips into filter changes", () => {
    const onFiltersChange = vi.fn();
    wrap(<AgingDashboard spec={spec} data={data} onFiltersChange={onFiltersChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Current" }));
    expect(onFiltersChange).toHaveBeenCalledWith({ bucketIds: ["1-30", "31-60", "61-90", "90+"] });
  });

  it("shows an empty state", () => {
    wrap(<AgingDashboard spec={spec} data={{ ...data, rows: [] }} />);
    expect(screen.getByText(/No open invoices/)).toBeTruthy();
  });
});

describe("PriorityList and InvoiceCard", () => {
  it("renders critical cards and fires host callbacks", () => {
    const onOpenCritical = vi.fn();
    const onShowWorklist = vi.fn();
    wrap(<PriorityList items={items} onOpenCritical={onOpenCritical} onShowWorklist={onShowWorklist} />);
    fireEvent.click(screen.getByRole("button", { name: /Open \d critical invoice/ }));
    expect(onOpenCritical.mock.calls[0]![0].every((i: { critical: boolean }) => i.critical)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Show chase-today list" }));
    expect(onShowWorklist).toHaveBeenCalledWith(items);
  });

  it("renders an invoice card with an open button", () => {
    const onOpen = vi.fn();
    wrap(<InvoiceCard invoice={items[0]!} onOpen={onOpen} />);
    expect(screen.getByText("100 days overdue")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open invoice" }));
    expect(onOpen).toHaveBeenCalled();
  });

  it("handles an empty list", () => {
    wrap(<PriorityList items={[]} />);
    expect(screen.getByText(/Nothing overdue/)).toBeTruthy();
  });
});

describe("palette", () => {
  it("maps buckets onto the ordinal ramp ends", () => {
    expect(bucketColor(0, 5)).toBe("#86b6ef");
    expect(bucketColor(4, 5)).toBe("#0d366b");
    expect(bucketColor(0, 1, true)).toBe("#cde2fb");
  });
});
