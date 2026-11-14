const DAY_MS = 86_400_000;

/** Parses `YYYY-MM-DD` (or a full ISO timestamp) to a UTC midnight timestamp. */
export function toUtcDay(date: string | Date): number {
  const d = typeof date === "string" ? new Date(date.length === 10 ? `${date}T00:00:00Z` : date) : date;
  if (Number.isNaN(d.getTime())) throw new RangeError(`Invalid date: ${String(date)}`);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string | Date, to: string | Date): number {
  return Math.round((toUtcDay(to) - toUtcDay(from)) / DAY_MS);
}

export function addDays(date: string | Date, days: number): string {
  return formatIsoDate(new Date(toUtcDay(date) + days * DAY_MS));
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * "Today" for ageing: a configured demo date (YYYY-MM-DD) when set and valid, else the real date.
 * Lets rehearsals show the session-day picture (overdue days, buckets) before the session.
 */
export function resolveAsOf(demoAsOf?: string | null, now: Date = new Date()): string {
  const d = demoAsOf?.trim();
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) ? d : formatIsoDate(now);
}

/** `YYYY-MM` month key. */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** Fractional months between two dates (30.44-day months). */
export function monthsBetween(from: string, to: string): number {
  return daysBetween(from, to) / 30.44;
}
