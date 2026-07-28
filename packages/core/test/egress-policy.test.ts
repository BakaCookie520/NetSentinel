import { describe, expect, it } from "vitest";
import { isAddressAllowed } from "../src/index.js";

describe("default egress policy", () => {
  it("blocks loopback, link-local and cloud metadata destinations", () => {
    expect(isAddressAllowed("127.0.0.1")).toBe(false);
    expect(isAddressAllowed("169.254.169.254")).toBe(false);
    expect(isAddressAllowed("::1")).toBe(false);
    expect(isAddressAllowed("fe80::1")).toBe(false);
  });

  it("allows private and public destinations", () => {
    expect(isAddressAllowed("10.20.30.40")).toBe(true);
    expect(isAddressAllowed("8.8.8.8")).toBe(true);
    expect(isAddressAllowed("2001:4860:4860::8888")).toBe(true);
  });

  it("applies administrator CIDR rules with deny taking precedence", () => {
    expect(isAddressAllowed("127.0.0.1", { allow: ["127.0.0.0/8"] })).toBe(true);
    expect(isAddressAllowed("10.20.30.40", { deny: ["10.0.0.0/8"] })).toBe(false);
    expect(isAddressAllowed("10.20.30.40", { allow: ["10.0.0.0/8"], deny: ["10.20.0.0/16"] })).toBe(false);
  });
});
