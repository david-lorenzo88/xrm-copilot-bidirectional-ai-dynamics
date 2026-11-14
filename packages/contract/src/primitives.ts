import { z } from "zod";
import { isCompatibleVersion } from "./version";

/** Dataverse record id (GUID, braces not allowed). */
export const RecordId = z.guid();

/** Dataverse logical name, e.g. `dyn365bc_salesinvoice_v2_0`. */
export const LogicalName = z.string().regex(/^[a-z][a-z0-9_]{1,127}$/, "not a Dataverse logical name");

/** A FetchXML document. Kept deliberately small; the receiver re-checks the entity. */
export const FetchXml = z
  .string()
  .max(20_000)
  .refine((s) => /^\s*<fetch[\s>]/.test(s), "must be a <fetch> document");

/** ISO calendar date, `YYYY-MM-DD`. */
export const IsoDate = z.iso.date();

/** Optional per-payload contract version (major must match). */
export const ContractVersionField = z
  .string()
  .refine(isCompatibleVersion, "incompatible contract version")
  .optional();

/** Returns the root entity name of a FetchXML document, or undefined. */
export function fetchXmlEntityName(fetchXml: string): string | undefined {
  return /<entity\s+name\s*=\s*["']([a-z0-9_]+)["']/i.exec(fetchXml)?.[1]?.toLowerCase();
}
