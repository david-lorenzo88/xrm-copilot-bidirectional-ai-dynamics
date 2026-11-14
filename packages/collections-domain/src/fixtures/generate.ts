import { round2 } from "../aging";
import { addDays } from "../dates";
import type { Customer, Invoice } from "../types";
import { createRandom, type Random } from "./random";

/** The demo is "today" on stage: 27 November 2026, Lisbon. */
export const FIXTURE_AS_OF = "2026-11-27";
export const HERO_CUSTOMER_NO = "C-1001";

type Pattern = "worsening" | "chronic" | "improving" | "punctual" | "occasional" | "slow";

interface CustomerSeed {
  name: string;
  city: string;
  pattern: Pattern;
  /** Typical invoice size in EUR. */
  size: number;
  terms?: number;
  creditLimit?: number;
  /** Month (0–11) whose invoice is disputed and stays unpaid. */
  stuckMonth?: number;
}

/** Fabrikam is first and is the hero: worsening payer with one large 90+ invoice. */
const SEEDS: CustomerSeed[] = [
  { name: "Fabrikam, Inc.", city: "Lisbon", pattern: "worsening", size: 9_000, creditLimit: 60_000 },
  { name: "Northwind Traders", city: "Porto", pattern: "chronic", size: 6_500, creditLimit: 40_000, stuckMonth: 8 },
  { name: "Tailspin Toys", city: "Madrid", pattern: "improving", size: 5_000, creditLimit: 40_000 },
  { name: "Adventure Works Cycles", city: "Seville", pattern: "punctual", size: 7_500 },
  { name: "Alpine Ski House", city: "Andorra la Vella", pattern: "occasional", size: 3_200 },
  { name: "Litware, Inc.", city: "Braga", pattern: "chronic", size: 2_800, creditLimit: 15_000 },
  { name: "Proseware, Inc.", city: "Coimbra", pattern: "punctual", size: 4_100 },
  { name: "Wingtip Toys", city: "Valencia", pattern: "slow", size: 2_200 },
  { name: "Woodgrove Bank", city: "Lisbon", pattern: "punctual", size: 12_000, terms: 45 },
  { name: "Coho Winery", city: "Faro", pattern: "slow", size: 1_900, stuckMonth: 8 },
  { name: "Wide World Importers", city: "Barcelona", pattern: "occasional", size: 8_800 },
  { name: "Lucerne Publishing", city: "Zurich", pattern: "punctual", size: 1_500, terms: 14 },
  { name: "Margie's Travel", city: "Funchal", pattern: "occasional", size: 2_600 },
  { name: "Fourth Coffee", city: "Porto", pattern: "punctual", size: 900, terms: 14 },
  { name: "Graphic Design Institute", city: "Aveiro", pattern: "slow", size: 1_200 },
  { name: "Humongous Insurance", city: "Lisbon", pattern: "punctual", size: 15_000, terms: 45 },
  { name: "Blue Yonder Airlines", city: "Lisbon", pattern: "occasional", size: 11_000 },
  { name: "City Power & Light", city: "Setúbal", pattern: "punctual", size: 6_000 },
  { name: "Trey Research", city: "Évora", pattern: "occasional", size: 3_900 },
  { name: "Relecloud", city: "Bilbao", pattern: "punctual", size: 5_400 },
  { name: "Adatum Corporation", city: "Málaga", pattern: "slow", size: 4_700, stuckMonth: 9 },
  { name: "Southridge Video", city: "Cascais", pattern: "occasional", size: 1_700 },
  { name: "VanArsdel, Ltd.", city: "Sintra", pattern: "punctual", size: 2_300 },
  { name: "First Up Consultants", city: "Leiria", pattern: "slow", size: 3_100 },
  { name: "Bellows College", city: "Guimarães", pattern: "punctual", size: 2_000, terms: 60 },
];

const SALESPEOPLE = ["JR", "KH", "PS"];

/** Days late for invoice `month` (0 = oldest of 12) under a pattern. */
function lateness(pattern: Pattern, month: number, r: Random): number {
  switch (pattern) {
    case "worsening":
      return Math.round(r.normal(2 + 9 * month, 3));
    case "chronic":
      return Math.round(r.normal(46, 7));
    case "improving":
      return Math.round(Math.max(-3, r.normal(52 - 4.8 * month, 3)));
    case "punctual":
      return Math.round(Math.min(6, r.normal(-1, 3)));
    case "occasional":
      return r.next() < 0.2 ? Math.round(r.normal(24, 6)) : Math.round(r.normal(1, 3));
    case "slow":
      return Math.round(r.normal(14, 5));
  }
}

export interface FixtureSet {
  asOf: string;
  customers: Customer[];
  invoices: Invoice[];
}

/** Deterministic: ~25 customers, ~300 invoices across the 12 months before `asOf`. */
export function generateFixtures(seed = 20261127, asOf = FIXTURE_AS_OF): FixtureSet {
  const r = createRandom(seed);
  const customers: Customer[] = SEEDS.map((s, i) => ({
    id: r.guid(),
    number: `C-${1001 + i}`,
    name: s.name,
    currency: "EUR",
    paymentTermsDays: s.terms ?? 30,
    creditLimit: s.creditLimit ?? Math.round((s.size * 6) / 1000) * 1000,
    salesperson: SALESPEOPLE[i % SALESPEOPLE.length]!,
    city: s.city,
  }));

  const invoices: Invoice[] = [];
  let seq = 104_001;
  const start = addDays(asOf, -365);

  customers.forEach((c, ci) => {
    const s = SEEDS[ci]!;
    for (let month = 0; month < 12; month++) {
      const invoiceDate = addDays(start, month * 30 + r.int(0, 20));
      if (invoiceDate > asOf) continue;
      const isHeroBig = s.pattern === "worsening" && month === 7;
      const total = isHeroBig ? 48_500 : round2(Math.max(150, r.normal(s.size, s.size * 0.25)));
      const date = isHeroBig ? "2026-07-20" : invoiceDate;
      const dueDate = addDays(date, c.paymentTermsDays);
      const paidOn = addDays(dueDate, lateness(s.pattern, month, r));
      // The hero's big invoice is never paid: it's the 90+ item the demo finds.
      const paid = !isHeroBig && month !== s.stuckMonth && paidOn <= asOf;
      invoices.push({
        id: r.guid(),
        number: `SI-${seq++}`,
        customerId: c.id,
        customerNumber: c.number,
        customerName: c.name,
        invoiceDate: date,
        dueDate,
        totalAmount: total,
        remainingAmount: paid ? 0 : total,
        currency: c.currency,
        status: paid ? "Paid" : "Open",
        ...(paid ? { closedDate: paidOn } : {}),
      });
    }
  });

  return { asOf, customers, invoices };
}
