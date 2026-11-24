import { request } from "./api";
import "./mail-i18n";

export interface MailSettings { enabled: boolean; host: string; port: number; tls: "starttls" | "implicit"; user: string; from: string; passwordConfigured: boolean }
export type MailDraft = Omit<MailSettings, "passwordConfigured"> & { password?: string };
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });
export const mail = {
  settings: () => request<MailSettings>("/admin/mail"),
  save: (draft: MailDraft) => request<MailSettings>("/admin/mail", json("PUT", draft)),
  test: (draft: MailDraft, to: string) => request("/admin/mail/test", json("POST", { ...draft, to })),
  account: () => request<{ username: string | null; email: string | null; verified: boolean; mailEnabled: boolean }>("/auth/me/email"),
  verify: (email: string, currentPassword: string) => request("/auth/me/email/request", json("POST", { email, currentPassword })),
  bind: (email: string, currentPassword: string, code: string) => request("/auth/me/email/confirm", json("POST", { email, currentPassword, code })),
  remove: (currentPassword: string) => request("/auth/me/email", json("DELETE", { currentPassword })),
  rename: (username: string, currentPassword: string) => request("/auth/me/username", json("PUT", { username, currentPassword })),
  resetRequest: (email: string) => request("/auth/recover/email/request", json("POST", { email })),
  reset: (email: string, code: string, password: string, confirmation: string) => request("/auth/recover/email/confirm", json("POST", { email, code, password, confirmation })),
};
