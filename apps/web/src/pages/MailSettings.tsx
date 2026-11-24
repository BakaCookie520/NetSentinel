import { useState, type FormEvent } from "react";
import { Alert, Button, Divider, FormControlLabel, MenuItem, Paper, Skeleton, Stack, Switch, TextField, Typography } from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { PageHeader } from "../components";
import { errorText } from "../error-messages";
import { mail, type MailDraft, type MailSettings } from "../mail-api";

export function MailSettingsPage() {
  const { t } = useTranslation();
  const settings = useQuery({ queryKey: ["mail-settings"], queryFn: mail.settings, enabled: !api.isDemo });
  if (api.isDemo) return <Alert severity="info">{t("backup.demo")}</Alert>;
  return <><PageHeader title={t("settingsNavigation.mail")} subtitle={t("mail.description")} />
    {settings.isPending ? <Skeleton variant="rounded" height={260} /> : settings.data ? <MailSettingsForm settings={settings.data} /> : <Alert severity="error">{errorText(settings.error)}</Alert>}
  </>;
}
function MailSettingsForm({ settings }: { settings: MailSettings }) {
  const { t } = useTranslation(); const client = useQueryClient();
  const { passwordConfigured: _configured, ...fields } = settings;
  const [draft, setDraft] = useState<MailDraft>(fields);
  const set = <K extends keyof MailDraft,>(field: K, value: MailDraft[K]) => setDraft((old) => ({ ...old, [field]: value }));
  const [to, setTo] = useState(""); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await operation(); } catch (error) { setError(errorText(error)); } finally { setBusy(false); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void run(async () => {
    const result = await mail.save(draft); set("password", ""); client.setQueryData(["mail-settings"], result);
    await client.invalidateQueries({ queryKey: ["account-email"] }); setNotice(t("mail.saved"));
  }); };
  const configured = Boolean(draft.host.trim() && draft.from.trim() && draft.port > 0 && draft.port <= 65535);
  return <Paper component="form" onSubmit={submit} variant="outlined" sx={{ p: { xs: 2.5, sm: 3 }, maxWidth: 720 }}>
    <Stack gap={2}>
      {error && <Alert severity="error">{error}</Alert>}{notice && <Alert severity="success">{notice}</Alert>}
      <FormControlLabel label={t("mail.enabled")} control={<Switch checked={draft.enabled} onChange={(event) => set("enabled", event.target.checked)} />} />
      <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
        <TextField required fullWidth label={t("mail.host")} value={draft.host} onChange={(event) => set("host", event.target.value)} />
        <TextField required type="number" label={t("mail.port")} value={draft.port} onChange={(event) => set("port", Number(event.target.value))} />
      </Stack>
      <TextField select label={t("mail.tls")} value={draft.tls} onChange={(event) => set("tls", event.target.value === "implicit" ? "implicit" : "starttls")}>
        <MenuItem value="starttls">{t("mail.starttls")}</MenuItem><MenuItem value="implicit">{t("mail.implicit")}</MenuItem>
      </TextField>
      <TextField label={t("mail.user")} autoComplete="off" value={draft.user} onChange={(event) => set("user", event.target.value)} />
      <TextField label={t("mail.password")} type="password" autoComplete="new-password" value={draft.password ?? ""} onChange={(event) => set("password", event.target.value)} helperText={settings.passwordConfigured ? t("mail.passwordKept") : undefined} />
      <TextField required label={t("mail.from")} type="email" value={draft.from} onChange={(event) => set("from", event.target.value)} />
      <Button type="submit" variant="contained" disabled={busy || !configured} sx={{ alignSelf: "flex-start" }}>{t("mail.save")}</Button>
      <Divider />
      <TextField label={t("mail.to")} type="email" value={to} onChange={(event) => setTo(event.target.value)} />
      <Button variant="outlined" disabled={busy || !configured || !to.trim()} sx={{ alignSelf: "flex-start" }} onClick={() => void run(async () => { await mail.test(draft, to); setNotice(t("mail.sent")); })}>{t("mail.test")}</Button>
    </Stack>
  </Paper>;
}

export function AccountEmailPanel() {
  const { t } = useTranslation(); const client = useQueryClient();
  const account = useQuery({ queryKey: ["account-email"], queryFn: mail.account, enabled: !api.isDemo });
  const [name, setName] = useState<string>(); const [password, setPassword] = useState("");
  const [email, setEmail] = useState(""); const [code, setCode] = useState(""); const [sentTo, setSentTo] = useState("");
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(""); const [error, setError] = useState("");
  const run = async (operation: () => Promise<void>, message: string, refresh = false) => {
    setBusy(true); setError(""); setNotice("");
    try { await operation(); setNotice(t(message)); if (refresh) { setPassword(""); await Promise.all([account.refetch(), client.invalidateQueries({ queryKey: ["current-user"] })]); } }
    catch (error) { setError(errorText(error)); } finally { setBusy(false); }
  };
  if (api.isDemo) return null;
  return <Paper component="section" variant="outlined" sx={{ p: { xs: 2.5, md: 3 }, maxWidth: 680, mt: 2.5 }}><Stack gap={2}>
    <Typography variant="h2">{t("mail.account")}</Typography><Typography color="text.secondary">{t("mail.emailHint")}</Typography>
    {(error || account.error) && <Alert severity="error">{error || errorText(account.error)}</Alert>}{notice && <Alert severity="success">{notice}</Alert>}
    {account.data && <>
      <Typography>{account.data.email ? `${account.data.email} · ${t(account.data.verified ? "mail.verified" : "mail.unverified")}` : t("mail.noEmail")}</Typography>
      {!account.data.mailEnabled && <Alert severity="info">{t("mail.disabled")}</Alert>}
      <TextField label={t("onboarding.currentPassword")} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      <TextField label={t("onboarding.accountName")} value={name ?? account.data.username ?? ""} onChange={(event) => setName(event.target.value)} />
      <Button variant="outlined" disabled={busy || !password || !name?.trim() || name === account.data.username} sx={{ alignSelf: "flex-start" }} onClick={() => void run(async () => { await mail.rename(name!, password); setName(undefined); }, "mail.renamed", true)}>{t("mail.rename")}</Button>
      <Divider />
      <TextField label={t("mail.newEmail")} type="email" value={email} onChange={(event) => { setEmail(event.target.value); setCode(""); setSentTo(""); }} />
      {sentTo && <TextField label={t("mail.code")} autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} />}
      <Stack gap={1} direction={{ xs: "column", sm: "row" }} flexWrap="wrap">
        <Button variant="outlined" disabled={busy || !password || !email.trim() || !account.data.mailEnabled} onClick={() => void run(async () => { await mail.verify(email, password); setSentTo(email); }, "mail.checkInbox")}>{t("mail.request")}</Button>
        {sentTo && <Button variant="contained" disabled={busy || !password || code.trim().length !== 6} onClick={() => void run(async () => { await mail.bind(sentTo, password, code); setSentTo(""); setCode(""); setEmail(""); }, "mail.bound", true)}>{t("mail.confirm")}</Button>}
        {account.data.email && <Button color="error" disabled={busy || !password} onClick={() => void run(async () => { await mail.remove(password); setSentTo(""); setCode(""); }, "mail.removed", true)}>{t("mail.remove")}</Button>}
      </Stack>
    </>}
  </Stack></Paper>;
}
