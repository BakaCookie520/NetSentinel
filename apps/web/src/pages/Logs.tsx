import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import {
  BoltOutlined,
  CheckCircleOutline,
  CloseOutlined,
  ErrorOutline,
  HourglassTopOutlined,
  RefreshOutlined,
  RouterOutlined,
  SearchOutlined,
} from "@mui/icons-material";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  api,
  type RuntimeLog,
  type RuntimeLogSource,
  type RuntimeLogStatus,
} from "../api";
import { PageHeader } from "../components";
import { feedbackMessage, useActionFeedback } from "../action-feedback";

type SourceFilter = "ALL" | RuntimeLogSource;
type StatusFilter = "ALL" | RuntimeLogStatus;

const statusPresentation: Record<
  RuntimeLogStatus,
  {
    label: string;
    color: "success" | "error" | "warning" | "default";
    icon: typeof CheckCircleOutline;
  }
> = {
  SUCCESS: { label: "成功", color: "success", icon: CheckCircleOutline },
  FAILURE: { label: "失败", color: "error", icon: ErrorOutline },
  IN_PROGRESS: {
    label: "执行中",
    color: "warning",
    icon: HourglassTopOutlined,
  },
  UNKNOWN: { label: "结果未知", color: "default", icon: ErrorOutline },
};

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatDuration(value?: number | null) {
  if (value === null || value === undefined) return "-";
  if (value < 1_000) return `${value} ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 2 : 1)} s`;
}

function StatusChip({ status }: { status: RuntimeLogStatus }) {
  const item = statusPresentation[status];
  const Icon = item.icon;
  return (
    <Chip
      size="small"
      color={item.color}
      variant={status === "SUCCESS" ? "outlined" : "filled"}
      icon={<Icon />}
      label={item.label}
      sx={{ minWidth: 82 }}
    />
  );
}

function SourceLabel({ source }: { source: RuntimeLogSource }) {
  const Icon = source === "PROBE" ? RouterOutlined : BoltOutlined;
  return (
    <Stack direction="row" gap={0.75} alignItems="center">
      <Icon
        fontSize="small"
        color={source === "PROBE" ? "primary" : "action"}
      />
      <Typography variant="body2">
        {source === "PROBE" ? "探测" : "动作"}
      </Typography>
    </Stack>
  );
}

function LogBlock({ children }: { children: string }) {
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 1.5,
        maxHeight: 280,
        overflow: "auto",
        bgcolor: "action.hover",
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      {children}
    </Box>
  );
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.25, overflowWrap: "anywhere" }}>
        {value || "-"}
      </Typography>
    </Box>
  );
}

function LogDetails({ log }: { log: RuntimeLog }) {
  return (
    <Stack gap={2.25}>
      <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
        <StatusChip status={log.status} />
        <SourceLabel source={log.source} />
      </Stack>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 2,
        }}
      >
        <DetailField
          label="发生时间"
          value={new Date(log.timestamp).toLocaleString("zh-CN")}
        />
        <DetailField label="耗时" value={formatDuration(log.durationMs)} />
        <DetailField label="监控" value={log.monitor?.name} />
        <DetailField label="记录 ID" value={log.id} />
      </Box>
      {log.source === "PROBE" ? (
        <>
          <Divider />
          <DetailField label="目标地址" value={log.monitor?.target} />
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 2,
            }}
          >
            <DetailField label="HTTP 状态码" value={log.details.statusCode} />
            <DetailField label="错误代码" value={log.details.errorCode} />
          </Box>
          {log.details.errorMessage && (
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
                sx={{ mb: 0.75 }}
              >
                错误详情
              </Typography>
              <LogBlock>{log.details.errorMessage}</LogBlock>
            </Box>
          )}
        </>
      ) : (
        <>
          <Divider />
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 2,
            }}
          >
            <DetailField label="触发方式" value={log.details.trigger} />
            <DetailField label="运行状态" value={log.details.runStatus} />
          </Box>
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              执行步骤
            </Typography>
            {log.details.steps.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                尚未生成步骤运行记录。
              </Typography>
            ) : (
              <Stack divider={<Divider flexItem />}>
                {log.details.steps.map((step) => (
                  <Box key={step.id} sx={{ py: 1.5 }}>
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      gap={2}
                      alignItems="flex-start"
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={700}>
                          {step.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {step.type} · 第 {step.attempt} 次 ·{" "}
                          {formatDuration(step.durationMs)}
                        </Typography>
                      </Box>
                      <Chip size="small" label={step.status} />
                    </Stack>
                    {step.errorMessage && (
                      <Box sx={{ mt: 1 }}>
                        <LogBlock>{step.errorMessage}</LogBlock>
                      </Box>
                    )}
                    {step.output && (
                      <Box sx={{ mt: 1 }}>
                        <LogBlock>{step.output}</LogBlock>
                      </Box>
                    )}
                  </Box>
                ))}
              </Stack>
            )}
          </Box>
        </>
      )}
    </Stack>
  );
}

