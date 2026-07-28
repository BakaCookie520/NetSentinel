import { describe, expect, it } from "vitest";
import { compatibleCredentialTypes } from "./credential-types";

describe("credential compatibility", () => {
  it("offers WS tokens only to WebSocket monitors", () => {
    expect(compatibleCredentialTypes("WEBSOCKET")).toContain("WS_TOKEN");
    expect(compatibleCredentialTypes("HTTP")).not.toContain("WS_TOKEN");
    expect(compatibleCredentialTypes("WEBHOOK")).not.toContain("WS_TOKEN");
  });

  it("keeps existing HTTP credentials compatible with WebSocket monitors", () => {
    expect(compatibleCredentialTypes("WEBSOCKET")).toEqual([
      "HTTP_BEARER",
      "HTTP_BASIC",
      "HTTP_API_KEY",
      "WS_TOKEN",
    ]);
  });
});
