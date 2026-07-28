import type { CredentialInput } from "@netsentinel/contracts";

const HTTP_CREDENTIAL_TYPES = [
  "HTTP_BEARER",
  "HTTP_BASIC",
  "HTTP_API_KEY",
] as const satisfies readonly CredentialInput["type"][];

export function compatibleCredentialTypes(
  ownerType: string,
): readonly CredentialInput["type"][] {
  if (ownerType === "WEBSOCKET") return [...HTTP_CREDENTIAL_TYPES, "WS_TOKEN"];
  if (ownerType === "HTTP" || ownerType === "WEBHOOK") {
    return HTTP_CREDENTIAL_TYPES;
  }
  if (ownerType === "SSH") return ["SSH_KEY", "SSH_PASSWORD"];
  if (ownerType === "EMAIL") return ["SMTP"];
  return [];
}
