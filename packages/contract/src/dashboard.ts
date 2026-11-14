import { z } from "zod";
import { IsoDate, RecordId } from "./primitives";

/** One aging bucket. `maxDays: null` means open-ended ("90+"). */
export const AgingBucket = z.object({
  id: z.string().regex(/^[a-z0-9+_-]{1,16}$/),
  label: z.string().min(1).max(32),
  minDays: z.int().min(0),
  maxDays: z.int().min(0).nullable(),
});
export type AgingBucket = z.infer<typeof AgingBucket>;

/** Standard buckets: Current (not yet due), 1–30, 31–60, 61–90, 90+ days overdue. */
export const DEFAULT_AGING_BUCKETS: readonly AgingBucket[] = [
  { id: "current", label: "Current", minDays: 0, maxDays: 0 },
  { id: "1-30", label: "1–30", minDays: 1, maxDays: 30 },
  { id: "31-60", label: "31–60", minDays: 31, maxDays: 60 },
  { id: "61-90", label: "61–90", minDays: 61, maxDays: 90 },
  { id: "90+", label: "90+", minDays: 91, maxDays: null },
];

export const DashboardDimension = z.enum(["customer", "agingBucket", "salesperson", "currency"]);
export type DashboardDimension = z.infer<typeof DashboardDimension>;

export const DashboardMeasure = z.enum(["overdueAmount", "openAmount", "invoiceCount"]);
export type DashboardMeasure = z.infer<typeof DashboardMeasure>;

export const DashboardFilters = z.object({
  customerNos: z.array(z.string().min(1).max(20)).max(50).optional(),
  bucketIds: z.array(z.string()).max(10).optional(),
  minDaysOverdue: z.int().min(0).max(3650).optional(),
  minAmount: z.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  topN: z.int().min(1).max(50).optional(),
});
export type DashboardFilters = z.infer<typeof DashboardFilters>;

/**
 * The shared state between the agent, the widget and the app.
 * Stored as JSON in `ppn_collectiondashboard`. Last write wins on `version`.
 */
export const DashboardSpec = z
  .object({
    kind: z.literal("contoso.collections.dashboard"),
    specVersion: z.literal(1),
    id: RecordId,
    title: z.string().min(1).max(120),
    /** Monotonic revision; every write increments it. */
    version: z.int().min(1),
    /** [rows, columns]; the default is customer × aging bucket. */
    groupBy: z.tuple([DashboardDimension, DashboardDimension]),
    measures: z.array(DashboardMeasure).min(1).max(3),
    filters: DashboardFilters,
    buckets: z.array(AgingBucket).min(1).max(10),
    visual: z.enum(["stackedBar", "table", "both"]),
    asOf: IsoDate.optional(),
    updatedAt: z.iso.datetime(),
    updatedBy: z.enum(["agent", "app"]),
  })
  .superRefine((spec, ctx) => {
    const sorted = [...spec.buckets].sort((a, b) => a.minDays - b.minDays);
    sorted.forEach((b, i) => {
      if (b.maxDays !== null && b.maxDays < b.minDays) {
        ctx.addIssue({ code: "custom", message: `bucket ${b.id}: maxDays < minDays`, path: ["buckets"] });
      }
      const next = sorted[i + 1];
      if (next && (b.maxDays === null || next.minDays <= b.maxDays)) {
        ctx.addIssue({ code: "custom", message: `bucket ${b.id} overlaps ${next.id}`, path: ["buckets"] });
      }
    });
    if (spec.groupBy[0] === spec.groupBy[1]) {
      ctx.addIssue({ code: "custom", message: "groupBy dimensions must differ", path: ["groupBy"] });
    }
  });
export type DashboardSpec = z.infer<typeof DashboardSpec>;

export interface NewDashboardInput {
  id: string;
  title?: string;
  groupBy?: [DashboardDimension, DashboardDimension];
  measures?: DashboardMeasure[];
  filters?: DashboardFilters;
  buckets?: AgingBucket[];
  visual?: DashboardSpec["visual"];
  asOf?: string;
  updatedBy?: DashboardSpec["updatedBy"];
  now?: Date;
}

/** Builds a valid version-1 spec with sensible defaults. */
export function createDashboardSpec(input: NewDashboardInput): DashboardSpec {
  return DashboardSpec.parse({
    kind: "contoso.collections.dashboard",
    specVersion: 1,
    id: input.id,
    title: input.title ?? "Overdue by customer and aging bucket",
    version: 1,
    groupBy: input.groupBy ?? ["customer", "agingBucket"],
    measures: input.measures ?? ["overdueAmount"],
    filters: input.filters ?? {},
    buckets: input.buckets ?? [...DEFAULT_AGING_BUCKETS],
    visual: input.visual ?? "both",
    asOf: input.asOf,
    updatedAt: (input.now ?? new Date()).toISOString(),
    updatedBy: input.updatedBy ?? "agent",
  });
}

export type DashboardPatch = Partial<Pick<DashboardSpec, "title" | "groupBy" | "measures" | "filters" | "buckets" | "visual">>;

/**
 * Applies a patch, bumps the version and re-validates.
 * `filters` replaces the whole filter set (so a filter can be cleared by omitting it).
 */
export function applyDashboardPatch(
  spec: DashboardSpec,
  patch: DashboardPatch,
  updatedBy: DashboardSpec["updatedBy"],
  now: Date = new Date(),
): DashboardSpec {
  return DashboardSpec.parse({
    ...spec,
    ...patch,
    version: spec.version + 1,
    updatedAt: now.toISOString(),
    updatedBy,
  });
}

/** Last-write-wins: should `incoming` replace `current`? */
export function isNewerSpec(incoming: DashboardSpec, current: DashboardSpec | undefined): boolean {
  if (!current || current.id !== incoming.id) return true;
  if (incoming.version !== current.version) return incoming.version > current.version;
  return incoming.updatedAt > current.updatedAt;
}
