import { describe, expect, it } from "vitest";
import { buildTheme, isThemeColor, type ThemeColor } from "./theme";

describe("theme colors", () => {
  it("uses sky as the default light primary color", () => {
    const theme = buildTheme("light");
    expect(theme.palette.primary.main).toBe("#3f8fcb");
    expect(theme.palette.background.default).toBe("#f3f7fb");
    expect(theme.palette.divider).toBe("#d8e3ed");
    expect(theme.palette.success.main).toBe("#18794e");
  });

  it("validates configured colors and falls back for unknown values", () => {
    expect(isThemeColor("indigo")).toBe(true);
    expect(isThemeColor("unknown")).toBe(false);
    expect(buildTheme("dark", "unknown" as ThemeColor).palette.primary.main).toBe(
      "#86c5f4",
    );
  });
});
