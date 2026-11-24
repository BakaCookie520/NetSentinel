import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CssBaseline,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  ThemeProvider,
  Typography,
} from "@mui/material";
import { LockOutlined, PersonOutline, ShieldOutlined } from "@mui/icons-material";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type CurrentUser } from "./api";
import i18n from "./i18n";
import { errorText } from "./error-messages";
import {
  buildTheme,
  getStoredThemeColor,
  isThemeColor,
  type ThemeColor,
} from "./theme";
import { ActionFeedbackProvider } from "./action-feedback";
import { Shell } from "./Shell";
import { AuthLayout } from "./components/AuthLayout";
import {
  isThemePreference,
  resolveThemeMode,
  type ThemePreference,
} from "./theme-preference";
import { DashboardPage, IncidentsPage, MonitorsPage } from "./pages/Operations";
import { LogsPage } from "./pages/Logs";
import { PublicStatusPage } from "./pages/PublicStatus";
import { BackupsPage } from "./pages/Backups";
import { OnboardingPage } from "./pages/Onboarding";
import { AccountSecurityPage } from "./pages/AccountSecurity";
import { MailSettingsPage } from "./pages/MailSettings";
import { SettingsLayout } from "./pages/Settings";
import { SecureLoginPage } from "./pages/SecureLogin";
import { onboarding, acceptLogin, type LoginResult } from "./onboarding-api";
import {
  AccessPage,
  AgentsPage,
  AuditPage,
  CredentialsPage,
  MaintenancePage,
  SettingsPage,
  WorkflowsPage,
} from "./pages/Management";

function storedThemePreference(): ThemePreference {
  const value = localStorage.getItem("netsentinel.theme");
  return isThemePreference(value) ? value : "system";
}

function transitionTheme(update: () => void, origin?: HTMLElement): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }
  const root = document.documentElement;
  if (origin) {
    const rect = origin.getBoundingClientRect();
    root.style.setProperty("--theme-origin-x", `${rect.left + rect.width / 2}px`);
    root.style.setProperty("--theme-origin-y", `${rect.top + rect.height / 2}px`);
  }
  const documentWithTransition = document as Document & {
    startViewTransition?: (callback: () => void) => unknown;
  };
  if (documentWithTransition.startViewTransition) {
    documentWithTransition.startViewTransition(update);
  } else {
    update();
  }
}

function LoginPage({ onLogin }: { onLogin: (user: CurrentUser) => void }) {
  const [identifier, setIdentifier] = useState(api.isDemo ? "admin@netsentinel.local" : "");
  const [password, setPassword] = useState(api.isDemo ? "NetSentinel123!" : "");
  const [error, setError] = useState("");
  const [restored] = useState(() => sessionStorage.getItem("netsentinel.restored") === "true");
  const [busy, setBusy] = useState(false);
  const [securityLogin, setSecurityLogin] = useState(false);
  const [challenge, setChallenge] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result: LoginResult = api.isDemo ? await api.login(identifier, password) : await onboarding.login(identifier, password);
      if (result.requiresTwoFactor && result.challengeId) { setChallenge(result.challengeId); setSecurityLogin(true); setPassword(""); return; }
      const user = api.isDemo ? result.user! : acceptLogin(result);
      sessionStorage.removeItem("netsentinel.restored");
      sessionStorage.setItem("netsentinel.user", JSON.stringify(user));
      window.dispatchEvent(new CustomEvent("netsentinel:user", { detail: user }));
      onLogin(user);
    } catch (error) {
      setError(`无法登录。${errorText(error, "请检查账号、密码和 API 连接。")}`);
    } finally {
      setBusy(false);
    }
  };
  if (securityLogin) return <SecureLoginPage
    onLogin={onLogin}
    initialChallenge={challenge}
    initialRecovery={!challenge}
    onBack={() => { setSecurityLogin(false); setChallenge(""); }}
  />;
  return (
    <AuthLayout title={i18n.t("onboarding.loginTitle")} onSubmit={submit}>
      {restored && <Alert severity="success">{i18n.t("backup.relogin")}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      {api.isDemo && <Alert severity="info">演示模式已启用，可直接使用预填账号登录。</Alert>}
      <TextField
        label={i18n.t("onboarding.identifier")}
        variant="standard"
        name="identifier"
        autoComplete="username"
        required
        value={identifier}
        onChange={(event) => setIdentifier(event.target.value)}
        InputProps={{ startAdornment: <InputAdornment position="start"><PersonOutline fontSize="small" /></InputAdornment> }}
      />
      <TextField
        label={i18n.t("onboarding.loginPassword")}
        variant="standard"
        type="password"
        name="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        InputProps={{ startAdornment: <InputAdornment position="start"><LockOutlined fontSize="small" /></InputAdornment> }}
      />
      <Button
        size="large"
        variant="contained"
        type="submit"
        disabled={busy || !identifier.trim() || !password}
        disableElevation
        sx={{ minHeight: 48, mt: 1, borderRadius: 1.5 }}
      >
        {i18n.t(busy ? "onboarding.signingIn" : "onboarding.login")}
      </Button>
      {!api.isDemo && <Button
        size="small"
        disabled={busy}
        sx={{ color: "text.secondary", alignSelf: "center" }}
        onClick={() => { setPassword(""); setError(""); setSecurityLogin(true); }}
      >{i18n.t("onboarding.recoveryLink")}</Button>}
    </AuthLayout>
  );
}

