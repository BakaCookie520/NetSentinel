import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  CssBaseline,
  Divider,
  IconButton,
  Paper,
  Stack,
  ThemeProvider,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  CheckCircleOutline,
  ErrorOutline,
  LanguageOutlined,
  OpenInNewOutlined,
  ShieldOutlined,
  WarningAmberOutlined,
} from "@mui/icons-material";
import { useQuery } from "@tanstack/react-query";
import type {
  PublicOverallStatus,
  PublicServiceStatus,
  PublicStatusDay,
} from "@netsentinel/contracts";
import { api } from "../api";
import { buildTheme, isThemeColor } from "../theme";

type Locale = "zh-CN" | "en-US";

const copy = {
  "zh-CN": {
    overall: {
      OPERATIONAL: "所有系统运行正常",
      DEGRADED: "部分服务性能波动",
      PARTIAL_OUTAGE: "部分服务中断",
      MAJOR_OUTAGE: "所有服务中断",
      MAINTENANCE: "服务维护中",
      NO_DATA: "暂无监测数据",
    },
    service: {
      OPERATIONAL: "运行正常",
      DEGRADED: "性能波动",
      OUTAGE: "服务中断",
      MAINTENANCE: "维护中",
      UNKNOWN: "状态未知",
    },
    uptime: "90 天可用率",
    updated: "最后更新",
    currentIncidents: "当前事件",
    recentIncidents: "近期事件",
    active: "处理中",
    resolved: "已恢复",
    noIncidents: "最近 90 天没有公开事件",
    noServices: "尚未公开任何监控服务",
    disabled: "公开状态页已关闭",
    disabledDescription: "此实例当前未提供公开服务状态。",
    failed: "无法加载服务状态",
    retry: "重新加载",
    support: "获取支持",
    dayNoData: "无数据",
    language: "切换为 English",
  },
  "en-US": {
    overall: {
      OPERATIONAL: "All systems operational",
      DEGRADED: "Some services are degraded",
      PARTIAL_OUTAGE: "Partial service outage",
      MAJOR_OUTAGE: "Major service outage",
      MAINTENANCE: "Services under maintenance",
      NO_DATA: "No monitoring data",
    },
    service: {
      OPERATIONAL: "Operational",
      DEGRADED: "Degraded",
      OUTAGE: "Outage",
      MAINTENANCE: "Maintenance",
      UNKNOWN: "Unknown",
    },
    uptime: "90-day uptime",
    updated: "Last updated",
    currentIncidents: "Current incidents",
    recentIncidents: "Recent incidents",
    active: "Investigating",
    resolved: "Resolved",
    noIncidents: "No public incidents in the past 90 days",
    noServices: "No monitors are published yet",
    disabled: "Public status page is disabled",
    disabledDescription: "This instance is not currently publishing service status.",
    failed: "Unable to load service status",
    retry: "Reload",
    support: "Get support",
    dayNoData: "No data",
    language: "切换为简体中文",
  },
} as const;

function statusColor(status: PublicServiceStatus | PublicStatusDay["status"]): string {
  if (status === "OPERATIONAL") return "success.main";
  if (status === "DEGRADED") return "warning.main";
  if (status === "OUTAGE") return "error.main";
  if (status === "MAINTENANCE") return "primary.main";
  return "text.disabled";
}

function overallSeverity(status: PublicOverallStatus) {
  if (status === "OPERATIONAL") return { color: "success.main", icon: <CheckCircleOutline /> };
  if (status === "MAJOR_OUTAGE" || status === "PARTIAL_OUTAGE") return { color: "error.main", icon: <ErrorOutline /> };
  if (status === "DEGRADED") return { color: "warning.main", icon: <WarningAmberOutlined /> };
  return { color: "primary.main", icon: <ShieldOutlined /> };
}

