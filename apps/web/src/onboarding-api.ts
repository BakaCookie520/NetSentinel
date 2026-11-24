import { request } from "./api";
import type { CurrentUser } from "./api";

export interface SetupStatus { initialized: boolean; step: number; database: "sqlite" | "postgresql" | "redis" | null }
export interface SecurityDraft { secret: string; otpauth: string; qrCode: string; recoveryKey?: string; backupCodes?: string[] }
export interface LoginResult { user?: CurrentUser; csrfToken?: string; requiresTwoFactor?: boolean; challengeId?: string }
const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
export async function setupRequest<T>(path: string, body: unknown, csrf?: string): Promise<T> {
  return request<T>(`/setup/${path}`, { ...json(body), ...(csrf ? { headers: { "x-csrf-token": csrf } } : {}) });
}
export function acceptLogin(result: LoginResult): CurrentUser {
  if (!result.user || !result.csrfToken) throw new Error("Invalid authentication response");
  sessionStorage.setItem("netsentinel.csrf", result.csrfToken);
  sessionStorage.setItem("netsentinel.user", JSON.stringify(result.user));
  window.dispatchEvent(new CustomEvent("netsentinel:session", { detail: result.csrfToken }));
  window.dispatchEvent(new CustomEvent("netsentinel:user", { detail: result.user }));
  return result.user;
}
export const onboarding = {
  status: () => request<SetupStatus>("/setup/status"),
  unlock: (token: string) => setupRequest<{ csrfToken: string; username?: string; displayName?: string }>("unlock", { token }),
  security: () => request<{ totpEnabled: boolean; recoveryConfigured: boolean; backupCodesRemaining: number }>("/auth/me/security"),
  login: (identifier: string, password: string) => request<LoginResult>("/auth/login", json({ identifier, password })),
  secondFactor: (challengeId: string, code: string) => request<LoginResult>("/auth/two-factor", json({ challengeId, code })),
  recover: (identifier: string, recoveryKey: string, password: string, confirmation: string) => request<{ recoveryToken: string; recoveryKey: string }>("/auth/recover", json({ identifier, recoveryKey, password, confirmation })),
  confirmRecovery: (recoveryToken: string) => request("/auth/recover/confirm", json({ recoveryToken, saved: true })),
  enroll: (currentPassword: string) => request<SecurityDraft>("/auth/me/security/enroll", json({ currentPassword })),
  confirm: (currentPassword: string, code: string) => request<{ backupCodes: string[] }>("/auth/me/security/confirm", json({ currentPassword, code })),
  rotate: (currentPassword: string, target: "recovery" | "backup" | "disable", code: string) => request<{ recoveryKey?: string; backupCodes?: string[] }>("/auth/me/security/rotate", json({ currentPassword, target, code })),
};