function storedPasswordChangeRequired(): boolean {
  try {
    const user = JSON.parse(
      sessionStorage.getItem("netsentinel.user") ?? "null",
    ) as CurrentUser | null;
    return user?.forcePasswordChange === true;
  } catch {
    return false;
  }
}

function PasswordChangePage({
  onComplete,
}: {
  onComplete: (user: CurrentUser) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmation) {
      setError("两次输入的新密码不一致。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.changePassword(currentPassword, newPassword);
      const result = await api.me();
      sessionStorage.setItem("netsentinel.user", JSON.stringify(result.user));
      window.dispatchEvent(
        new CustomEvent("netsentinel:user", { detail: result.user }),
      );
      onComplete(result.user);
    } catch (error) {
      setError(`无法修改密码。${errorText(error, "请核对当前密码后重试。")}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        p: 2,
        bgcolor: "background.default",
      }}
    >
      <Paper component="form" onSubmit={submit} variant="outlined" sx={{ width: "100%", maxWidth: 440, p: { xs: 3, sm: 4 } }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <ShieldOutlined color="primary" />
            <Typography variant="h2">Change password</Typography>
          </Stack>
          <Typography color="text.secondary">
            Your account requires a new password before you can access the console.
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            helperText="Use at least 12 characters."
            inputProps={{ minLength: 12 }}
            required
          />
          <TextField
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
          />
          <Button type="submit" variant="contained" size="large" disabled={busy || !currentPassword || newPassword.length < 12 || !confirmation}>
            {busy ? "Saving…" : "Change password"}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}

export function App() {
  const [themePreference, setThemePreferenceState] =
    useState<ThemePreference>(storedThemePreference);
  const [systemDark, setSystemDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const mode = resolveThemeMode(themePreference, systemDark);
  const [authenticated, setAuthenticated] = useState(
    Boolean(sessionStorage.getItem("netsentinel.user")),
  );
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(
    storedPasswordChangeRequired,
  );
  const setupQuery = useQuery({ queryKey: ["setup-status"], queryFn: onboarding.status, enabled: !api.isDemo, retry: 1 });
  const sessionQuery = useQuery({ queryKey: ["session-check"], queryFn: api.me, enabled: !api.isDemo && setupQuery.data?.initialized === true, retry: false });
  useEffect(() => {
    if (sessionQuery.data) {
      sessionStorage.setItem("netsentinel.user", JSON.stringify(sessionQuery.data.user));
      setAuthenticated(true); setPasswordChangeRequired(sessionQuery.data.user.forcePasswordChange);
    } else if (sessionQuery.isError) {
      setAuthenticated(false); sessionStorage.removeItem("netsentinel.user");
    }
  }, [sessionQuery.data, sessionQuery.isError]);
  const [themeColor, setThemeColor] = useState<ThemeColor>(() =>
    getStoredThemeColor(),
  );
  const canReadSettings = (() => {
    try {
      const user = JSON.parse(sessionStorage.getItem("netsentinel.user") ?? "null") as {
        permissions?: unknown;
      } | null;
      return (
        Array.isArray(user?.permissions) &&
        (user.permissions.includes("settings:manage") ||
          user.permissions.includes("*"))
      );
    } catch {
      return false;
    }
  })();
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: api.settings,
    enabled: authenticated && canReadSettings,
    staleTime: 60_000,
  });
  useEffect(() => {
    const setting = settingsQuery.data?.find((item) => item.key === "themeColor");
    if (setting && isThemeColor(setting.value)) {
      setThemeColor(setting.value);
      localStorage.setItem("netsentinel.themeColor", setting.value);
    }
  }, [settingsQuery.data]);
  useEffect(() => {
    const onThemeColor = (event: Event) => {
      const value = (event as CustomEvent<unknown>).detail;
      if (isThemeColor(value)) setThemeColor(value);
    };
    window.addEventListener("netsentinel:theme-color", onThemeColor);
    return () => window.removeEventListener("netsentinel:theme-color", onThemeColor);
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  const setThemePreference = (
    next: ThemePreference,
    origin?: HTMLElement,
  ) => {
    transitionTheme(() => {
      localStorage.setItem("netsentinel.theme", next);
      setThemePreferenceState(next);
    }, origin);
  };
  return (
    <ThemeProvider theme={buildTheme(mode, themeColor)}>
      <CssBaseline />
      {!api.isDemo && setupQuery.isPending ? <Box sx={{ p: 4 }}><Typography>NetSentinel…</Typography></Box> :
      !api.isDemo && setupQuery.isError ? <Box sx={{ p: 4 }}><Alert severity="error">{errorText(setupQuery.error, "无法读取初始化状态，请稍后重试。")}</Alert><Button onClick={() => void setupQuery.refetch()}>{i18n.t("onboarding.retry")}</Button></Box> :
      !api.isDemo && setupQuery.data && !setupQuery.data.initialized ? <OnboardingPage status={setupQuery.data} onComplete={(user) => {
        setPasswordChangeRequired(user.forcePasswordChange); setAuthenticated(true); void setupQuery.refetch();
      }} /> :
      <BrowserRouter>
        <ActionFeedbackProvider enabled={authenticated}>
        <Routes>
          <Route path="/status" element={<PublicStatusPage />} />
          <Route
            path="/"
            element={
              authenticated ? (
                passwordChangeRequired ? (
                  <PasswordChangePage
                    onComplete={(user) => {
                      setPasswordChangeRequired(user.forcePasswordChange);
                    }}
                  />
                ) : (
                  <Shell
                    themePreference={themePreference}
                    setThemePreference={setThemePreference}
                  />
                )
              ) : (
                <LoginPage
                  onLogin={(user) => {
                    setPasswordChangeRequired(user.forcePasswordChange);
                    setAuthenticated(true);
                  }}
                />
              )
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="monitors" element={<MonitorsPage />} />
            <Route path="incidents" element={<IncidentsPage />} />
            <Route path="workflows" element={<WorkflowsPage />} />
            <Route path="credentials" element={<CredentialsPage />} />
            <Route path="maintenance" element={<MaintenancePage />} />
            <Route path="agents" element={<AgentsPage />} />
            <Route path="access" element={<AccessPage />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="settings" element={<SettingsLayout />}>
              <Route path="general" element={<SettingsPage />} />
              <Route path="backups" element={<BackupsPage />} />
              <Route path="security" element={<AccountSecurityPage />} />
              <Route path="mail" element={<MailSettingsPage />} />
              <Route path="*" element={<Navigate to="/settings" replace />} />
            </Route>
            <Route path="backups" element={<Navigate to="/settings/backups" replace />} />
            <Route path="security" element={<Navigate to="/settings/security" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
        </ActionFeedbackProvider>
      </BrowserRouter>}
    </ThemeProvider>
  );
}