export function LogsPage() {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down("md"));
  const [params, setParams] = useSearchParams();
  const requestedSource = params.get("source");
  const runId = params.get("runId") || undefined;
  const [source, setSource] = useState<SourceFilter>(
    requestedSource === "ACTION" || requestedSource === "PROBE"
      ? requestedSource
      : "ALL",
  );
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [monitorId, setMonitorId] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [selected, setSelected] = useState<RuntimeLog | null>(null);
  const dismissedRunId = useRef<string | null>(null);
  const { runCommand } = useActionFeedback();
  const monitors = useQuery({ queryKey: ["monitors"], queryFn: api.monitors });
  const query = useInfiniteQuery({
    queryKey: ["runtime-logs", source, status, monitorId, deferredSearch, runId],
    queryFn: ({ pageParam }) =>
      api.logs({
        source,
        status,
        monitorId: monitorId || undefined,
        runId,
        search: deferredSearch || undefined,
        cursor: pageParam || undefined,
        limit: 50,
      }),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: 10_000,
  });
  const logs = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  useEffect(() => {
    if (runId) setSource("ACTION");
  }, [runId]);
  useEffect(() => {
    if (!runId) {
      dismissedRunId.current = null;
      return;
    }
    if (selected || dismissedRunId.current === runId) return;
    const match = logs.find((log) => log.id === `action:${runId}`);
    if (match) setSelected(match);
  }, [logs, runId, selected]);
  const closeDetails = () => {
    if (runId) dismissedRunId.current = runId;
    setSelected(null);
    if (!runId) return;
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("runId");
      return next;
    }, { replace: true });
  };
  const resetFilters = () => {
    setSource("ALL");
    setStatus("ALL");
    setMonitorId("");
    setSearch("");
    setParams({});
  };
  const hasFilters =
    source !== "ALL" || status !== "ALL" || monitorId || search || runId;

  return (
    <>
      <PageHeader
        title="运行日志"
        subtitle="查询网络探测和自动化动作的执行结果与错误详情。"
        action={
          <Stack
            direction="row"
            gap={1}
            alignItems="center"
            justifyContent="flex-end"
          >
            <Typography variant="caption" color="text.secondary">
              每 10 秒刷新
            </Typography>
            <Tooltip title="立即刷新">
              <span>
                <IconButton
                  aria-label="立即刷新日志"
                  onClick={() =>
                    void runCommand(
                      async () => {
                        const result = await query.refetch();
                        if (result.error) throw result.error;
                        return result;
                      },
                      {
                        successMessage: feedbackMessage("feedback.command.logsRefreshed"),
                        errorMessage: feedbackMessage("feedback.command.logsRefreshFailed"),
                      },
                    )
                  }
                  disabled={query.isFetching}
                >
                  {query.isFetching ? (
                    <CircularProgress size={20} />
                  ) : (
                    <RefreshOutlined />
                  )}
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        }
      />

      <Box
        component="section"
        aria-label="日志筛选"
        sx={{
          pb: 2,
          mb: 2,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Stack gap={1.5}>
          <Stack direction={{ xs: "column", lg: "row" }} gap={1.5}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={source}
              onChange={(_, value: SourceFilter | null) =>
                value && setSource(value)
              }
              aria-label="日志来源"
              sx={{
                alignSelf: { xs: "stretch", lg: "center" },
                minWidth: { lg: 280 },
              }}
            >
              <ToggleButton value="ALL" sx={{ flex: 1 }}>
                全部
              </ToggleButton>
              <ToggleButton value="PROBE" sx={{ flex: 1 }}>
                探测
              </ToggleButton>
              <ToggleButton value="ACTION" sx={{ flex: 1 }}>
                动作
              </ToggleButton>
            </ToggleButtonGroup>
            <TextField
              select
              size="small"
              label="结果"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as StatusFilter)
              }
              sx={{ minWidth: { lg: 150 } }}
            >
              <MenuItem value="ALL">全部结果</MenuItem>
              <MenuItem value="SUCCESS">成功</MenuItem>
              <MenuItem value="FAILURE">失败</MenuItem>
              <MenuItem value="IN_PROGRESS">执行中</MenuItem>
              <MenuItem value="UNKNOWN">结果未知</MenuItem>
            </TextField>
            <TextField
              select
              size="small"
              label="监控"
              value={monitorId}
              onChange={(event) => setMonitorId(event.target.value)}
              sx={{ minWidth: { lg: 210 } }}
            >
              <MenuItem value="">全部监控</MenuItem>
              {(monitors.data ?? []).map((monitor) => (
                <MenuItem key={monitor.id} value={monitor.id}>
                  {monitor.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label="搜索日志"
              placeholder="监控、目标或错误内容"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              sx={{ flex: 1, minWidth: { lg: 240 } }}
              InputProps={{
                startAdornment: (
                  <SearchOutlined
                    fontSize="small"
                    sx={{ mr: 1, color: "text.secondary" }}
                  />
                ),
              }}
            />
            {hasFilters && (
              <Button onClick={resetFilters} sx={{ whiteSpace: "nowrap" }}>
                清除筛选
              </Button>
            )}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            当前显示 {logs.length} 条记录
          </Typography>
        </Stack>
      </Box>

      {query.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {query.error instanceof Error ? query.error.message : "日志加载失败"}
        </Alert>
      )}

      {query.isPending ? (
        <Stack gap={1} aria-label="正在加载日志">
          {Array.from({ length: 7 }, (_, index) => (
            <Skeleton key={index} variant="rounded" height={52} />
          ))}
        </Stack>
      ) : logs.length === 0 ? (
        <Paper variant="outlined" sx={{ py: 8, px: 2, textAlign: "center" }}>
          <RouterOutlined color="disabled" sx={{ fontSize: 38 }} />
          <Typography fontWeight={700} sx={{ mt: 1 }}>
            暂无运行日志
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {hasFilters
              ? "没有记录符合当前筛选条件。"
              : "监控完成探测或工作流开始执行后，记录会显示在这里。"}
          </Typography>
        </Paper>
      ) : (
        <>
          <TableContainer
            component={Paper}
            variant="outlined"
            sx={{ display: { xs: "none", md: "block" } }}
          >
            <Table size="small" aria-label="运行日志">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 148 }}>时间</TableCell>
                  <TableCell sx={{ width: 92 }}>来源</TableCell>
                  <TableCell sx={{ width: 112 }}>结果</TableCell>
                  <TableCell>记录</TableCell>
                  <TableCell sx={{ width: 180 }}>监控</TableCell>
                  <TableCell align="right" sx={{ width: 100 }}>
                    耗时
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {logs.map((log) => (
                  <TableRow
                    hover
                    key={log.id}
                    data-testid="runtime-log-row"
                    tabIndex={0}
                    aria-label={`查看日志 ${log.title}`}
                    onClick={() => setSelected(log)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ")
                        setSelected(log);
                    }}
                    sx={{ cursor: "pointer" }}
                  >
                    <TableCell>
                      <Typography
                        variant="body2"
                        sx={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {formatTimestamp(log.timestamp)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <SourceLabel source={log.source} />
                    </TableCell>
                    <TableCell>
                      <StatusChip status={log.status} />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 420 }}>
                      <Typography variant="body2" fontWeight={700} noWrap>
                        {log.title}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                        display="block"
                      >
                        {log.summary}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap>
                        {log.monitor?.name ?? "-"}
                      </Typography>
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {formatDuration(log.durationMs)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Paper
            variant="outlined"
            sx={{ display: { xs: "block", md: "none" }, overflow: "hidden" }}
          >
            <Stack
              divider={<Divider flexItem />}
              role="list"
              aria-label="运行日志"
            >
              {logs.map((log) => (
                <ButtonBase
                  key={log.id}
                  role="listitem"
                  onClick={() => setSelected(log)}
                  sx={{
                    width: "100%",
                    p: 1.5,
                    textAlign: "left",
                    alignItems: "stretch",
                  }}
                >
                  <Stack gap={1} sx={{ width: "100%", minWidth: 0 }}>
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      alignItems="center"
                      gap={1}
                    >
                      <SourceLabel source={log.source} />
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {formatTimestamp(log.timestamp)}
                      </Typography>
                    </Stack>
                    <Typography variant="body2" fontWeight={700} noWrap>
                      {log.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {log.monitor?.name ?? "未绑定监控"} · {log.summary}
                    </Typography>
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      alignItems="center"
                    >
                      <StatusChip status={log.status} />
                      <Typography variant="caption" color="text.secondary">
                        {formatDuration(log.durationMs)}
                      </Typography>
                    </Stack>
                  </Stack>
                </ButtonBase>
              ))}
            </Stack>
          </Paper>

          {query.hasNextPage && (
            <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
              <Button
                variant="outlined"
                onClick={() => void query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
              >
                {query.isFetchingNextPage ? "正在加载…" : "加载更多"}
              </Button>
            </Box>
          )}
        </>
      )}

      <Drawer
        anchor="right"
        open={Boolean(selected)}
        onClose={closeDetails}
        PaperProps={{
          sx: {
            width: mobile ? "100%" : 520,
            maxWidth: "100%",
          },
        }}
      >
        {selected && (
          <>
            <Stack
              direction="row"
              alignItems="flex-start"
              justifyContent="space-between"
              gap={2}
              sx={{ px: 2.5, py: 2, borderBottom: 1, borderColor: "divider" }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="h2">{selected.title}</Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.5 }}
                >
                  {selected.summary}
                </Typography>
              </Box>
              <IconButton
                aria-label="关闭日志详情"
                onClick={closeDetails}
              >
                <CloseOutlined />
              </IconButton>
            </Stack>
            <Box sx={{ p: 2.5, overflowY: "auto" }}>
              <LogDetails log={selected} />
            </Box>
          </>
        )}
      </Drawer>
    </>
  );
}
