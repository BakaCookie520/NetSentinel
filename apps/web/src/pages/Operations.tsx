import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import {
  AddOutlined,
  ArrowForwardOutlined,
  CheckCircleOutline,
  CloseOutlined,
  DnsOutlined,
  DeleteOutline,
  EditOutlined,
  ErrorOutline,
  HourglassTopOutlined,
  HttpOutlined,
  LanOutlined,
  MoreHorizOutlined,
  PauseOutlined,
  PlayArrowOutlined,
  RefreshOutlined,
  RouterOutlined,
  SearchOutlined,
  TaskAltOutlined,
  TimerOutlined,
  WifiTetheringOutlined,
} from "@mui/icons-material";
import { LineChart } from "@mui/x-charts/LineChart";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, type Monitor, type MonitorType } from "../api";
import { PageHeader, RelativeTime, StatusChip } from "../components";
import { MonitorEditorDialog } from "../typed-forms";
import {
  feedbackMessage,
  useActionFeedback,
  useCommandMutation,
} from "../action-feedback";

function Metric({
  label,
  value,
  note,
  color,
  icon,
}: {
  label: string;
  value: string | number;
  note: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <Card variant="outlined">
      <CardContent sx={{ p: "16px!important" }}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="flex-start"
        >
          <Box>
            <Typography variant="body2" color="text.secondary">
              {label}
            </Typography>
            <Typography sx={{ fontSize: 27, fontWeight: 750, mt: 0.5 }}>
              {value}
            </Typography>
          </Box>
          <Box
            sx={{
              color,
              width: 34,
              height: 34,
              display: "grid",
              placeItems: "center",
              bgcolor: `${color}14`,
              borderRadius: 1,
            }}
          >
            {icon}
          </Box>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {note}
        </Typography>
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}
      >
        <Typography variant="h2">{title}</Typography>
        {action}
      </Stack>
      {children}
    </Paper>
  );
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const client = useQueryClient();
  const { runCommand } = useActionFeedback();
  const [refreshing, setRefreshing] = useState(false);
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
  });
  const incidentQuery = useQuery({
    queryKey: ["incidents"],
    queryFn: api.incidents,
  });
  const approvalQuery = useQuery({
    queryKey: ["approvals"],
    queryFn: api.approvals,
  });
  const decide = useCommandMutation({
    mutationFn: ({
      id,
      decision,
    }: {
      id: string;
      decision: "approve" | "reject";
    }) => api.decideApproval(id, decision),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["approvals"] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
    },
    successMessage: (_result, variables) =>
      feedbackMessage(
        variables.decision === "reject"
          ? "feedback.command.approvalRejected"
          : "feedback.command.approvalApproved",
      ),
    trackRun: (result, variables) =>
      variables.decision === "approve" && "workflowId" in result
        ? { run: result, label: result.workflow.name }
        : null,
  });
  const monitors = dashboard.data?.monitors ?? [];
  const up = monitors.filter((item) => item.status === "UP").length;
  const degraded = monitors.filter((item) => item.status === "DEGRADED").length;
  const down = monitors.filter((item) => item.status === "DOWN").length;
  const latencyTrend = dashboard.data?.latencyTrend ?? [];
  const latencyLabels = latencyTrend.map((point) =>
    new Intl.DateTimeFormat(i18n.language, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(point.bucket)),
  );
  return (
    <>
      <PageHeader
        title={t("dashboard.title")}
        subtitle={t("dashboard.subtitle")}
        action={
          <Button
            startIcon={<RefreshOutlined />}
            variant="outlined"
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true);
              void runCommand(
                () => client.refetchQueries({ type: "active" }),
                {
                  successMessage: feedbackMessage("feedback.command.dashboardRefreshed"),
                  errorMessage: feedbackMessage("feedback.command.dashboardRefreshFailed"),
                },
              ).finally(() => setRefreshing(false));
            }}
          >
            {refreshing ? "刷新中" : t("dashboard.refresh")}
          </Button>
        }
      />
      {api.isDemo && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t("dashboard.demo")}
        </Alert>
      )}
      <Box className="metric-grid" sx={{ mb: 2 }}>
        <Metric
          label={t("dashboard.healthy")}
          value={up}
          note={t("dashboard.total", { count: monitors.length })}
          color={theme.palette.success.main}
          icon={<CheckCircleOutline />}
        />
        <Metric
          label={t("dashboard.degraded")}
          value={degraded}
          note={t("dashboard.near", { count: degraded })}
          color="#a96608"
          icon={<TimerOutlined />}
        />
        <Metric
          label={t("dashboard.down")}
          value={down}
          note={t("dashboard.unresolved", {
            count: dashboard.data?.openIncidents ?? 0,
          })}
          color="#bd342f"
          icon={<ErrorOutline />}
        />
        <Metric
          label={t("dashboard.uptime")}
          value={dashboard.data?.uptimePercent == null ? "--" : `${dashboard.data.uptimePercent}%`}
          note={
            dashboard.data?.probeResults24h
              ? t("dashboard.samples", { count: dashboard.data.probeResults24h })
              : t("dashboard.noProbeData")
          }
          color={theme.palette.primary.main}
          icon={<WifiTetheringOutlined />}
        />
      </Box>
      <Box className="content-grid">
        <Stack gap={2} minWidth={0}>
          <Section
            title={t("dashboard.response")}
            action={
              <Stack direction="row" gap={1}>
                <Chip
                  size="small"
                  label={t("dashboard.range")}
                  variant="outlined"
                />
              </Stack>
            }
          >
            {latencyTrend.length > 0 ? (
            <Box data-testid="dashboard-latency-chart" sx={{ height: 270, p: 1 }}>
              <LineChart
                height={255}
                xAxis={[
                  {
                    scaleType: "point",
                    data: latencyLabels,
                  },
                ]}
                yAxis={[{ min: 0 }]}
                series={[
                  {
                    data: latencyTrend.map((point) => point.p50Ms),
                    label: t("dashboard.p50"),
                    color: theme.palette.primary.main,
                    area: true,
                    showMark: false,
                  },
                ]}
                grid={{ horizontal: true }}
                margin={{ left: 45, right: 15, top: 25, bottom: 25 }}
              />
            </Box>
            ) : (
              <Box
                data-testid="dashboard-latency-empty"
                sx={{ height: 270, display: "grid", placeItems: "center", p: 2 }}
              >
                <Typography color="text.secondary">
                  {t("dashboard.noLatencyData")}
                </Typography>
              </Box>
            )}
          </Section>
          <Section
            title={t("dashboard.activeIncidents")}
            action={
              <Button
                size="small"
                endIcon={<ArrowForwardOutlined />}
                href="/incidents"
              >
                {t("dashboard.viewAll")}
              </Button>
            }
          >
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t("dashboard.incident")}</TableCell>
                    <TableCell>{t("common.status")}</TableCell>
                    <TableCell>{t("dashboard.owner")}</TableCell>
                    <TableCell>{t("dashboard.started")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(incidentQuery.data ?? []).map((incident) => (
                    <TableRow key={incident.id} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight={650}>
                          {incident.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {incident.monitor.name}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          color={
                            incident.status === "OPEN" ? "error" : "warning"
                          }
                          label={
                            incident.status === "OPEN"
                              ? t("dashboard.open")
                              : t("dashboard.acknowledged")
                          }
                        />
                      </TableCell>
                      <TableCell>
                        {incident.assignee?.displayName ??
                          t("dashboard.unassigned")}
                      </TableCell>
                      <TableCell>
                        <RelativeTime value={incident.openedAt} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Section>
        </Stack>
        <Stack gap={2}>
          <Section
            title={t("dashboard.pending")}
            action={
              <Chip
                color="warning"
                size="small"
                label={t("dashboard.items", {
                  count: approvalQuery.data?.length ?? 0,
                })}
              />
            }
          >
            {(approvalQuery.data ?? []).length ? (
              <Stack divider={<Divider />} sx={{ px: 2 }}>
                {approvalQuery.data!.map((approval) => (
                  <Box key={approval.id} sx={{ py: 2 }}>
                    <Stack direction="row" gap={1.25} alignItems="flex-start">
                      <Box sx={{ mt: 0.25, color: "warning.main" }}>
                        <HourglassTopOutlined fontSize="small" />
                      </Box>
                      <Box minWidth={0}>
                        <Typography fontWeight={700} variant="body2">
                          {approval.workflow.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t("dashboard.triggered", {
                            name: approval.incident.monitor.name,
                          })}
                        </Typography>
                        <Typography
                          variant="caption"
                          display="block"
                          color="warning.main"
                          sx={{ mt: 0.75 }}
                        >
                          {t("dashboard.expires")}
                        </Typography>
                      </Box>
                    </Stack>
                    <Stack direction="row" gap={1} sx={{ mt: 1.5 }}>
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<TaskAltOutlined />}
                        disabled={
                          decide.isPending && decide.variables?.id === approval.id
                        }
                        onClick={() =>
                          decide.mutate({
                            id: approval.id,
                            decision: "approve",
                          })
                        }
                      >
                        {decide.isPending &&
                        decide.variables?.id === approval.id &&
                        decide.variables.decision === "approve"
                          ? "处理中"
                          : t("dashboard.approve")}
                      </Button>
                      <Button
                        size="small"
                        color="inherit"
                        disabled={
                          decide.isPending && decide.variables?.id === approval.id
                        }
                        onClick={() =>
                          decide.mutate({ id: approval.id, decision: "reject" })
                        }
                      >
                        {decide.isPending &&
                        decide.variables?.id === approval.id &&
                        decide.variables.decision === "reject"
                          ? "处理中"
                          : t("dashboard.reject")}
                      </Button>
                    </Stack>
                  </Box>
                ))}
              </Stack>
            ) : (
              <Box sx={{ p: 3, textAlign: "center" }}>
                <TaskAltOutlined color="success" />
                <Typography variant="body2">{t("dashboard.none")}</Typography>
              </Box>
            )}
          </Section>
          <Section title={t("dashboard.monitorStatus")}>
            <Stack sx={{ p: 2 }} gap={1.5}>
              {monitors.slice(0, 5).map((monitor) => (
                <Stack
                  key={monitor.id}
                  direction="row"
                  alignItems="center"
                  gap={1}
                >
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      bgcolor:
                        monitor.status === "UP"
                          ? "success.main"
                          : monitor.status === "DOWN"
                            ? "error.main"
                            : "warning.main",
                    }}
                  />
                  <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                    {monitor.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {monitor.latencyMs ? `${monitor.latencyMs} ms` : "—"}
                  </Typography>
                </Stack>
              ))}
              <Button size="small" href="/monitors">
                {t("dashboard.manage")}
              </Button>
            </Stack>
          </Section>
        </Stack>
      </Box>
    </>
  );
}

