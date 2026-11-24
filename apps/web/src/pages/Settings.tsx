import { Alert, Box, Button, Skeleton, Stack, Typography } from "@mui/material";
import { HistoryOutlined, SettingsOutlined, ShieldOutlined } from "@mui/icons-material";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { api } from "../api";

const sections = [
  { path: "general", icon: SettingsOutlined, permission: "settings:manage" },
  { path: "backups", icon: HistoryOutlined, permission: "backup:manage" },
  { path: "security", icon: ShieldOutlined, permission: null },
] as const;

export function SettingsLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const me = useQuery({ queryKey: ["current-user"], queryFn: api.me });
  if (me.isPending) return <Skeleton variant="rounded" height={180} />;
  if (!me.data) return <Alert severity="error">{t("settingsNavigation.loadError", { lng: "zh-CN" })}</Alert>;

  const user = me.data.user;
  const available = sections.filter((section) =>
    section.permission === null ||
    ((section.path !== "backups" || user.authentication === "session") &&
      (user.permissions.includes(section.permission) || user.permissions.includes("*"))),
  );
  const current = location.pathname.split("/")[2];
  if (!current) return <Navigate to={`/settings/${available[0]!.path}`} replace />;
  if (!sections.some((section) => section.path === current)) return <Navigate to="/settings" replace />;
  const allowed = available.some((section) => section.path === current);

  return <>
    <Typography variant="overline" color="text.secondary">{t("nav.settings")}</Typography>
    <Box
      component="nav"
      aria-label={t("settingsNavigation.label")}
      sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: `repeat(${available.length}, minmax(0, 1fr))` }, gap: 1, mt: 1, mb: 3 }}
    >
      {available.map(({ path, icon: Icon }) => <Button
        key={path}
        component={Link}
        to={`/settings/${path}`}
        aria-current={current === path ? "page" : undefined}
        variant="outlined"
        sx={{
          justifyContent: "flex-start", textAlign: "left", minWidth: 0, px: 2, py: 1.5,
          color: current === path ? "primary.main" : "text.primary",
          borderColor: current === path ? "primary.main" : "divider",
          bgcolor: current === path ? "action.selected" : "background.paper",
          "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 3 },
        }}
      >
        <Icon sx={{ mr: 1.5, flexShrink: 0 }} />
        <Stack minWidth={0}>
          <Typography variant="body2" fontWeight={700}>{t(`settingsNavigation.${path}`)}</Typography>
          <Typography variant="caption" color="text.secondary">{t(`settingsNavigation.${path}Hint`)}</Typography>
        </Stack>
      </Button>)}
    </Box>
    {allowed ? <Outlet /> : <Alert severity="warning">{t("settingsNavigation.forbidden", { lng: "zh-CN" })}</Alert>}
  </>;
}
