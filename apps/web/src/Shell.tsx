import { useEffect, useRef, useState } from "react";
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import {
  AssessmentOutlined,
  BoltOutlined,
  CheckOutlined,
  DashboardOutlined,
  DeleteOutline,
  DnsOutlined,
  ExpandMoreOutlined,
  GppGoodOutlined,
  HistoryOutlined,
  KeyOutlined,
  LanguageOutlined,
  LogoutOutlined,
  MenuOutlined,
  PaletteOutlined,
  PeopleOutline,
  PersonOutline,
  PhotoCameraOutlined,
  ReceiptLongOutlined,
  RouterOutlined,
  SettingsOutlined,
  ShieldOutlined,
  TodayOutlined,
  WarningAmberOutlined,
} from "@mui/icons-material";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { api, type CurrentUser } from "./api";
import type { ThemePreference } from "./theme-preference";

const drawerWidth = 264;
const nav = [
  ["/", "dashboard", DashboardOutlined],
  ["/monitors", "monitors", AssessmentOutlined],
  ["/workflows", "workflows", BoltOutlined],
  ["/credentials", "credentials", KeyOutlined],
  ["/maintenance", "maintenance", TodayOutlined],
  ["/agents", "agents", RouterOutlined],
  ["/access", "access", PeopleOutline],
  ["/incidents", "incidents", WarningAmberOutlined],
  ["/logs", "logs", ReceiptLongOutlined],
  ["/audit", "audit", HistoryOutlined],
  ["/settings", "settings", SettingsOutlined],
] as const;
const navSections = [
  { label: "operations", items: nav.slice(0, 3) },
  { label: "administration", items: nav.slice(3) },
] as const;

function fallbackUser(): CurrentUser {
  return {
    id: "unknown",
    email: "",
    displayName: "User",
    avatarUrl: null,
    permissions: [],
  };
}

function readStoredUser(): CurrentUser {
  try {
    return JSON.parse(sessionStorage.getItem("netsentinel.user") ?? "null") as CurrentUser;
  } catch {
    return fallbackUser();
  }
}

function UserAvatar({ user, size = 34 }: { user: CurrentUser; size?: number }) {
  const initials = user.displayName.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <Avatar
      src={user.avatarUrl ?? undefined}
      alt={user.displayName}
      sx={{
        width: size,
        height: size,
        borderRadius: size > 50 ? "20px 20px 8px 20px" : "12px 12px 5px 12px",
        bgcolor: "primary.main",
        fontSize: size > 50 ? 28 : 13,
        fontWeight: 800,
      }}
    >
      {initials}
    </Avatar>
  );
}

