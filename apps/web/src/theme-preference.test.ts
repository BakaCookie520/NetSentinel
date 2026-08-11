import { describe, expect, it } from "vitest";
import { isThemePreference, resolveThemeMode } from "./theme-preference";

describe("theme preference", () => {
  it("resolves system preference without losing explicit choices", () => {
    expect(resolveThemeMode("system", true)).toBe("dark");
    expect(resolveThemeMode("system", false)).toBe("light");
    expect(resolveThemeMode("light", true)).toBe("light");
    expect(resolveThemeMode("dark", false)).toBe("dark");
  });

  it("rejects unknown persisted values", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("sepia")).toBe(false);
  });
});
