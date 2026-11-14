/**
 * Ordinal ramp for aging buckets (one hue, light → dark = less → more overdue).
 * Validated with the dataviz palette validator (--ordinal) against #fcfcfb and #1a1a19.
 */
export const AGING_RAMP_LIGHT = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"] as const;
/** Dark surface: severity runs toward the lighter, higher-contrast end. */
export const AGING_RAMP_DARK = ["#184f95", "#256abf", "#3987e5", "#86b6ef", "#cde2fb"] as const;

export function bucketColor(index: number, count: number, dark = false): string {
  const ramp = dark ? AGING_RAMP_DARK : AGING_RAMP_LIGHT;
  if (count <= 1) return ramp[ramp.length - 1]!;
  const step = Math.round((index / (count - 1)) * (ramp.length - 1));
  return ramp[Math.min(ramp.length - 1, Math.max(0, step))]!;
}
