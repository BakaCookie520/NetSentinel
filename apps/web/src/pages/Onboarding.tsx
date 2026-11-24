import { useState } from "react";
import { Alert, Box, Button, Checkbox, FormControlLabel, LinearProgress, MenuItem, Paper, Stack, Step, StepLabel, Stepper, Switch, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { ApiError, type CurrentUser } from "../api";
import { errorText } from "../error-messages";
import { onboarding, setupRequest, acceptLogin, type LoginResult, type SecurityDraft, type SetupStatus } from "../onboarding-api";
import "../onboarding-i18n";

export function SecurityInformation({ draft }: { draft: SecurityDraft | { recoveryKey?: string; backupCodes?: string[] } }) {
  const { t } = useTranslation();
  const download = () => {
    const content = [t("onboarding.recovery"), draft.recoveryKey ?? "", t("onboarding.backupCodes"), ...(draft.backupCodes ?? [])].join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain" })); const link = document.createElement("a");
    link.href = url; link.download = "netsentinel-account-recovery.txt"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <Stack gap={1.5}>
    {draft.recoveryKey && <><Typography fontWeight={700}>{t("onboarding.recovery")}</Typography><Typography component="code" sx={{ p: 2, bgcolor: "action.hover", borderRadius: 2, overflowWrap: "anywhere", userSelect: "all" }}>{draft.recoveryKey}</Typography><Typography variant="body2" color="text.secondary">{t("onboarding.recoveryHint")}</Typography></>}
    {draft.backupCodes && <><Typography fontWeight={700}>{t("onboarding.backupCodes")}</Typography><Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 0.5 }}>{draft.backupCodes.map((code) => <Typography component="code" key={code} sx={{ fontFamily: "monospace", overflowWrap: "anywhere" }}>{code}</Typography>)}</Box></>}
    <Button onClick={download} variant="outlined">{t("onboarding.download")}</Button>
  </Stack>;
}
export function OnboardingPage({ status, onComplete }: { status: SetupStatus; onComplete(user: CurrentUser): void }) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState(status.step);
  const [token, setToken] = useState(""); const [csrf, setCsrf] = useState("");
  const [type, setType] = useState<"sqlite" | "postgresql" | "redis">(status.database ?? "sqlite");
  const [host, setHost] = useState(""); const [port, setPort] = useState(5432); const [dbName, setDbName] = useState("netsentinel");
  const [dbUser, setDbUser] = useState(""); const [dbPassword, setDbPassword] = useState(""); const [tls, setTls] = useState(false);
  const [dbNumber, setDbNumber] = useState(0); const [namespace, setNamespace] = useState("netsentinel");
  const [username, setUsername] = useState(""); const [identifier, setIdentifier] = useState(""); const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState(""); const [confirmation, setConfirmation] = useState("");
  const [enableTotp, setEnableTotp] = useState(false); const [code, setCode] = useState("");
  const [draft, setDraft] = useState<SecurityDraft>(); const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [existing, setExisting] = useState(false);
  const [result, setResult] = useState<LoginResult>();
  const database = () => {
    if (type === "sqlite") return { type };
    const url = new URL(`${type === "postgresql" ? "postgresql" : tls ? "rediss" : "redis"}://localhost`);
    url.hostname = host; url.port = String(port); url.username = dbUser; url.password = dbPassword;
    url.pathname = `/${type === "postgresql" ? dbName : dbNumber}`;
    if (type === "postgresql" && tls) url.searchParams.set("sslmode", "require");
    return { type, url: url.toString(), ...(type === "redis" ? { namespace } : {}) };
  };
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await operation(); } catch (error) {
      if (error instanceof ApiError && error.message === "SETUP_EXISTING_SITE") setExisting(true);
      setError(errorText(error, "初始化操作失败，请检查填写的信息后重试。"));
    } finally { setBusy(false); }
  };
  const unlock = () => run(async () => {
    const response = await onboarding.unlock(token); setCsrf(response.csrfToken); setUsername(response.username ?? ""); setDisplayName(response.displayName ?? "");
    if (status.step === 2) setDraft(await setupRequest<SecurityDraft>("security", {}, response.csrfToken));
    setToken("");
  });
  const next = () => run(async () => {
    if (step === 0) { await setupRequest("database", database(), csrf); setDbPassword(""); setStep(1); }
    else if (step === 1) {
      await setupRequest("account", { username, ...(displayName.trim() ? { displayName } : {}), password, confirmation }, csrf);
      setPassword(""); setConfirmation(""); setDraft(await setupRequest<SecurityDraft>("security", {}, csrf)); setStep(2);
    } else {
      const session = await setupRequest<LoginResult>("finish", { enableTotp, ...(enableTotp ? { code } : {}), recoverySaved: saved, origin: window.location.origin }, csrf);
      setDraft(undefined); setResult(session); setStep(3);
    }
  });
  return <Box sx={{ minHeight: "100dvh", p: { xs: 2, sm: 4 }, display: "grid", placeItems: "center" }}>
    <Paper variant="outlined" sx={{ width: "100%", maxWidth: 760, p: { xs: 2.5, sm: 4 } }}>
      <Stack gap={3}>
        <Stack direction="row" justifyContent="space-between" alignItems="center"><Typography fontWeight={800}>NetSentinel</Typography><Button onClick={() => { const locale = i18n.language === "zh-CN" ? "en-US" : "zh-CN"; void i18n.changeLanguage(locale); localStorage.setItem("netsentinel.locale", locale); }}>简体中文 / English</Button></Stack>
        <Box><Typography variant="h1">{t("onboarding.title")}</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>{t("onboarding.subtitle")}</Typography></Box>
        <Stepper activeStep={step} alternativeLabel sx={{ "& .MuiStepLabel-label": { fontSize: { xs: 11, sm: 14 } } }}>{[0, 1, 2, 3].map((index) => <Step key={index}><StepLabel>{t(`onboarding.steps.${index}`)}</StepLabel></Step>)}</Stepper>
        {window.location.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(window.location.hostname) && <Alert severity="warning">{t("onboarding.https")}</Alert>}
        {error && <Alert severity="error">{error}</Alert>}
        {busy && <LinearProgress />}
        {!csrf ? <><TextField label={t("onboarding.token")} type="password" value={token} onChange={(event) => setToken(event.target.value)} helperText={t("onboarding.tokenHint")} /><Button variant="contained" disabled={busy || !token} onClick={() => void unlock()}>{t("onboarding.unlock")}</Button></> :
          step === 0 ? <>
            <TextField select label={t("onboarding.database")} value={type} onChange={(event) => { const selected = event.target.value as "sqlite" | "postgresql" | "redis"; setType(selected); setPort(selected === "redis" ? 6379 : 5432); setExisting(false); }}>{["sqlite", "postgresql", "redis"].map((type) => <MenuItem key={type} value={type}>{t(`onboarding.${type}`)}</MenuItem>)}</TextField>
            {type === "sqlite" ? <Alert severity="info">{t("onboarding.sqliteHint")}</Alert> : <>
              {type === "redis" && <Alert severity="warning">{t("onboarding.redisHint")}</Alert>}
              <Stack direction={{ xs: "column", sm: "row" }} gap={2}><TextField fullWidth label={t("onboarding.host")} value={host} onChange={(event) => setHost(event.target.value)} /><TextField type="number" label={t("onboarding.port")} value={port} onChange={(event) => setPort(Number(event.target.value))} /></Stack>
              <TextField label={t("onboarding.username")} value={dbUser} onChange={(event) => setDbUser(event.target.value)} /><TextField label={t("onboarding.dbPassword")} type="password" autoComplete="off" value={dbPassword} onChange={(event) => setDbPassword(event.target.value)} />
              {type === "postgresql" ? <TextField label={t("onboarding.dbName")} value={dbName} onChange={(event) => setDbName(event.target.value)} /> : <><TextField type="number" label={t("onboarding.dbNumber")} value={dbNumber} onChange={(event) => setDbNumber(Number(event.target.value))} /><TextField label={t("onboarding.namespace")} value={namespace} onChange={(event) => setNamespace(event.target.value)} /></>}
              <FormControlLabel control={<Switch checked={tls} onChange={(event) => setTls(event.target.checked)} />} label={t("onboarding.tls")} />
            </>}
            {existing && <><Alert severity="info">{t("onboarding.existing")}</Alert><TextField label={t("onboarding.identifier")} value={identifier} onChange={(event) => setIdentifier(event.target.value)} /><TextField type="password" label={t("onboarding.password")} value={password} onChange={(event) => setPassword(event.target.value)} /><TextField label={t("onboarding.code")} value={code} onChange={(event) => setCode(event.target.value)} /><Button disabled={busy || !password} onClick={() => void run(async () => { const response = await setupRequest<LoginResult>("adopt", { database: database(), identifier, password, code }, csrf); onComplete(acceptLogin(response)); })}>{t("onboarding.adopt")}</Button></>}
            <Button variant="contained" disabled={busy || (type !== "sqlite" && !host)} onClick={() => void next()}>{t("onboarding.next")}</Button>
          </> : step === 1 ? <>
            <TextField label={t("onboarding.accountName")} autoComplete="username" helperText={t("onboarding.accountNameHint")} value={username} onChange={(event) => setUsername(event.target.value)} /><TextField label={t("onboarding.displayName")} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            <TextField label={t("onboarding.password")} type="password" autoComplete="new-password" value={password} helperText={t("onboarding.passwordHint")} onChange={(event) => setPassword(event.target.value)} /><TextField label={t("onboarding.confirmPassword")} type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
            <Button variant="contained" disabled={busy || !username.trim() || password.length < 12 || password !== confirmation} onClick={() => void next()}>{t("onboarding.next")}</Button>
          </> : step === 2 && draft ? <>
            <SecurityInformation draft={{ recoveryKey: draft.recoveryKey, ...(enableTotp ? { backupCodes: draft.backupCodes } : {}) }} />
            <FormControlLabel control={<Switch checked={enableTotp} onChange={(event) => { setEnableTotp(event.target.checked); setSaved(false); }} />} label={t("onboarding.enableTotp")} />
            {enableTotp && <><Box component="img" src={draft.qrCode} alt={t("onboarding.secret")} sx={{ width: 200, alignSelf: "center" }} /><Typography sx={{ overflowWrap: "anywhere" }}>{t("onboarding.secret")}: {draft.secret}</Typography><TextField label={t("onboarding.code")} autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} /></>}
            <FormControlLabel control={<Checkbox checked={saved} onChange={(event) => setSaved(event.target.checked)} />} label={t(enableTotp ? "onboarding.saved" : "onboarding.savedRecovery")} />
            <Button variant="contained" disabled={busy || !saved || (enableTotp && !code)} onClick={() => void next()}>{t("onboarding.finish")}</Button>
          </> : <><Alert severity="success">{t("onboarding.ready")}</Alert><Typography>{t("onboarding.readyHint")}</Typography><Button variant="contained" onClick={() => result && onComplete(acceptLogin(result))}>{t("onboarding.start")}</Button></>}
      </Stack>
    </Paper>
  </Box>;
}