function UptimeHistory({ history, locale }: { history: PublicStatusDay[]; locale: Locale }) {
  const messages = copy[locale];
  return (
    <Box
      aria-label={messages.uptime}
      sx={{ display: "grid", gridTemplateColumns: `repeat(${history.length}, minmax(1px, 1fr))`, gap: "1px", height: 32, minWidth: 0 }}
    >
      {history.map((day) => (
        <Tooltip
          key={day.date}
          title={`${day.date} · ${day.uptimePercent === null ? messages.dayNoData : `${day.uptimePercent.toFixed(3)}%`}`}
          arrow
        >
          <Box
            sx={{ bgcolor: statusColor(day.status), opacity: day.status === "NO_DATA" ? 0.28 : 0.9, borderRadius: "2px", minWidth: 0 }}
          />
        </Tooltip>
      ))}
    </Box>
  );
}

export function PublicStatusPage() {
  const [visible, setVisible] = useState(!document.hidden);
  const [systemDark, setSystemDark] = useState(window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [locale, setLocale] = useState<Locale>(() => {
    const stored = localStorage.getItem("netsentinel.status.locale");
    if (stored === "zh-CN" || stored === "en-US") return stored;
    return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
  });
  const query = useQuery({
    queryKey: ["public-status"],
    queryFn: api.publicStatus,
    refetchInterval: visible ? 30_000 : false,
    retry: 1,
  });
  useEffect(() => {
    const onVisibility = () => {
      const next = !document.hidden;
      setVisible(next);
      if (next) void query.refetch();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [query.refetch]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  const themeColor = isThemeColor(query.data?.themeColor) ? query.data.themeColor : "sky";
  const theme = useMemo(() => buildTheme(systemDark ? "dark" : "light", themeColor), [systemDark, themeColor]);
  const messages = copy[locale];
  const toggleLocale = () => {
    const next = locale === "zh-CN" ? "en-US" : "zh-CN";
    localStorage.setItem("netsentinel.status.locale", next);
    setLocale(next);
  };
  const status = query.data?.overallStatus ?? "NO_DATA";
  const severity = overallSeverity(status);
  const incidents = query.data?.incidents ?? [];

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: "100vh", bgcolor: "background.default", color: "text.primary" }}>
        <Box component="header" sx={{ borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ maxWidth: 1040, mx: "auto", px: { xs: 2, sm: 3 }, height: 68 }}>
            <Stack direction="row" gap={1.25} alignItems="center">
              <Box sx={{ display: "grid", placeItems: "center", width: 36, height: 36, bgcolor: "primary.main", color: "primary.contrastText", borderRadius: 1 }}>
                <ShieldOutlined fontSize="small" />
              </Box>
              <Typography fontWeight={750}>{query.data?.title ?? "NetSentinel Status"}</Typography>
            </Stack>
            <Tooltip title={messages.language}>
              <IconButton aria-label={messages.language} onClick={toggleLocale}><LanguageOutlined /></IconButton>
            </Tooltip>
          </Stack>
        </Box>

        <Box component="main" sx={{ width: "100%", maxWidth: 1040, mx: "auto", px: { xs: 2, sm: 3 }, py: { xs: 3, sm: 5 } }}>
          {query.isLoading ? (
            <Box sx={{ minHeight: 360, display: "grid", placeItems: "center" }}><CircularProgress aria-label="loading" /></Box>
          ) : query.isError ? (
            <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
              <Typography variant="h2">{messages.failed}</Typography>
              <Button sx={{ mt: 2 }} variant="contained" onClick={() => void query.refetch()}>{messages.retry}</Button>
            </Paper>
          ) : !query.data?.enabled ? (
            <Paper variant="outlined" sx={{ p: { xs: 3, sm: 5 }, textAlign: "center" }}>
              <ShieldOutlined sx={{ fontSize: 38, color: "text.secondary" }} />
              <Typography variant="h1" sx={{ mt: 1 }}>{messages.disabled}</Typography>
              <Typography color="text.secondary" sx={{ mt: 1 }}>{messages.disabledDescription}</Typography>
            </Paper>
          ) : (
            <Stack gap={4}>
              <Box>
                <Typography variant="h1">{query.data.title}</Typography>
                {query.data.description && <Typography color="text.secondary" sx={{ mt: 1, maxWidth: 720 }}>{query.data.description}</Typography>}
              </Box>

              <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 }, borderLeft: 4, borderLeftColor: severity.color }}>
                <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ sm: "center" }} justifyContent="space-between" gap={2}>
                  <Stack direction="row" gap={1.5} alignItems="center" sx={{ color: severity.color }}>
                    {severity.icon}
                    <Typography variant="h2" color="text.primary">{messages.overall[status]}</Typography>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {messages.updated} · {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(query.data.generatedAt))}
                  </Typography>
                </Stack>
              </Paper>

              {(query.data.groups ?? []).length === 0 ? (
                <Paper variant="outlined" sx={{ p: 4, textAlign: "center", color: "text.secondary" }}>{messages.noServices}</Paper>
              ) : (query.data.groups ?? []).map((group) => (
                <Box component="section" key={group.name}>
                  <Typography variant="h2" sx={{ mb: 1.5 }}>{group.name}</Typography>
                  <Paper variant="outlined">
                    {group.services.map((service, index) => (
                      <Box key={service.id}>
                        {index > 0 && <Divider />}
                        <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
                          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
                            <Typography fontWeight={700}>{service.name}</Typography>
                            <Chip size="small" label={messages.service[service.status]} sx={{ color: statusColor(service.status), bgcolor: "action.hover" }} />
                          </Stack>
                          <Stack direction={{ xs: "column", sm: "row" }} gap={{ xs: 1, sm: 2 }} alignItems={{ sm: "center" }} sx={{ mt: 2 }}>
                            <Box sx={{ flex: 1, minWidth: 0 }}><UptimeHistory history={service.history} locale={locale} /></Box>
                            <Typography variant="body2" sx={{ width: { sm: 150 }, textAlign: { sm: "right" }, whiteSpace: "nowrap" }}>
                              {messages.uptime} · {service.uptimePercent === null ? "-" : `${service.uptimePercent.toFixed(3)}%`}
                            </Typography>
                          </Stack>
                        </Box>
                      </Box>
                    ))}
                  </Paper>
                </Box>
              ))}

              <Box component="section">
                <Typography variant="h2" sx={{ mb: 1.5 }}>{incidents.some((incident) => incident.status === "ACTIVE") ? messages.currentIncidents : messages.recentIncidents}</Typography>
                <Paper variant="outlined" sx={{ px: { xs: 2, sm: 2.5 } }}>
                  {incidents.length === 0 ? (
                    <Typography color="text.secondary" sx={{ py: 3 }}>{messages.noIncidents}</Typography>
                  ) : incidents.map((incident, index) => (
                    <Box key={incident.id}>
                      {index > 0 && <Divider />}
                      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" gap={1} sx={{ py: 2 }}>
                        <Box>
                          <Typography fontWeight={700}>{incident.serviceName}</Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                            {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(incident.startedAt))}
                            {incident.resolvedAt ? ` – ${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(incident.resolvedAt))}` : ""}
                          </Typography>
                        </Box>
                        <Chip size="small" color={incident.status === "ACTIVE" ? "error" : "success"} label={incident.status === "ACTIVE" ? messages.active : messages.resolved} />
                      </Stack>
                    </Box>
                  ))}
                </Paper>
              </Box>

              <Stack component="footer" direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} gap={2} sx={{ pt: 1, color: "text.secondary" }}>
                <Typography variant="caption">NetSentinel</Typography>
                {query.data.supportUrl && (
                  <Button component="a" href={query.data.supportUrl} target="_blank" rel="noopener noreferrer" size="small" endIcon={<OpenInNewOutlined />}>{messages.support}</Button>
                )}
              </Stack>
            </Stack>
          )}
        </Box>
      </Box>
    </ThemeProvider>
  );
}
