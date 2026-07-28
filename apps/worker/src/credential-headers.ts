export type HttpCredentialType = "HTTP_BEARER" | "HTTP_BASIC" | "HTTP_API_KEY";
export type WebSocketCredentialType = HttpCredentialType | "WS_TOKEN";

export function buildCredentialHeaders(type: HttpCredentialType, secret: string): Record<string, string> {
  if (type === "HTTP_BEARER") return { authorization: `Bearer ${secret}` };
  try {
    if (type === "HTTP_BASIC") {
      const value = JSON.parse(secret) as { username?: unknown; password?: unknown };
      if (typeof value.username !== "string" || typeof value.password !== "string") throw new Error();
      return { authorization: `Basic ${Buffer.from(`${value.username}:${value.password}`).toString("base64")}` };
    }
    const value = JSON.parse(secret) as { headerName?: unknown; value?: unknown };
    if (typeof value.headerName !== "string" || !value.headerName || typeof value.value !== "string") throw new Error();
    return { [value.headerName]: value.value };
  } catch { throw new Error(`Invalid ${type} credential`); }
}

export function materializeWebSocketCredential(
  url: string,
  type: WebSocketCredentialType,
  secret: string,
): { url: string; headers: Record<string, string> } {
  if (type !== "WS_TOKEN") {
    return { url, headers: buildCredentialHeaders(type, secret) };
  }

  try {
    const value = JSON.parse(secret) as {
      token?: unknown;
      placement?: unknown;
      queryParamName?: unknown;
    };
    if (
      typeof value.token !== "string" ||
      !value.token ||
      !["BEARER", "QUERY"].includes(String(value.placement)) ||
      typeof value.queryParamName !== "string" ||
      !/^[A-Za-z0-9_.-]{1,128}$/.test(value.queryParamName)
    ) {
      throw new Error();
    }
    if (value.placement === "BEARER") {
      return { url, headers: { authorization: `Bearer ${value.token}` } };
    }
    const target = new URL(url);
    target.searchParams.set(value.queryParamName, value.token);
    return { url: target.toString(), headers: {} };
  } catch {
    throw new Error("Invalid WS_TOKEN credential");
  }
}
