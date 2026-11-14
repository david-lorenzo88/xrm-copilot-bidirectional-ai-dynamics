/**
 * Contract version. Bump the minor for additive changes and the major for
 * breaking ones. Receivers reject payloads whose major version they don't know.
 */
export const CONTRACT_VERSION = "1.0";
export const CONTRACT_MAJOR = 1;

/** Accepts "1", "1.0", "1.3"… and rejects anything with a different major. */
export function isCompatibleVersion(version: string | undefined): boolean {
  if (version === undefined) return true;
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return major === CONTRACT_MAJOR;
}
