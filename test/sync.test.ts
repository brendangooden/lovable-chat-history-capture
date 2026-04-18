import { describe, expect, test } from "bun:test";
import { passesSinceFilter } from "../src/sync.ts";

describe("passesSinceFilter", () => {
  test("passes when since is undefined", () => {
    expect(passesSinceFilter("2026-04-17T00:00:00Z", undefined)).toBe(true);
  });

  test("passes when updateTime is undefined", () => {
    expect(passesSinceFilter(undefined, "2026-04-17T00:00:00Z")).toBe(true);
  });

  test("exact match returns true", () => {
    expect(
      passesSinceFilter("2026-04-17T00:00:00Z", "2026-04-17T00:00:00Z"),
    ).toBe(true);
  });

  test("updateTime strictly after since returns true", () => {
    expect(
      passesSinceFilter("2026-04-17T00:00:01Z", "2026-04-17T00:00:00Z"),
    ).toBe(true);
  });

  test("updateTime strictly before since returns false", () => {
    expect(
      passesSinceFilter("2026-04-16T23:59:59Z", "2026-04-17T00:00:00Z"),
    ).toBe(false);
  });

  test("handles mixed offset formats via Date.parse", () => {
    // UTC vs +0000 are semantically equal
    expect(
      passesSinceFilter("2026-04-17T00:00:00+00:00", "2026-04-17T00:00:00Z"),
    ).toBe(true);
    // 10:00 UTC is strictly after 11:00 +0200 (09:00 UTC)
    expect(
      passesSinceFilter("2026-04-17T10:00:00Z", "2026-04-17T11:00:00+02:00"),
    ).toBe(true);
  });

  test("falls back to lexicographic compare when timestamps unparseable", () => {
    // Neither value is a valid Date — should still return a deterministic result
    expect(passesSinceFilter("zzz", "aaa")).toBe(true);
    expect(passesSinceFilter("aaa", "zzz")).toBe(false);
  });
});
