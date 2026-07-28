import { describe, expect, it } from "vitest";
import {
  buildCredentialHeaders,
  materializeWebSocketCredential,
} from "./credential-headers.js";

describe("HTTP credential headers", () => {
  it("materializes Bearer, Basic and custom API key credentials", () => {
    expect(buildCredentialHeaders("HTTP_BEARER", "token-value")).toEqual({ authorization: "Bearer token-value" });
    expect(buildCredentialHeaders("HTTP_BASIC", JSON.stringify({ username: "api", password: "secret" }))).toEqual({ authorization: `Basic ${Buffer.from("api:secret").toString("base64")}` });
    expect(buildCredentialHeaders("HTTP_API_KEY", JSON.stringify({ headerName: "X-API-Key", value: "key-value" }))).toEqual({ "X-API-Key": "key-value" });
  });

  it("rejects malformed structured credentials", () => {
    expect(() => buildCredentialHeaders("HTTP_BASIC", "not-json")).toThrow("Invalid HTTP_BASIC credential");
  });
});

describe("WebSocket token credentials", () => {
  it("materializes a Bearer token without changing the URL", () => {
    const result = materializeWebSocketCredential(
      "wss://events.example.com/socket?channel=alerts",
      "WS_TOKEN",
      JSON.stringify({
        token: "ws-secret",
        placement: "BEARER",
        queryParamName: "access_token",
      }),
    );

    expect(result).toEqual({
      url: "wss://events.example.com/socket?channel=alerts",
      headers: { authorization: "Bearer ws-secret" },
    });
  });

  it("sets an encoded query token while preserving other parameters", () => {
    const original = "wss://events.example.com/socket?channel=alerts&access_token=old";
    const result = materializeWebSocketCredential(
      original,
      "WS_TOKEN",
      JSON.stringify({
        token: "new token&value",
        placement: "QUERY",
        queryParamName: "access_token",
      }),
    );

    const url = new URL(result.url);
    expect(url.searchParams.get("channel")).toBe("alerts");
    expect(url.searchParams.getAll("access_token")).toEqual(["new token&value"]);
    expect(result.headers).toEqual({});
    expect(original).toContain("access_token=old");
  });

  it("rejects malformed WS token secrets", () => {
    expect(() =>
      materializeWebSocketCredential("wss://events.example.com", "WS_TOKEN", "not-json"),
    ).toThrow("Invalid WS_TOKEN credential");
  });
});