export function Shell({
  themePreference,
  setThemePreference,
}: {
  themePreference: ThemePreference;
  setThemePreference: (preference: ThemePreference, origin?: HTMLElement) => void;
}) {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up("md"));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<CurrentUser>(readStoredUser);
  const [languageAnchor, setLanguageAnchor] = useState<HTMLElement | null>(null);
  const [appearanceAnchor, setAppearanceAnchor] = useState<HTMLElement | null>(null);
  const [accountAnchor, setAccountAnchor] = useState<HTMLElement | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [draftDisplayName, setDraftDisplayName] = useState(user.displayName);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const health = useQuery({
    queryKey: ["system-health"],
    queryFn: api.health,
    refetchInterval: 10_000,
    retry: 1,
  });
  const meQuery = useQuery({
    queryKey: ["current-user"],
    queryFn: api.me,
    staleTime: 60_000,
  });
  const apiConnected = health.data?.status === "ready";
  const workerConnected = apiConnected && health.data?.workerConnected === true;
  const activeNav = nav.find(([path]) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path),
  );

  useEffect(() => {
    if (meQuery.data?.user) {
      setUser(meQuery.data.user);
      setDraftDisplayName(meQuery.data.user.displayName);
      sessionStorage.setItem("netsentinel.user", JSON.stringify(meQuery.data.user));
    }
  }, [meQuery.data]);
  useEffect(() => {
    const onUser = (event: Event) => {
      const next = (event as CustomEvent<CurrentUser>).detail;
      if (!next?.id) return;
      setUser(next);
      setDraftDisplayName(next.displayName);
    };
    window.addEventListener("netsentinel:user", onUser);
    return () => window.removeEventListener("netsentinel:user", onUser);
  }, []);

  const syncUser = (next: CurrentUser) => {
    setUser(next);
    setDraftDisplayName(next.displayName);
    sessionStorage.setItem("netsentinel.user", JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("netsentinel:user", { detail: next }));
  };
  const saveProfile = async () => {
    setProfileBusy(true);
    setProfileError("");
    try {
      syncUser((await api.updateProfile(draftDisplayName)).user);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : t("profile.saveError"));
    } finally {
      setProfileBusy(false);
    }
  };
  const uploadAvatar = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      setProfileError(t("profile.avatarTooLarge"));
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setProfileError(t("profile.avatarInvalid"));
      return;
    }
    setProfileBusy(true);
    setProfileError("");
    try {
      syncUser((await api.uploadAvatar(file)).user);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : t("profile.avatarError"));
    } finally {
      setProfileBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const removeAvatar = async () => {
    setProfileBusy(true);
    setProfileError("");
    try {
      syncUser((await api.deleteAvatar()).user);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : t("profile.avatarError"));
    } finally {
      setProfileBusy(false);
    }
  };
  const logout = async () => {
    setAccountAnchor(null);
    await api.logout();
    window.location.assign("/");
  };

  const drawer = (
    <Box
      className="shell-rail"
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <Stack direction="row" alignItems="center" gap={1.25} sx={{ height: 72, px: 2.25 }}>
        <Box className="brand-mark" sx={{ bgcolor: "primary.main", color: "primary.contrastText" }}>
          <ShieldOutlined fontSize="small" />
        </Box>
        <Box>
          <Typography fontWeight={800} letterSpacing="-0.03em">NetSentinel</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.1em", fontSize: "0.62rem" }}>
            CONTROL PLANE
          </Typography>
        </Box>
      </Stack>
      <Divider />
      <List
        dense
        sx={{
          px: 1.25,
          py: 1.5,
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overscrollBehavior: "contain",
          scrollbarGutter: "stable",
        }}
      >
        {navSections.map((section) => (
          <Box key={section.label} sx={{ mb: 1 }}>
            <ListSubheader disableSticky disableGutters sx={{ px: 1 }}>
              {t(`shell.${section.label}`)}
            </ListSubheader>
            {section.items.map(([path, key, Icon]) => {
              const selected = path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);
              return (
                <ListItemButton
                  key={path}
                  selected={selected}
                  onClick={() => {
                    navigate(path);
                    setMobileOpen(false);
                  }}
                  sx={{
                    mb: 0.25,
                    "&.Mui-selected": {
                      bgcolor: "primary.main",
                      color: "primary.contrastText",
                      boxShadow: (currentTheme) => `0 8px 18px ${currentTheme.palette.primary.main}33`,
                      "&:hover": { bgcolor: "primary.main" },
                      "& .MuiListItemIcon-root": { color: "inherit" },
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 38 }}><Icon fontSize="small" /></ListItemIcon>
                  <ListItemText
                    primary={t(`nav.${key}`)}
                    primaryTypographyProps={{ fontSize: 14, fontWeight: selected ? 700 : 550 }}
                  />
                </ListItemButton>
              );
            })}
          </Box>
        ))}
      </List>
      <Box
        className="system-pulse"
        sx={{
          m: 1.75,
          mt: 0.5,
          flexShrink: 0,
          p: 1.5,
          pl: 1.75,
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          color: health.isError ? "error.main" : workerConnected ? "success.main" : "warning.main",
          bgcolor: "background.paper",
        }}
      >
        <Stack direction="row" gap={1} alignItems="center">
          <GppGoodOutlined color={health.isError ? "error" : workerConnected ? "success" : "warning"} fontSize="small" />
          <Box>
            <Typography variant="body2" fontWeight={750} color="text.primary">
              {health.isError ? t("shell.disconnected") : workerConnected ? t("shell.healthy") : t("shell.workerOffline")}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {health.isError ? t("shell.apiUnavailable") : workerConnected ? t("shell.connected") : t("shell.workerDisconnected")}
            </Typography>
          </Box>
        </Stack>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <a className="skip-link" href="#main-content">{t("shell.skipToContent")}</a>
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          ml: { md: `${drawerWidth}px` },
          width: { md: `calc(100% - ${drawerWidth}px)` },
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Toolbar sx={{ minHeight: "64px!important", px: { xs: 1.5, md: 3 } }}>
          {!desktop && (
            <IconButton onClick={() => setMobileOpen(true)} aria-label={t("shell.navigation")}>
              <MenuOutlined />
            </IconButton>
          )}
          <Stack direction="row" alignItems="center" gap={1} sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 1.5, bgcolor: "action.hover", color: "primary.main" }}>
              <DnsOutlined fontSize="small" />
            </Box>
            <Box minWidth={0}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1.1 }}>
                {t("shell.currentView")}
              </Typography>
              <Typography variant="body2" fontWeight={700} noWrap>
                {activeNav ? t(`nav.${activeNav[1]}`) : t("shell.node")}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: { xs: "none", sm: "block" }, ml: 0.5 }}>
              · {t("shell.node")}
            </Typography>
          </Stack>
          <Stack direction="row" alignItems="center" gap={0.5}>
            <Tooltip title={t("shell.language")}>
              <IconButton aria-label={t("shell.language")} onClick={(event) => setLanguageAnchor(event.currentTarget)}>
                <LanguageOutlined />
              </IconButton>
            </Tooltip>
            <Tooltip title={t("shell.appearance")}>
              <IconButton aria-label={t("shell.appearance")} onClick={(event) => setAppearanceAnchor(event.currentTarget)}>
                <PaletteOutlined />
              </IconButton>
            </Tooltip>
            <Tooltip title={user.displayName}>
              <IconButton
                aria-label={t("shell.account")}
                onClick={(event) => setAccountAnchor(event.currentTarget)}
                sx={{ ml: 0.25, p: 0.4 }}
              >
                <UserAvatar user={user} />
                <ExpandMoreOutlined sx={{ display: { xs: "none", sm: "block" }, ml: 0.25 }} fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Toolbar>
      </AppBar>

      <Menu anchorEl={languageAnchor} open={Boolean(languageAnchor)} onClose={() => setLanguageAnchor(null)}>
        {(["zh-CN", "en-US"] as const).map((locale) => (
          <MenuItem
            key={locale}
            selected={i18n.language === locale}
            onClick={() => {
              void i18n.changeLanguage(locale);
              localStorage.setItem("netsentinel.locale", locale);
              setLanguageAnchor(null);
            }}
          >
            {i18n.language === locale && <CheckOutlined fontSize="small" sx={{ mr: 1 }} />}
            <ListItemText inset={i18n.language !== locale}>{locale === "zh-CN" ? "简体中文" : "English"}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
      <Menu anchorEl={appearanceAnchor} open={Boolean(appearanceAnchor)} onClose={() => setAppearanceAnchor(null)}>
        {(["light", "dark", "system"] as ThemePreference[]).map((preference) => (
          <MenuItem
            key={preference}
            selected={themePreference === preference}
            onClick={(event) => {
              setThemePreference(preference, event.currentTarget);
              setAppearanceAnchor(null);
            }}
          >
            {themePreference === preference && <CheckOutlined fontSize="small" sx={{ mr: 1 }} />}
            <ListItemText inset={themePreference !== preference}>{t(`shell.appearanceOptions.${preference}`)}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
      <Menu anchorEl={accountAnchor} open={Boolean(accountAnchor)} onClose={() => setAccountAnchor(null)}>
        <Box sx={{ px: 2, py: 1, maxWidth: 260 }}>
          <Typography variant="body2" fontWeight={800} noWrap>{user.displayName}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap>{user.email}</Typography>
        </Box>
        <Divider />
        <MenuItem onClick={() => {
          setProfileError("");
          setDraftDisplayName(user.displayName);
          setAccountAnchor(null);
          setProfileOpen(true);
        }}>
          <PersonOutline fontSize="small" sx={{ mr: 1.25 }} />
          {t("profile.open")}
        </MenuItem>
        <MenuItem onClick={(event) => {
          setAppearanceAnchor(event.currentTarget);
          setAccountAnchor(null);
        }}>
          <PaletteOutlined fontSize="small" sx={{ mr: 1.25 }} />
          {t("shell.appearance")}
        </MenuItem>
        <MenuItem onClick={() => void logout()}>
          <LogoutOutlined fontSize="small" sx={{ mr: 1.25 }} />
          {t("shell.logout")}
        </MenuItem>
      </Menu>

      <Drawer
        anchor="right"
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        PaperProps={{ sx: { width: { xs: "100%", sm: 420 }, p: { xs: 2, sm: 3 } } }}
      >
        <Stack gap={2.25} sx={{ height: "100%" }}>
          <Box>
            <Typography variant="h2">{t("profile.title")}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{t("profile.subtitle")}</Typography>
          </Box>
          {profileError && <Alert severity="error">{profileError}</Alert>}
          <Stack direction="row" alignItems="center" gap={1.5}>
            <UserAvatar user={user} size={72} />
            <Stack direction="row" gap={0.75} flexWrap="wrap">
              <Button size="small" variant="outlined" startIcon={<PhotoCameraOutlined />} disabled={profileBusy} onClick={() => fileInput.current?.click()}>
                {t("profile.upload")}
              </Button>
              {user.avatarUrl && (
                <Button size="small" color="error" startIcon={<DeleteOutline />} disabled={profileBusy} onClick={() => void removeAvatar()}>
                  {t("profile.remove")}
                </Button>
              )}
              <input
                ref={fileInput}
                hidden
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadAvatar(file);
                }}
              />
            </Stack>
          </Stack>
          <Typography variant="caption" color="text.secondary">{t("profile.avatarHint")}</Typography>
          <TextField label={t("profile.displayName")} value={draftDisplayName} onChange={(event) => setDraftDisplayName(event.target.value)} disabled={profileBusy} inputProps={{ maxLength: 120 }} />
          <TextField label={t("profile.email")} value={user.email} disabled />
          <Box sx={{ flex: 1 }} />
          <Stack direction="row" justifyContent="flex-end" gap={1}>
            <Button onClick={() => setProfileOpen(false)} disabled={profileBusy}>{t("common.cancel")}</Button>
            <Button variant="contained" onClick={() => void saveProfile()} disabled={profileBusy || !draftDisplayName.trim()}>
              {profileBusy ? t("profile.saving") : t("common.save")}
            </Button>
          </Stack>
        </Stack>
      </Drawer>

      <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
        <Drawer
          variant={desktop ? "permanent" : "temporary"}
          open={desktop || mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ "& .MuiDrawer-paper": { width: drawerWidth, borderRightColor: "divider" } }}
        >
          {drawer}
        </Drawer>
      </Box>
      <Box
        component="main"
        id="main-content"
        sx={{
          flex: 1,
          width: { xs: "100%", md: `calc(100% - ${drawerWidth}px)` },
          minWidth: 0,
          pt: "64px",
        }}
      >
        <Box sx={{ p: { xs: 2, sm: 2.5, lg: 3 }, maxWidth: 1500, mx: "auto" }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