const protocolIcons: Record<MonitorType, React.ReactNode> = {
  HTTP: <HttpOutlined fontSize="small" />,
  WEBSOCKET: <WifiTetheringOutlined fontSize="small" />,
  TCP: <LanOutlined fontSize="small" />,
  ICMP: <RouterOutlined fontSize="small" />,
};

function ConnectedMonitorDetails({
  monitor,
  onClose,
  onEdit,
}: {
  monitor: Monitor | null;
  onClose: () => void;
  onEdit: (monitor: Monitor) => void;
}) {
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ["monitor", monitor?.id],
    queryFn: () => api.monitor(monitor!.id),
    enabled: Boolean(monitor),
  });
  const activeMonitor = detail.data ?? monitor;
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["monitors"] }),
      client.invalidateQueries({ queryKey: ["dashboard"] }),
      client.invalidateQueries({ queryKey: ["runtime-logs"] }),
    ]);
  };
  const check = useCommandMutation({
    mutationFn: async () => {
      if (!activeMonitor) throw new Error("监控不存在");
      const previousCheckedAt = activeMonitor.lastCheckedAt;
      await api.checkMonitor(activeMonitor.id);
      const timeoutMs = Math.min(
        60_000,
        Math.max(15_000, activeMonitor.timeoutMs + 10_000),
      );
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        const updated = await api.monitor(activeMonitor.id);
        if (updated.lastCheckedAt !== previousCheckedAt) return updated;
      }
      throw new Error(
        `探测任务已入队，但 worker 未在 ${Math.round(timeoutMs / 1_000)} 秒内完成`,
      );
    },
    onSuccess: async (updated) => {
      client.setQueryData(["monitor", updated.id], updated);
      await refresh();
    },
    successMessage: (updated) => {
      const result = updated.results?.[0];
      if (result?.ok) return feedbackMessage("feedback.command.probeAvailable");
      if (result?.statusCode)
        return feedbackMessage("feedback.command.probeHttpUnavailable", {
          status: result.statusCode,
        });
      return feedbackMessage("feedback.command.probeUnavailable");
    },
    errorMessage: feedbackMessage("feedback.command.probeFailed"),
  });
  const pause = useCommandMutation({
    mutationFn: () =>
      api.setMonitorPaused(
        activeMonitor!.id,
        activeMonitor!.version,
        activeMonitor!.status !== "PAUSED",
      ),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
    successMessage: () =>
      feedbackMessage(
        activeMonitor?.status === "PAUSED"
          ? "feedback.command.monitorResumed"
          : "feedback.command.monitorPaused",
      ),
  });
  const remove = useCommandMutation({
    mutationFn: () => api.deleteMonitor(activeMonitor!.id),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
    successMessage: feedbackMessage("feedback.command.monitorDeleted"),
  });
  if (!activeMonitor) return <Drawer anchor="right" open={false} />;
  const insecure =
    (activeMonitor.type === "HTTP" || activeMonitor.type === "WEBSOCKET") &&
    (activeMonitor.config as { verifyTls?: boolean }).verifyTls === false;
  const latestResult = activeMonitor.results?.[0];
  const resultLabel = latestResult
    ? latestResult.ok
      ? "成功"
      : latestResult.statusCode
        ? `HTTP ${latestResult.statusCode}`
        : latestResult.errorCode || "失败"
    : "尚无结果";
  return (
    <Drawer
      anchor="right"
      open
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: "100%", sm: 480 } } }}
    >
      <Stack
        direction="row"
        alignItems="center"
        sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}
      >
        <Box flex={1}>
          <Typography variant="h2">{activeMonitor.name}</Typography>
          <Typography variant="caption" color="text.secondary">
            {activeMonitor.target}
          </Typography>
        </Box>
        <IconButton aria-label="关闭监控详情" onClick={onClose}>
          <CloseOutlined />
        </IconButton>
      </Stack>
      <Stack gap={2} sx={{ p: 2.5 }}>
        <Stack direction="row" gap={2} alignItems="flex-start" flexWrap="wrap">
          <Stack gap={0.5}>
            <Typography variant="caption" color="text.secondary">
              运行状态
            </Typography>
            <StatusChip status={activeMonitor.status} />
          </Stack>
          <Stack gap={0.5}>
            <Typography variant="caption" color="text.secondary">
              配置状态
            </Typography>
            <Chip
              color={activeMonitor.configurationComplete ? "success" : "error"}
              variant="outlined"
              size="small"
              label={
                activeMonitor.configurationComplete ? "配置完整" : "配置不完整"
              }
            />
          </Stack>
          {insecure && (
            <Stack gap={0.5}>
              <Typography variant="caption" color="text.secondary">
                TLS
              </Typography>
              <Chip color="warning" size="small" label="校验已关闭" />
            </Stack>
          )}
        </Stack>
        {activeMonitor.configurationComplete &&
          activeMonitor.status === "DOWN" && (
            <Alert severity="info">
              配置完整表示探测参数可以执行；“中断”表示最近探测未满足成功条件。
            </Alert>
          )}
        {insecure && (
          <Alert severity="warning">
            该监控不会验证远端 TLS 证书，请尽快恢复严格校验。
          </Alert>
        )}
        <Stack direction="row" flexWrap="wrap" gap={1}>
          <Button
            variant="contained"
            startIcon={
              check.isPending ? (
                <CircularProgress color="inherit" size={16} />
              ) : (
                <PlayArrowOutlined />
              )
            }
            disabled={
              !activeMonitor.configurationComplete ||
              activeMonitor.status === "PAUSED" ||
              check.isPending
            }
            onClick={() => check.mutate()}
          >
            {check.isPending ? "正在探测" : "立即探测"}
          </Button>
          <Button
            startIcon={<EditOutlined />}
            onClick={() => onEdit(activeMonitor)}
          >
            编辑
          </Button>
          <Button
            startIcon={
              activeMonitor.status === "PAUSED" ? (
                <PlayArrowOutlined />
              ) : (
                <PauseOutlined />
              )
            }
            onClick={() => pause.mutate()}
            disabled={pause.isPending || remove.isPending}
          >
            {pause.isPending
              ? "处理中"
              : activeMonitor.status === "PAUSED"
                ? "恢复"
                : "暂停"}
          </Button>
          <Button
            color="error"
            startIcon={<CloseOutlined />}
            disabled={remove.isPending || pause.isPending}
            onClick={() => {
              if (window.confirm(`确定删除监控“${activeMonitor.name}”吗？`))
                remove.mutate();
            }}
          >
            {remove.isPending ? "删除中" : "删除"}
          </Button>
        </Stack>
        <Divider />
        <Typography variant="h3">最近结果</Typography>
        <Stack divider={<Divider />}>
          <Stack direction="row" justifyContent="space-between" gap={2} py={1}>
            <Typography color="text.secondary">结果</Typography>
            <Typography fontWeight={700}>{resultLabel}</Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between" gap={2} py={1}>
            <Typography color="text.secondary">检查时间</Typography>
            <Typography>
              {activeMonitor.lastCheckedAt
                ? new Date(activeMonitor.lastCheckedAt).toLocaleString("zh-CN")
                : "-"}
            </Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between" gap={2} py={1}>
            <Typography color="text.secondary">耗时</Typography>
            <Typography>
              {activeMonitor.latencyMs === null
                ? "-"
                : `${activeMonitor.latencyMs} ms`}
            </Typography>
          </Stack>
          {latestResult?.errorMessage && (
            <Stack
              direction="row"
              justifyContent="space-between"
              gap={2}
              py={1}
            >
              <Typography color="text.secondary">错误</Typography>
              <Typography textAlign="right">
                {latestResult.errorMessage}
              </Typography>
            </Stack>
          )}
        </Stack>
        <Divider />
        <Typography variant="h3">探测策略</Typography>
        <Stack divider={<Divider />}>
          <Stack direction="row" justifyContent="space-between" py={1}>
            <Typography color="text.secondary">协议</Typography>
            <Typography>{activeMonitor.type}</Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between" py={1}>
            <Typography color="text.secondary">检查间隔</Typography>
            <Typography>{activeMonitor.intervalSeconds} 秒</Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between" py={1}>
            <Typography color="text.secondary">失败 / 恢复阈值</Typography>
            <Typography>
              {activeMonitor.failureThreshold} /{" "}
              {activeMonitor.recoveryThreshold}
            </Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between" py={1}>
            <Typography color="text.secondary">连续失败 / 成功</Typography>
            <Typography>
              {activeMonitor.consecutiveFailures ?? 0} /{" "}
              {activeMonitor.consecutiveSuccesses ?? 0}
            </Typography>
          </Stack>
        </Stack>
      </Stack>
    </Drawer>
  );
}

