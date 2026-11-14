import { useState } from "react";
import { Alert, Box, Button, Checkbox, FormControlLabel, Paper, Stack, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { CurrentUser } from "../api";
import { acceptLogin, onboarding } from "../onboarding-api";
import { SecurityInformation } from "./Onboarding";

export function SecureLoginPage({ onLogin, initialChallenge = "" }: { onLogin(user: CurrentUser): void; initialChallenge?: string }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState(initialChallenge); const [recover, setRecover] = useState(false); const [key, setKey] = useState("");
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
  return <Box sx={{ minHeight: "100dvh", display: "grid", placeItems: "center", p: 2 }}><Paper component="form" onSubmit={(event) => { event.preventDefault(); void submit(); }} variant="outlined" sx={{ width: "100%", maxWidth: 480, p: { xs: 2.5, sm: 4 } }}><Stack gap={2.5}>
    <Typography fontWeight={800}>NetSentinel</Typography><Typography variant="h1">{t(recover ? "onboarding.recoverTitle" : "onboarding.loginTitle")}</Typography>
    {error && <Alert severity="error">{error}</Alert>}{message && <Alert severity="success">{message}</Alert>}
    {recover && <Alert severity="warning">{t("onboarding.resetWarning")}</Alert>}
    {pending ? <><SecurityInformation draft={pending} /><FormControlLabel control={<Checkbox checked={saved} onChange={(event) => setSaved(event.target.checked)} />} label={t("onboarding.saved")} /></> :
      challenge && !recover ? <TextField autoFocus label={t("onboarding.code")} autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} /> : <>
        <TextField type="email" label={t("onboarding.email")} autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
        {recover && <TextField type="password" label={t("onboarding.recovery")} value={key} onChange={(event) => setKey(event.target.value)} />}
        <TextField type="password" label={t(recover ? "onboarding.newPassword" : "onboarding.password")} autoComplete={recover ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} />
        {recover && <TextField type="password" label={t("onboarding.confirmPassword")} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />}
      </>}
    <Button type="submit" variant="contained" disabled={busy || (pending ? !saved : challenge && !recover ? !code : !email || !password)}>{t(busy ? "onboarding.pending" : recover ? pending ? "onboarding.resetConfirm" : "onboarding.reset" : "onboarding.login")}</Button>
    <Button onClick={() => { setRecover(!recover); setChallenge(""); setPending(undefined); setError(""); setPassword(""); setCode(""); setKey(""); }}>{t(recover ? "onboarding.returnLogin" : "onboarding.recoveryLink")}</Button>
  </Stack></Paper></Box>;
}
