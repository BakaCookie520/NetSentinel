import { useState } from "react";
import {
  AppBar,
  Avatar,
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import {
  AssessmentOutlined,
  BoltOutlined,
  Brightness4Outlined,
  Brightness7Outlined,
  DashboardOutlined,
  DnsOutlined,
  GppGoodOutlined,
  HistoryOutlined,
  KeyOutlined,
  LanguageOutlined,
  MenuOutlined,
  PeopleOutline,
  RouterOutlined,
  ReceiptLongOutlined,
  SettingsOutlined,
  ShieldOutlined,
  TodayOutlined,
  WarningAmberOutlined,
} from "@mui/icons-material";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

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

export function Shell({
  mode,
  toggleMode,
}: {
  mode: "light" | "dark";
  toggleMode: () => void;
}) {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up("md"));
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const health = useQuery({
    queryKey: ["system-health"],
    queryFn: api.health,
    refetchInterval: 10_000,
    retry: 1,
  });
  const apiConnected = health.data?.status === "ready";
  const workerConnected = apiConnected && health.data?.workerConnected === true;
  const activeNav = nav.find(([path]) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path),
  );
  const drawer = (
    <Box className="shell-rail" sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Stack
        direction="row"
        alignItems="center"
        gap={1.25}
        sx={{ height: 72, px: 2.25 }}
      >
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
      <List dense sx={{ px: 1.25, py: 1.5, flex: 1 }}>
        {navSections.map((section) => (
          <Box key={section.label} sx={{ mb: 1 }}>
            <ListSubheader disableSticky disableGutters sx={{ px: 1 }}>
              {t(`shell.${section.label}`)}
            </ListSubheader>
            {section.items.map(([path, key, Icon]) => {
              const selected =
                path === "/"
                  ? location.pathname === "/"
                  : location.pathname.startsWith(path);
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
                      boxShadow: (currentTheme) =>
                        `0 8px 18px ${currentTheme.palette.primary.main}33`,
                      "&:hover": { bgcolor: "primary.main" },
                      "& .MuiListItemIcon-root": { color: "inherit" },
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 38 }}>
                    <Icon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary={t(`nav.${key}`)}
                    primaryTypographyProps={{
                      fontSize: 14,
                      fontWeight: selected ? 700 : 550,
                    }}
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
          <GppGoodOutlined
            color={
              health.isError ? "error" : workerConnected ? "success" : "warning"
            }
            fontSize="small"
          />
          <Box>
            <Typography variant="body2" fontWeight={750} color="text.primary">
              {health.isError
                ? t("shell.disconnected")
                : workerConnected
                  ? t("shell.healthy")
                  : t("shell.workerOffline")}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {health.isError
                ? t("shell.apiUnavailable")
                : workerConnected
                  ? t("shell.connected")
                  : t("shell.workerDisconnected")}
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
            <IconButton
              onClick={() => setMobileOpen(true)}
              aria-label={t("shell.navigation")}
            >
              <MenuOutlined />
            </IconButton>
          )}
          <Stack
            direction="row"
            alignItems="center"
            gap={1}
            sx={{ flex: 1, minWidth: 0 }}
          >
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
              <IconButton
                aria-label={t("shell.language")}
                onClick={() => {
                  const next = i18n.language === "zh-CN" ? "en-US" : "zh-CN";
                  void i18n.changeLanguage(next);
                  localStorage.setItem("netsentinel.locale", next);
                }}
              >
                <LanguageOutlined />
              </IconButton>
            </Tooltip>
            <Tooltip
              title={mode === "light" ? t("shell.dark") : t("shell.light")}
            >
              <IconButton aria-label="切换主题" onClick={toggleMode}>
                {mode === "light" ? (
                  <Brightness4Outlined />
                ) : (
                  <Brightness7Outlined />
                )}
              </IconButton>
            </Tooltip>
            <Avatar
              sx={{
                ml: 0.5,
                width: 32,
                height: 32,
                bgcolor: "primary.main",
                fontSize: 13,
              }}
            >
              管
            </Avatar>
          </Stack>
        </Toolbar>
      </AppBar>
      <Box
        component="nav"
        sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}
      >
        <Drawer
          variant={desktop ? "permanent" : "temporary"}
          open={desktop || mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            "& .MuiDrawer-paper": {
              width: drawerWidth,
              borderRightColor: "divider",
            },
          }}
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