export function MonitorsPage() {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<Monitor | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [selected, setSelected] = useState<Monitor | null>(null);
  const query = useQuery({ queryKey: ["monitors"], queryFn: api.monitors });
  const rows = useMemo(
    () =>
      (query.data ?? []).filter(
        (monitor) =>
          (status === "ALL" || monitor.status === status) &&
          `${monitor.name} ${monitor.target} ${monitor.tags.join(" ")}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [query.data, search, status],
  );
  return (
    <>
      <PageHeader
        title={t("monitors.title")}
        subtitle={t("monitors.subtitle")}
        action={
          <Button
            variant="contained"
            startIcon={<AddOutlined />}
            onClick={() => setDialog(true)}
          >
            {t("monitors.add")}
          </Button>
        }
      />
      <Paper variant="outlined">
        <Stack
          direction={{ xs: "column", md: "row" }}
          gap={1.5}
          sx={{ p: 1.5, borderBottom: 1, borderColor: "divider" }}
        >
          <TextField
            size="small"
            placeholder="搜索名称、目标或标签"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            sx={{ width: { xs: "100%", md: 330 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchOutlined fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <ToggleButtonGroup
            exclusive
            size="small"
            value={status}
            onChange={(_event, value) => value && setStatus(value)}
          >
            {["ALL", "UP", "DEGRADED", "DOWN", "PAUSED"].map((item) => (
              <ToggleButton key={item} value={item}>
                {item === "ALL" ? "全部" : item}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Box flex={1} />
        </Stack>
        {query.isLoading && <LinearProgress />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>监控</TableCell>
                <TableCell>协议</TableCell>
                <TableCell>状态</TableCell>
                <TableCell>延迟</TableCell>
                <TableCell>标签</TableCell>
                <TableCell>上次检查</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((monitor) => (
                <TableRow
                  key={monitor.id}
                  hover
                  onClick={() => setSelected(monitor)}
                  sx={{ cursor: "pointer" }}
                >
                  <TableCell>
                    <Typography variant="body2" fontWeight={700}>
                      {monitor.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {monitor.target}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" alignItems="center" gap={0.75}>
                      {protocolIcons[monitor.type]}
                      <Typography variant="body2">{monitor.type}</Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <StatusChip status={monitor.status} />
                  </TableCell>
                  <TableCell>
                    {monitor.latencyMs ? `${monitor.latencyMs} ms` : "—"}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" gap={0.5}>
                      {monitor.tags.slice(0, 2).map((tag) => (
                        <Chip
                          key={tag}
                          size="small"
                          label={tag}
                          variant="outlined"
                        />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <RelativeTime value={monitor.lastCheckedAt} />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      aria-label="打开监控详情"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelected(monitor);
                      }}
                    >
                      <MoreHorizOutlined />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      <MonitorEditorDialog
        open={dialog || Boolean(editing)}
        monitor={editing}
        onClose={() => {
          setDialog(false);
          setEditing(null);
        }}
      />
      <ConnectedMonitorDetails
        monitor={selected}
        onClose={() => setSelected(null)}
        onEdit={(monitor) => {
          setSelected(null);
          setEditing(monitor);
        }}
      />
    </>
  );
}

export function IncidentsPage() {
  const client = useQueryClient();
  const [tab, setTab] = useState(0);
  const compact = useMediaQuery(useTheme().breakpoints.down("sm"));
  const incidents = useQuery({
    queryKey: ["incidents"],
    queryFn: api.incidents,
  });
  const approvals = useQuery({
    queryKey: ["approvals"],
    queryFn: api.approvals,
  });
  const ack = useCommandMutation({
    mutationFn: api.acknowledge,
    onSuccess: () => void client.invalidateQueries({ queryKey: ["incidents"] }),
    successMessage: feedbackMessage("feedback.command.incidentAcknowledged"),
  });
  const remove = useCommandMutation({
    mutationFn: api.deleteIncident,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["incidents"] });
      void client.invalidateQueries({ queryKey: ["approvals"] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
    },
    successMessage: feedbackMessage("feedback.command.incidentDeleted"),
  });
  const decide = useCommandMutation({
    mutationFn: ({
      id,
      decision,
    }: {
      id: string;
      decision: "approve" | "reject";
    }) => api.decideApproval(id, decision),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["approvals"] }),
    successMessage: (_result, variables) =>
      feedbackMessage(
        variables.decision === "reject"
          ? "feedback.command.approvalRejected"
          : "feedback.command.approvalApproved",
      ),
    trackRun: (result, variables) =>
      variables.decision === "approve" && "workflowId" in result
        ? { run: result, label: result.workflow.name }
        : null,
  });
  const incidentContent = compact ? (
    <Stack divider={<Divider />}>
      {(incidents.data ?? []).map((incident) => (
        <Box key={incident.id} sx={{ p: 2 }}>
          <Stack
            direction="row"
            alignItems="flex-start"
            justifyContent="space-between"
            gap={1}
          >
            <Box minWidth={0}>
              <Typography fontWeight={700}>{incident.title}</Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                {incident.monitor.name}
              </Typography>
            </Box>
            <Chip
              size="small"
              color={incident.status === "OPEN" ? "error" : "warning"}
              label={incident.status === "OPEN" ? "待处理" : "已确认"}
            />
          </Stack>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            sx={{ mt: 2 }}
          >
            <Box>
              <Typography variant="caption" color="text.secondary">
                负责人：{incident.assignee?.displayName ?? "未指派"}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
              >
                <RelativeTime value={incident.openedAt} />
              </Typography>
            </Box>
            <Stack direction="row" gap={0.5} alignItems="center">
              <Button
                size="small"
                variant={incident.status === "OPEN" ? "contained" : "outlined"}
                disabled={
                  incident.status !== "OPEN" ||
                  (ack.isPending && ack.variables === incident.id)
                }
                onClick={() => ack.mutate(incident.id)}
              >
                {ack.isPending && ack.variables === incident.id ? "确认中" : "确认"}
              </Button>
              <IconButton
                size="small"
                color="error"
                aria-label={`删除事件 ${incident.title}`}
                disabled={remove.isPending && remove.variables === incident.id}
                onClick={() => {
                  if (window.confirm(`确认删除事件“${incident.title}”？此操作无法撤销。`)) {
                    remove.mutate(incident.id);
                  }
                }}
              >
                {remove.isPending && remove.variables === incident.id
                  ? <CircularProgress size={18} color="inherit" />
                  : <DeleteOutline fontSize="small" />}
              </IconButton>
            </Stack>
          </Stack>
        </Box>
      ))}
    </Stack>
  ) : (
    <TableContainer>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>事件</TableCell>
            <TableCell>状态</TableCell>
            <TableCell>负责人</TableCell>
            <TableCell>发生时间</TableCell>
            <TableCell align="right">操作</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(incidents.data ?? []).map((incident) => (
            <TableRow key={incident.id} hover>
              <TableCell>
                <Typography fontWeight={700}>{incident.title}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {incident.monitor.name}
                </Typography>
              </TableCell>
              <TableCell>
                <Chip
                  size="small"
                  color={incident.status === "OPEN" ? "error" : "warning"}
                  label={incident.status === "OPEN" ? "待处理" : "已确认"}
                />
              </TableCell>
              <TableCell>
                {incident.assignee?.displayName ?? "未指派"}
              </TableCell>
              <TableCell>
                <RelativeTime value={incident.openedAt} />
              </TableCell>
              <TableCell align="right">
                <Stack direction="row" gap={0.5} justifyContent="flex-end">
                  <Button
                    size="small"
                    variant={incident.status === "OPEN" ? "contained" : "text"}
                    disabled={
                      incident.status !== "OPEN" ||
                      (ack.isPending && ack.variables === incident.id)
                    }
                    onClick={() => ack.mutate(incident.id)}
                  >
                    {ack.isPending && ack.variables === incident.id
                      ? "确认中"
                      : "确认"}
                  </Button>
                  <IconButton
                    size="small"
                    color="error"
                    aria-label={`删除事件 ${incident.title}`}
                    disabled={remove.isPending && remove.variables === incident.id}
                    onClick={() => {
                      if (window.confirm(`确认删除事件“${incident.title}”？此操作无法撤销。`)) {
                        remove.mutate(incident.id);
                      }
                    }}
                  >
                    {remove.isPending && remove.variables === incident.id
                      ? <CircularProgress size={18} color="inherit" />
                      : <DeleteOutline fontSize="small" />}
                  </IconButton>
                </Stack>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
  return (
    <>
      <PageHeader
        title="事件响应"
        subtitle="确认服务中断、分配负责人并处理待审批自动化。"
      />
      <Paper variant="outlined">
        <Tabs
          value={tab}
          onChange={(_event, value) => setTab(value)}
          variant={compact ? "fullWidth" : "standard"}
          sx={{ px: compact ? 0 : 1, borderBottom: 1, borderColor: "divider" }}
        >
          <Tab label={`事件 (${incidents.data?.length ?? 0})`} />
          <Tab label={`待审批 (${approvals.data?.length ?? 0})`} />
        </Tabs>
        {tab === 0 ? (
          incidentContent
        ) : (
          <Stack divider={<Divider />}>
            {(approvals.data ?? []).map((approval) => (
              <Stack
                key={approval.id}
                direction={{ xs: "column", sm: "row" }}
                gap={2}
                alignItems={{ sm: "center" }}
                sx={{ p: 2 }}
              >
                <HourglassTopOutlined color="warning" />
                <Box flex={1}>
                  <Typography fontWeight={700}>
                    {approval.workflow.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    目标：{approval.incident.monitor.name} · 审批后按顺序执行
                  </Typography>
                </Box>
                <Stack direction="row" gap={1}>
                  <Button
                    variant="contained"
                    disabled={
                      decide.isPending && decide.variables?.id === approval.id
                    }
                    onClick={() =>
                      decide.mutate({ id: approval.id, decision: "approve" })
                    }
                  >
                    {decide.isPending &&
                    decide.variables?.id === approval.id &&
                    decide.variables.decision === "approve"
                      ? "处理中"
                      : "批准"}
                  </Button>
                  <Button
                    color="inherit"
                    disabled={
                      decide.isPending && decide.variables?.id === approval.id
                    }
                    onClick={() =>
                      decide.mutate({ id: approval.id, decision: "reject" })
                    }
                  >
                    {decide.isPending &&
                    decide.variables?.id === approval.id &&
                    decide.variables.decision === "reject"
                      ? "处理中"
                      : "拒绝"}
                  </Button>
                </Stack>
              </Stack>
            ))}
          </Stack>
        )}
      </Paper>
    </>
  );
}
