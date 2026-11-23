import { useState } from "react";
import { Alert, Button, Checkbox, FormControlLabel, TextField } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { CurrentUser } from "../api";
import { acceptLogin, onboarding } from "../onboarding-api";
import { SecurityInformation } from "./Onboarding";
import { AuthLayout } from "../components/AuthLayout";

export function SecureLoginPage({ onLogin, initialChallenge = "", initialRecovery = false, onBack }: { onLogin(user: CurrentUser): void; initialChallenge?: string; initialRecovery?: boolean; onBack?(): void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState(initialChallenge); const [recover, setRecover] = useState(initialRecovery); const [key, setKey] = useState("");
  const [confirmation, setConfirmation] = useState(""); const [pending, setPending] = useState<{ recoveryToken: string; recoveryKey: string }>();
  const [saved, setSaved] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const submit = async () => {
    setBusy(true); setError("");
    try {
      if (recover) {
        if (!pending) { setPending(await onboarding.recover(email, key, password, confirmation)); setKey(""); setPassword(""); setConfirmation(""); }
        else { await onboarding.confirmRecovery(pending.recoveryToken); setRecover(false); setPending(undefined); setMessage(t("onboarding.recovered")); }
      } else {
        const result = challenge ? await onboarding.secondFactor(challenge, code) : await onboarding.login(email, password);
        setPassword("");
        if (result.requiresTwoFactor && result.challengeId) setChallenge(result.challengeId);
        else onLogin(acceptLogin(result));
      }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <AuthLayout title={t(recover ? "onboarding.recoverTitle" : "onboarding.loginTitle")} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    {error && <Alert severity="error">{error}</Alert>}{message && <Alert severity="success">{message}</Alert>}
    {recover && <Alert severity="warning">{t("onboarding.resetWarning")}</Alert>}
    {pending ? <><SecurityInformation draft={pending} /><FormControlLabel control={<Checkbox checked={saved} onChange={(event) => setSaved(event.target.checked)} />} label={t("onboarding.saved")} /></> :
      challenge && !recover ? <TextField variant="standard" required autoFocus label={t("onboarding.code")} autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} /> : <>
        <TextField variant="standard" required type="email" label={t("onboarding.email")} autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
        {recover && <TextField variant="standard" required type="password" label={t("onboarding.recovery")} value={key} onChange={(event) => setKey(event.target.value)} />}
        <TextField variant="standard" required type="password" label={t(recover ? "onboarding.newPassword" : "onboarding.password")} autoComplete={recover ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} />
        {recover && <TextField variant="standard" required type="password" label={t("onboarding.confirmPassword")} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />}
      </>}
    <Button type="submit" variant="contained" disableElevation sx={{ minHeight: 48, borderRadius: 1.5 }} disabled={busy || (pending ? !saved : challenge && !recover ? !code : !email || !password)}>{t(busy ? "onboarding.pending" : recover ? pending ? "onboarding.resetConfirm" : "onboarding.reset" : "onboarding.login")}</Button>
    <Button disabled={busy} size="small" sx={{ color: "text.secondary", alignSelf: "center" }} onClick={() => { if (recover && onBack) { onBack(); return; } setRecover(!recover); setChallenge(""); setPending(undefined); setError(""); setPassword(""); setCode(""); setKey(""); }}>{t(recover ? "onboarding.returnLogin" : "onboarding.recoveryLink")}</Button>
  </AuthLayout>;
}
