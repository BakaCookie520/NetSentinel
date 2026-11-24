import { AccountEmailPanel } from "./MailSettings";
import { useState } from "react";
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Paper, Stack, TextField, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components";
import { errorText } from "../error-messages";
import { onboarding, type SecurityDraft } from "../onboarding-api";
import { SecurityInformation } from "./Onboarding";

export function AccountSecurityPage() {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ["account-security"], queryFn: onboarding.security });
  const [password, setPassword] = useState(""); const [code, setCode] = useState("");
  const [draft, setDraft] = useState<SecurityDraft>(); const [result, setResult] = useState<{ recoveryKey?: string; backupCodes?: string[] }>();
  const [saved, setSaved] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const run = async (operation: () => Promise<void>) => { setBusy(true); setError(""); try { await operation(); await query.refetch(); } catch (error) { setError(errorText(error, "无法更新账户安全设置，请稍后重试。")); } finally { setBusy(false); } };
  const rotate = (target: "recovery" | "backup" | "disable") => run(async () => { const result = await onboarding.rotate(password, target, code); if (target !== "disable") { setResult(result); setSaved(false); } setCode(""); setPassword(""); });
  return <>
    <PageHeader title={t("onboarding.accountSecurity")} subtitle={t("onboarding.securityHint")} />
    <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 3 }, maxWidth: 680 }}><Stack gap={2.5}>
      {!query.data?.recoveryConfigured && <Alert severity="info">{t("onboarding.optionalSecurity")}</Alert>}
      {(error || query.error) && <Alert severity="error">{error || errorText(query.error, "无法读取账户安全设置，请稍后重试。")}</Alert>}
      <Typography>{t("onboarding.enableTotp")}: {query.data?.totpEnabled ? t("onboarding.configured") : t("onboarding.notConfigured")}</Typography>
      <Typography>{t("onboarding.recovery")}: {query.data?.recoveryConfigured ? t("onboarding.configured") : t("onboarding.notConfigured")}</Typography>
      <TextField type="password" label={t("onboarding.currentPassword")} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      {(query.data?.totpEnabled || draft) && <TextField label={t("onboarding.code")} autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} />}
      {draft && <><Box component="img" src={draft.qrCode} alt={t("onboarding.secret")} sx={{ width: 200 }} /><Typography sx={{ overflowWrap: "anywhere" }}>{draft.secret}</Typography><Button disabled={busy || !code || !password} onClick={() => void run(async () => { setResult(await onboarding.confirm(password, code)); setSaved(false); setDraft(undefined); setPassword(""); setCode(""); })}>{t("onboarding.confirmTotp")}</Button></>}
      <Stack direction={{ xs: "column", sm: "row" }} flexWrap="wrap" gap={1}>
        {!query.data?.totpEnabled && <Button variant="outlined" disabled={busy || !password} onClick={() => void run(async () => setDraft(await onboarding.enroll(password)))}>{t("onboarding.enroll")}</Button>}
        <Button disabled={busy || !password} onClick={() => void rotate("recovery")}>{t("onboarding.rotateRecovery")}</Button>
        {query.data?.totpEnabled && <><Button disabled={busy || !password || !code} onClick={() => void rotate("backup")}>{t("onboarding.rotateBackup")}</Button><Button color="error" disabled={busy || !password || !code} onClick={() => void rotate("disable")}>{t("onboarding.disable")}</Button></>}
      </Stack>
    </Stack></Paper>
    <AccountEmailPanel />
    <Dialog open={Boolean(result)} fullWidth maxWidth="sm"><DialogTitle>{t("onboarding.accountSecurity")}</DialogTitle><DialogContent><Stack gap={2}>{result && <SecurityInformation draft={result} />}<FormControlLabel control={<Checkbox checked={saved} onChange={(event) => setSaved(event.target.checked)} />} label={t("onboarding.saved")} /></Stack></DialogContent><DialogActions><Button disabled={!saved} onClick={() => setResult(undefined)}>{t("onboarding.acknowledge")}</Button></DialogActions></Dialog>
  </>;
}
