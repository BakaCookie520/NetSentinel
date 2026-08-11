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
import { LockOutlined, MailOutline, ShieldOutlined } from "@mui/icons-material";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import {
  buildTheme,
  getStoredThemeColor,
  isThemeColor,
  type ThemeColor,
} from "./theme";
import { ActionFeedbackProvider } from "./action-feedback";
import { Shell } from "./Shell";
import {
  isThemePreference,
  resolveThemeMode,
  type ThemePreference,
} from "./theme-preference";
import { DashboardPage, IncidentsPage, MonitorsPage } from "./pages/Operations";
import { LogsPage } from "./pages/Logs";
import { PublicStatusPage } from "./pages/PublicStatus";
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

function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("admin@netsentinel.local");
  const [password, setPassword] = useState(api.isDemo ? "NetSentinel123!" : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.login(email, password);
      sessionStorage.setItem("netsentinel.user", JSON.stringify(result.user));
      window.dispatchEvent(new CustomEvent("netsentinel:user", { detail: result.user }));
      onLogin();
    } catch {
      setError("无法登录，请检查账号、密码和 API 连接。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box
      sx={{
        minHeight: "100vh",
        height: { xs: "auto", md: "100vh" },
        display: "grid",
        gridTemplateColumns: {
          xs: "1fr",
          md: "minmax(360px, 0.9fr) minmax(520px, 1.1fr)",
        },
        bgcolor: "background.default",
      }}
    >
      <Box
        className="login-intro"
        sx={{
          display: { xs: "none", md: "grid" },
          gridTemplateRows: "auto minmax(min-content, 1fr) auto",
          alignItems: "start",
          gap: { md: 2, lg: 4 },
          p: { md: 3, lg: 6 },
          minHeight: 0,
          bgcolor: "primary.dark",
          color: "primary.contrastText",
          position: "relative",
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        <Stack direction="row" gap={1.25} alignItems="center">
          <Box className="brand-mark brand-mark--large" sx={{ bgcolor: "primary.main", color: "primary.contrastText" }}>
            <ShieldOutlined />
          </Box>
          <Typography variant="h2" color="inherit">
            NetSentinel
          </Typography>
        </Stack>
        <Box sx={{ width: "100%", maxWidth: 520, alignSelf: "center" }}>
          <Typography
            sx={{
              fontSize: { md: 30, lg: 40 },
              lineHeight: 1.08,
              fontWeight: 780,
              letterSpacing: "-0.05em",
              textWrap: "balance",
            }}
          >
            在连接中断时，执行经过授权的恢复动作。
          </Typography>
          <Typography
            sx={{ mt: 2, color: "primary.contrastText", opacity: 0.78, fontSize: { md: 15, lg: 16 }, lineHeight: 1.7 }}
          >
            主动监测 HTTP、WebSocket、TCP 与
            ICMP，通过审批和审计保护每一次自动化操作。
          </Typography>
          <Box sx={{ mt: 4, height: 1, bgcolor: "primary.contrastText", opacity: 0.24 }} />
          <Box
            data-testid="login-metrics"
            sx={{
              mt: 3,
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: { md: 1.5, lg: 3 },
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography fontSize={{ md: 20, lg: 24 }} fontWeight={750}>
                4
              </Typography>
              <Typography variant="caption" color="primary.contrastText" sx={{ display: "block", opacity: 0.78, lineHeight: 1.35 }}>
                探测协议
              </Typography>
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography fontSize={{ md: 20, lg: 24 }} fontWeight={750}>
                6
              </Typography>
              <Typography variant="caption" color="primary.contrastText" sx={{ display: "block", opacity: 0.78, lineHeight: 1.35 }}>
                动作类型
              </Typography>
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography fontSize={{ md: 20, lg: 24 }} fontWeight={750} sx={{ overflowWrap: "anywhere" }}>
                AES-GCM
              </Typography>
              <Typography variant="caption" color="primary.contrastText" sx={{ display: "block", opacity: 0.78, lineHeight: 1.35 }}>
                凭据加密
              </Typography>
            </Box>
          </Box>
        </Box>
        <Typography variant="caption" color="primary.contrastText" sx={{ opacity: 0.62, flexShrink: 0 }}>
          SELF-HOSTED NETWORK OPERATIONS
        </Typography>
      </Box>
      <Box sx={{ display: "grid", placeItems: "center", p: { xs: 2, sm: 4 } }}>
        <Box sx={{ width: "100%", maxWidth: 430 }}>
          <Stack
            direction="row"
            gap={1}
            alignItems="center"
            sx={{ display: { md: "none" }, mb: 4 }}
          >
            <Box className="brand-mark" sx={{ bgcolor: "primary.main", color: "primary.contrastText" }}>
              <ShieldOutlined />
            </Box>
            <Typography variant="h2">NetSentinel</Typography>
          </Stack>
          <Typography variant="h1">登录控制台</Typography>
          <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>
            使用本地管理员账户访问监控与自动化。
          </Typography>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {api.isDemo && (
            <Alert severity="info" sx={{ mb: 2 }}>
              演示模式已启用，可直接使用预填账号登录。
            </Alert>
          )}
          <Paper
            component="form"
            className="login-card"
            variant="outlined"
            onSubmit={submit}
            sx={{ p: { xs: 2, sm: 3 } }}
          >
            <Stack gap={2}>
              <TextField
                label="邮箱"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <MailOutline fontSize="small" />
                    </InputAdornment>
                  ),
                }}
              />
              <TextField
                label="密码"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <LockOutlined fontSize="small" />
                    </InputAdornment>
                  ),
                }}
              />
              <Button
                size="large"
                variant="contained"
                type="submit"
                disabled={busy || !email || !password}
              >
                {busy ? "正在登录…" : "登录"}
              </Button>
            </Stack>
          </Paper>
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            textAlign="center"
            sx={{ mt: 2 }}
          >
            会话使用 HttpOnly Cookie，并对写操作验证 CSRF token。
          </Typography>
        </Box>
      </Box>
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
      <BrowserRouter>
        <ActionFeedbackProvider enabled={authenticated}>
        <Routes>
          <Route path="/status" element={<PublicStatusPage />} />
          <Route
            path="/"
            element={
              authenticated ? (
                <Shell
                  themePreference={themePreference}
                  setThemePreference={setThemePreference}
                />
              ) : (
                <LoginPage onLogin={() => setAuthenticated(true)} />
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
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
        </ActionFeedbackProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
