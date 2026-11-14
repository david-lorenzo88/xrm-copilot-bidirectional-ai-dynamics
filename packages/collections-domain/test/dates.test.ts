import { describe, expect, it } from "vitest";
import { resolveAsOf } from "../src/dates";

describe("resolveAsOf", () => {
  const now = new Date("2026-11-14T10:00:00Z");
  it("uses a valid demo date", () => expect(resolveAsOf("2026-11-27", now)).toBe("2026-11-27"));
  it("falls back to the real date when empty or invalid", () => {
    expect(resolveAsOf(undefined, now)).toBe("2026-11-14");
    expect(resolveAsOf("", now)).toBe("2026-11-14");
    expect(resolveAsOf("27/11/2026", now)).toBe("2026-11-14");
    expect(resolveAsOf("2026-13-45", now)).toBe("2026-11-14");
  });
});
