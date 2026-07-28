import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
  useMediaQuery,
} from "@mui/material";
import {
  AddOutlined,
  DeleteOutline,
  ExpandMore,
  SecurityOutlined,
} from "@mui/icons-material";
import { useTheme } from "@mui/material/styles";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  credentialInputSchema,
  monitorInputSchema,
  workflowInputSchema,
  type CredentialInput,
  type MonitorInput,
  type WorkflowInput,
  type WorkflowStepInput,
} from "@netsentinel/contracts";
import {
  ApiError,
  api,
  type Credential,
  type Monitor,
  type MonitorType,
  type Workflow,
} from "./api";
import { feedbackMessage, useCommandMutation } from "./action-feedback";
import { compatibleCredentialTypes } from "./credential-types";

type HttpCredentialType = "HTTP_BEARER" | "HTTP_BASIC" | "HTTP_API_KEY";
type NetworkCredentialType = HttpCredentialType | "WS_TOKEN";

function NetworkCredentialDialog({
  open,
  monitorType,
  onClose,
  onCreated,
}: {
  open: boolean;
  monitorType: MonitorType;
  onClose: () => void;
  onCreated: (credential: Credential) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<NetworkCredentialType>("HTTP_BEARER");
  const [secret, setSecret] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [headerName, setHeaderName] = useState("X-API-Key");
  const [value, setValue] = useState("");
  const [placement, setPlacement] = useState<"BEARER" | "QUERY">("BEARER");
  const [queryParamName, setQueryParamName] = useState("access_token");
  const [validation, setValidation] = useState("");
  useEffect(() => {
    if (!open) return;
    setName("");
    setType(monitorType === "WEBSOCKET" ? "WS_TOKEN" : "HTTP_BEARER");
    setSecret("");
    setUsername("");
    setPassword("");
    setHeaderName("X-API-Key");
    setValue("");
    setPlacement("BEARER");
    setQueryParamName("access_token");
    setValidation("");
  }, [monitorType, open]);
  const mutation = useCommandMutation({
    mutationFn: api.createCredential,
    onSuccess: onCreated,
    successMessage: feedbackMessage("feedback.command.authCredentialCreated"),
    errorFeedback: false,
  });
  const submit = () => {
    const payload: unknown =
      type === "HTTP_BEARER"
        ? { name, type, secret }
        : type === "HTTP_BASIC"
          ? { name, type, username, password }
          : type === "HTTP_API_KEY"
            ? { name, type, headerName, value }
            : { name, type, token: secret, placement, queryParamName };
    const parsed = credentialInputSchema.safeParse(payload);
    if (!parsed.success) {
      setValidation(
        parsed.error.issues
          .map((issue) => `${issue.path.join(".")}：${issue.message}`)
          .join("；"),
      );
      return;
    }
    mutation.mutate(parsed.data as CredentialInput);
  };
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>新建认证凭据</DialogTitle>
      <DialogContent>
        <Stack gap={2} sx={{ mt: 1 }}>
          {(validation || mutation.error) && (
            <ErrorAlert error={mutation.error ?? new Error(validation)} />
          )}
          <TextField
            label="凭据名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
          <TextField
            select
            label="认证类型"
            value={type}
            onChange={(event) =>
              setType(event.target.value as NetworkCredentialType)
            }
          >
            <MenuItem value="HTTP_BEARER">Bearer Token</MenuItem>
            <MenuItem value="HTTP_BASIC">HTTP Basic</MenuItem>
            {monitorType === "WEBSOCKET" && (
              <MenuItem value="WS_TOKEN">WebSocket Token</MenuItem>
            )}
            <MenuItem value="HTTP_API_KEY">自定义 API Key</MenuItem>
          </TextField>
          {type === "HTTP_BEARER" && (
            <TextField
              type="password"
              label="Bearer Token"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
            />
          )}
          {type === "HTTP_BASIC" && (
            <>
              <TextField
                label="用户名"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <TextField
                type="password"
                label="密码"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </>
          )}
          {type === "HTTP_API_KEY" && (
            <>
              <TextField
                label="请求头名称"
                helperText="例如 X-API-Key"
                value={headerName}
                onChange={(event) => setHeaderName(event.target.value)}
              />
              <TextField
                type="password"
                label="API Key"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </>
          )}
          {type === "WS_TOKEN" && (
            <>
              <TextField
                type="password"
                label="WebSocket Token"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
              />
              <TextField
                select
                label="传递方式"
                value={placement}
                onChange={(event) =>
                  setPlacement(event.target.value as "BEARER" | "QUERY")
                }
              >
                <MenuItem value="BEARER">Authorization Bearer 请求头</MenuItem>
                <MenuItem value="QUERY">URL 查询参数</MenuItem>
              </TextField>
              {placement === "QUERY" && (
                <>
                  <TextField
                    label="查询参数名"
                    value={queryParamName}
                    onChange={(event) => setQueryParamName(event.target.value)}
                    helperText="默认 access_token，可使用字母、数字、下划线、点和连字符"
                  />
                  <Alert severity="warning">
                    查询参数可能被目标服务器或反向代理记录，请确认其日志保护策略。
                  </Alert>
                </>
              )}
            </>
          )}
          <Alert severity="info">敏感值会加密保存，创建后不会再次回显。</Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="contained"
          disabled={mutation.isPending}
          onClick={submit}
        >
          创建并使用
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const apiError = error instanceof ApiError ? error : null;
  const message =
    apiError?.message ?? (error instanceof Error ? error.message : "操作失败");
  return (
    <Alert severity="error">
      {message}
      {apiError?.errors.length
        ? `：${apiError.errors.map((item) => `${item.path} ${item.message}`).join("；")}`
        : ""}
    </Alert>
  );
}

export function KeyValueEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}) {
  const rows = Object.entries(value);
  const update = (index: number, key: string, nextValue: string) => {
    const next = [...rows];
    next[index] = [key, nextValue];
    onChange(
      Object.fromEntries(
        next
          .filter(([name]) => name.trim())
          .map(([name, content]) => [name.trim(), content]),
      ),
    );
  };
  return (
    <Stack gap={1}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      {rows.map(([key, content], index) => (
        <Stack direction="row" gap={1} key={`${index}-${key}`}>
          <TextField
            size="small"
            fullWidth
            label="名称"
            value={key}
            onChange={(event) => update(index, event.target.value, content)}
          />
          <TextField
            size="small"
            fullWidth
            label="值"
            value={content}
            onChange={(event) => update(index, key, event.target.value)}
          />
          <IconButton
            aria-label="删除请求头"
            onClick={() =>
              onChange(
                Object.fromEntries(
                  rows.filter((_, rowIndex) => rowIndex !== index),
                ),
              )
            }
          >
            <DeleteOutline />
          </IconButton>
        </Stack>
      ))}
      <Button
        size="small"
        startIcon={<AddOutlined />}
        onClick={() =>
          onChange({ ...value, [`Header-${rows.length + 1}`]: "" })
        }
      >
        添加请求头
      </Button>
    </Stack>
  );
}

interface MonitorDraft {
  name: string;
  type: MonitorType;
  target: string;
  credentialId: string;
  intervalSeconds: number;
  timeoutMs: number;
  failureThreshold: number;
  recoveryThreshold: number;
  method: string;
  headers: Record<string, string>;
  body: string;
  expectedStatusMin: number;
  expectedStatusMax: number;
  maxLatencyMs: string;
  textContains: string;
  regex: string;
  jsonPath: string;
  jsonPathExpected: string;
  verifyTls: boolean;
  sendFormat: "NONE" | "TEXT" | "JSON";
  send: string;
  expect: "HANDSHAKE" | "MESSAGE" | "PONG";
  publicStatusEnabled: boolean;
  publicDisplayName: string;
  publicGroup: string;
  publicOrder: number;
}

function monitorIssueMessage(
  path: string,
  type: MonitorType,
  fallback: string,
) {
  if (path === "target") {
    if (type === "HTTP") {
      return "目标地址必须是以 http:// 或 https:// 开头的完整 URL";
    }
    if (type === "WEBSOCKET") {
      return "目标地址必须是以 ws:// 或 wss:// 开头的完整 URL";
    }
    if (type === "TCP") return "目标地址必须使用 host:port 格式";
    return "请输入有效的主机名或 IP 地址";
  }
  if (path === "name") return "请输入监控名称";
  if (path === "publicStatus.displayName") return "公开到状态页时必须填写公开名称";
  return fallback;
}

const emptyMonitor = (type: MonitorType = "HTTP"): MonitorDraft => ({
  name: "",
  type,
  target: "",
  credentialId: "",
  intervalSeconds: 60,
  timeoutMs: 10_000,
  failureThreshold: 3,
  recoveryThreshold: 2,
  method: "GET",
  headers: {},
  body: "",
  expectedStatusMin: 200,
  expectedStatusMax: 299,
  maxLatencyMs: "",
  textContains: "",
  regex: "",
  jsonPath: "",
  jsonPathExpected: "",
  verifyTls: true,
  sendFormat: "NONE",
  send: "",
  expect: "HANDSHAKE",
  publicStatusEnabled: false,
  publicDisplayName: "",
  publicGroup: "服务状态",
  publicOrder: 0,
});

function monitorToDraft(monitor: Monitor): MonitorDraft {
  const draft = emptyMonitor(monitor.type);
  const config = monitor.config as Record<string, unknown>;
  return {
    ...draft,
    name: monitor.name,
    target: monitor.target,
    credentialId: monitor.credentialId ?? "",
    intervalSeconds: monitor.intervalSeconds,
    timeoutMs: monitor.timeoutMs,
    failureThreshold: monitor.failureThreshold,
    recoveryThreshold: monitor.recoveryThreshold,
    method: String(config.method ?? draft.method),
    headers: (config.headers ?? {}) as Record<string, string>,
    body: String(config.body ?? ""),
    expectedStatusMin: Number(config.expectedStatusMin ?? 200),
    expectedStatusMax: Number(config.expectedStatusMax ?? 299),
    maxLatencyMs:
      config.maxLatencyMs === undefined ? "" : String(config.maxLatencyMs),
    textContains: String(config.textContains ?? ""),
    regex: String(config.regex ?? ""),
    jsonPath: String(config.jsonPath ?? ""),
    jsonPathExpected:
      config.jsonPathExpected === undefined
        ? ""
        : JSON.stringify(config.jsonPathExpected),
    verifyTls: config.verifyTls !== false,
    sendFormat: (config.sendFormat ?? "NONE") as MonitorDraft["sendFormat"],
    send: String(config.send ?? ""),
    expect: (config.expect ?? "HANDSHAKE") as MonitorDraft["expect"],
    publicStatusEnabled: monitor.publicStatus.enabled,
    publicDisplayName: monitor.publicStatus.displayName ?? monitor.name,
    publicGroup: monitor.publicStatus.group,
    publicOrder: monitor.publicStatus.order,
  };
}

function draftToMonitor(draft: MonitorDraft): unknown {
  const common = {
    name: draft.name,
    type: draft.type,
    target: draft.target,
    credentialId: draft.credentialId || null,
    intervalSeconds: draft.intervalSeconds,
    timeoutMs: draft.timeoutMs,
    failureThreshold: draft.failureThreshold,
    recoveryThreshold: draft.recoveryThreshold,
    tagIds: [],
    publicStatus: {
      enabled: draft.publicStatusEnabled,
      ...(draft.publicDisplayName ? { displayName: draft.publicDisplayName } : {}),
      group: draft.publicGroup,
      order: draft.publicOrder,
    },
  };
  if (draft.type === "HTTP")
    return {
      ...common,
      config: {
        method: draft.method,
        headers: draft.headers,
        ...(draft.body ? { body: draft.body } : {}),
        expectedStatusMin: draft.expectedStatusMin,
        expectedStatusMax: draft.expectedStatusMax,
        ...(draft.maxLatencyMs
          ? { maxLatencyMs: Number(draft.maxLatencyMs) }
          : {}),
        ...(draft.textContains ? { textContains: draft.textContains } : {}),
        ...(draft.regex ? { regex: draft.regex } : {}),
        ...(draft.jsonPath
          ? {
              jsonPath: draft.jsonPath,
              ...(draft.jsonPathExpected
                ? {
                    jsonPathExpected: JSON.parse(
                      draft.jsonPathExpected,
                    ) as unknown,
                  }
                : {}),
            }
          : {}),
        verifyTls: draft.verifyTls,
      },
    };
  if (draft.type === "WEBSOCKET")
    return {
      ...common,
      config: {
        headers: draft.headers,
        sendFormat: draft.sendFormat,
        ...(draft.sendFormat !== "NONE" ? { send: draft.send } : {}),
        expect: draft.expect,
        ...(draft.expect === "MESSAGE"
          ? { textContains: draft.textContains }
          : {}),
        verifyTls: draft.verifyTls,
      },
    };
  return { ...common, config: {} };
}

export function MonitorEditorDialog({
  open,
  monitor,
  onClose,
}: {
  open: boolean;
  monitor?: Monitor | null;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<MonitorDraft>(emptyMonitor());
  const [validation, setValidation] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [credentialOpen, setCredentialOpen] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const client = useQueryClient();
  const fullScreen = useMediaQuery(useTheme().breakpoints.down("sm"));
  const credentials = useQuery({
    queryKey: ["credentials"],
    queryFn: api.credentials,
    enabled: open,
  });
  useEffect(() => {
    if (open) {
      setDraft(monitor ? monitorToDraft(monitor) : emptyMonitor());
      setValidation("");
      setFieldErrors({});
    }
  }, [open, monitor]);
  const mutation = useCommandMutation({
    mutationFn: (input: MonitorInput) =>
      monitor
        ? api.updateMonitor(monitor.id, input, monitor.version)
        : api.createMonitor(input),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["monitors"] }),
        client.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      onClose();
    },
    successMessage: feedbackMessage(
      monitor ? "feedback.command.monitorUpdated" : "feedback.command.monitorCreated",
    ),
    errorFeedback: false,
  });
  const set = <K extends keyof MonitorDraft>(
    key: K,
    value: MonitorDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (key === "name" || key === "target") {
      setFieldErrors((current) => {
        if (!current[key]) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };
  const submit = () => {
    try {
      const result = monitorInputSchema.safeParse(draftToMonitor(draft));
      if (!result.success) {
        const nextErrors: Record<string, string> = {};
        for (const issue of result.error.issues) {
          const path = issue.path.join(".");
          nextErrors[path] ??= monitorIssueMessage(
            path,
            draft.type,
            issue.message,
          );
        }
        setFieldErrors(nextErrors);
        setValidation("请修正表单中标记的字段");
        window.setTimeout(() => {
          const firstInvalid = formRef.current?.querySelector<HTMLElement>(
            '[aria-invalid="true"]',
          );
          firstInvalid?.scrollIntoView({ behavior: "smooth", block: "center" });
          firstInvalid?.focus();
        });
        return;
      }
      setFieldErrors({});
      setValidation("");
      mutation.mutate(result.data);
    } catch {
      setValidation("JSONPath 期望值必须是有效 JSON");
    }
  };
  const compatibleTypes = compatibleCredentialTypes(draft.type);
  const compatible = (credentials.data ?? []).filter((item) =>
    compatibleTypes.includes(item.type),
  );
  const placeholder = {
    HTTP: "https://service.example.com/health",
    WEBSOCKET: "wss://stream.example.com/socket",
    TCP: "db.internal:5432",
    ICMP: "10.0.0.1",
  }[draft.type];
  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        fullWidth
        maxWidth="md"
        fullScreen={fullScreen}
      >
        <DialogTitle>{monitor ? "编辑监控" : "新建监控"}</DialogTitle>
        <DialogContent>
          <Stack ref={formRef} gap={2} sx={{ mt: 1 }}>
            {(validation || mutation.error) && (
              <ErrorAlert error={mutation.error ?? new Error(validation)} />
            )}
            <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
              <TextField
                fullWidth
                label="名称"
                value={draft.name}
                onChange={(event) => set("name", event.target.value)}
                error={Boolean(fieldErrors.name)}
                helperText={fieldErrors.name}
              />
              <TextField
                select
                fullWidth
                label="协议"
                value={draft.type}
                onChange={(event) =>
                  setDraft({
                    ...emptyMonitor(event.target.value as MonitorType),
                    name: draft.name,
                    publicStatusEnabled: draft.publicStatusEnabled,
                    publicDisplayName: draft.publicDisplayName,
                    publicGroup: draft.publicGroup,
                    publicOrder: draft.publicOrder,
                  })
                }
              >
                {["HTTP", "WEBSOCKET", "TCP", "ICMP"].map((type) => (
                  <MenuItem key={type} value={type}>
                    {type === "WEBSOCKET" ? "WS / WSS" : type}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            <TextField
              label="目标地址"
              placeholder={placeholder}
              value={draft.target}
              onChange={(event) => set("target", event.target.value)}
              error={Boolean(fieldErrors.target)}
              helperText={fieldErrors.target}
            />
            <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
              <TextField
                fullWidth
                type="number"
                label="间隔（秒）"
                value={draft.intervalSeconds}
                onChange={(event) =>
                  set("intervalSeconds", Number(event.target.value))
                }
              />
              <TextField
                fullWidth
                type="number"
                label="超时（毫秒）"
                value={draft.timeoutMs}
                onChange={(event) =>
                  set("timeoutMs", Number(event.target.value))
                }
              />
              <TextField
                fullWidth
                type="number"
                label="失败阈值"
                value={draft.failureThreshold}
                onChange={(event) =>
                  set("failureThreshold", Number(event.target.value))
                }
              />
              <TextField
                fullWidth
                type="number"
                label="恢复阈值"
                value={draft.recoveryThreshold}
                onChange={(event) =>
                  set("recoveryThreshold", Number(event.target.value))
                }
              />
            </Stack>
            {(draft.type === "HTTP" || draft.type === "WEBSOCKET") && (
              <>
                <Divider />
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  gap={1}
                  alignItems={{ sm: "flex-start" }}
                >
                  <TextField
                    select
                    fullWidth
                    label="认证凭据（可选）"
                    value={draft.credentialId}
                    onChange={(event) =>
                      set("credentialId", event.target.value)
                    }
                    helperText={
                      credentials.isLoading
                        ? "正在加载凭据…"
                        : compatible.length === 0
                          ? "暂无兼容凭据，请创建 Bearer、Basic 或 API Key"
                          : "敏感认证信息由凭据库加密保存"
                    }
                  >
                    <MenuItem value="">不使用认证</MenuItem>
                    {compatible.map((item) => (
                      <MenuItem key={item.id} value={item.id}>
                        {item.name} · {item.type}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button
                    variant="outlined"
                    startIcon={<AddOutlined />}
                    sx={{ minWidth: { sm: 164 }, mt: { sm: 0.5 } }}
                    onClick={() => setCredentialOpen(true)}
                  >
                    新建认证凭据
                  </Button>
                </Stack>
                <KeyValueEditor
                  label="普通请求头（敏感值请使用凭据）"
                  value={draft.headers}
                  onChange={(value) => set("headers", value)}
                />
                {draft.type === "HTTP" ? (
                  <>
                    <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
                      <TextField
                        select
                        fullWidth
                        label="请求方法"
                        value={draft.method}
                        onChange={(event) => set("method", event.target.value)}
                      >
                        {[
                          "GET",
                          "HEAD",
                          "POST",
                          "PUT",
                          "PATCH",
                          "DELETE",
                          "OPTIONS",
                        ].map((method) => (
                          <MenuItem key={method} value={method}>
                            {method}
                          </MenuItem>
                        ))}
                      </TextField>
                      <TextField
                        fullWidth
                        type="number"
                        label="状态码下限"
                        value={draft.expectedStatusMin}
                        onChange={(event) =>
                          set("expectedStatusMin", Number(event.target.value))
                        }
                      />
                      <TextField
                        fullWidth
                        type="number"
                        label="状态码上限"
                        value={draft.expectedStatusMax}
                        onChange={(event) =>
                          set("expectedStatusMax", Number(event.target.value))
                        }
                      />
                      <TextField
                        fullWidth
                        type="number"
                        label="最大耗时（毫秒，可选）"
                        value={draft.maxLatencyMs}
                        onChange={(event) =>
                          set("maxLatencyMs", event.target.value)
                        }
                      />
                    </Stack>
                    <TextField
                      multiline
                      minRows={3}
                      label="请求正文（可选）"
                      value={draft.body}
                      onChange={(event) => set("body", event.target.value)}
                    />
                    <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
                      <TextField
                        fullWidth
                        label="正文包含（可选）"
                        value={draft.textContains}
                        onChange={(event) =>
                          set("textContains", event.target.value)
                        }
                      />
                      <TextField
                        fullWidth
                        label="RE2 正则（可选）"
                        value={draft.regex}
                        onChange={(event) => set("regex", event.target.value)}
                      />
                    </Stack>
                    <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
                      <TextField
                        fullWidth
                        label="JSONPath（可选）"
                        value={draft.jsonPath}
                        onChange={(event) =>
                          set("jsonPath", event.target.value)
                        }
                      />
                      <TextField
                        fullWidth
                        label="JSONPath 期望值（JSON）"
                        value={draft.jsonPathExpected}
                        onChange={(event) =>
                          set("jsonPathExpected", event.target.value)
                        }
                      />
                    </Stack>
                  </>
                ) : (
                  <>
                    <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
                      <TextField
                        select
                        fullWidth
                        label="发送内容"
                        value={draft.sendFormat}
                        onChange={(event) =>
                          set(
                            "sendFormat",
                            event.target.value as MonitorDraft["sendFormat"],
                          )
                        }
                      >
                        {["NONE", "TEXT", "JSON"].map((mode) => (
                          <MenuItem key={mode} value={mode}>
                            {mode}
                          </MenuItem>
                        ))}
                      </TextField>
                      <TextField
                        select
                        fullWidth
                        label="成功条件"
                        value={draft.expect}
                        onChange={(event) =>
                          set(
                            "expect",
                            event.target.value as MonitorDraft["expect"],
                          )
                        }
                      >
                        {["HANDSHAKE", "MESSAGE", "PONG"].map((mode) => (
                          <MenuItem key={mode} value={mode}>
                            {mode}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Stack>
                    {draft.sendFormat !== "NONE" && (
                      <TextField
                        multiline
                        minRows={2}
                        label={
                          draft.sendFormat === "JSON" ? "发送 JSON" : "发送文本"
                        }
                        value={draft.send}
                        onChange={(event) => set("send", event.target.value)}
                      />
                    )}
                    {draft.expect === "MESSAGE" && (
                      <TextField
                        label="消息包含"
                        value={draft.textContains}
                        onChange={(event) =>
                          set("textContains", event.target.value)
                        }
                      />
                    )}
                  </>
                )}
                <FormControlLabel
                  control={
                    <Switch
                      checked={draft.verifyTls}
                      onChange={(event) =>
                        set("verifyTls", event.target.checked)
                      }
                    />
                  }
                  label="严格校验 TLS 证书"
                />
                {!draft.verifyTls && (
                  <Alert severity="warning" icon={<SecurityOutlined />}>
                    TLS 证书校验已关闭，连接可能被中间人攻击。该风险会持续显示。
                  </Alert>
                )}
              </>
            )}
            <Divider />
            <Box>
              <Typography variant="h3">公开状态页</Typography>
              <FormControlLabel
                sx={{ mt: 0.75 }}
                control={
                  <Switch
                    checked={draft.publicStatusEnabled}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      setDraft((current) => ({
                        ...current,
                        publicStatusEnabled: enabled,
                        publicDisplayName: enabled && !current.publicDisplayName ? current.name : current.publicDisplayName,
                      }));
                    }}
                  />
                }
                label="公开到状态页"
              />
              <Typography variant="body2" color="text.secondary">
                仅公开服务名称、可用率和脱敏事件，不会公开目标地址或内部错误。
              </Typography>
            </Box>
            {draft.publicStatusEnabled && (
              <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
                <TextField
                  fullWidth
                  label="公开名称"
                  value={draft.publicDisplayName}
                  onChange={(event) => set("publicDisplayName", event.target.value)}
                  error={Boolean(fieldErrors["publicStatus.displayName"])}
                  helperText={fieldErrors["publicStatus.displayName"]}
                />
                <TextField
                  fullWidth
                  label="公开分组"
                  value={draft.publicGroup}
                  onChange={(event) => set("publicGroup", event.target.value)}
                />
                <TextField
                  fullWidth
                  type="number"
                  inputProps={{ min: 0, step: 1 }}
                  label="组内排序"
                  value={draft.publicOrder}
                  onChange={(event) => set("publicOrder", Number(event.target.value))}
                />
              </Stack>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="contained"
            disabled={mutation.isPending}
            onClick={submit}
          >
            {monitor ? "保存修改" : "创建监控"}
          </Button>
        </DialogActions>
      </Dialog>
      <NetworkCredentialDialog
        open={credentialOpen}
        monitorType={draft.type}
        onClose={() => setCredentialOpen(false)}
        onCreated={(credential) => {
          set("credentialId", credential.id);
          setCredentialOpen(false);
          void client.invalidateQueries({ queryKey: ["credentials"] });
        }}
      />
    </>
  );
}

const stepDefaults = (
  type: WorkflowStepInput["type"] = "HTTP",
): WorkflowStepInput => {
  const common = {
    name: "",
    type,
    credentialId: null,
    timeoutMs: 30_000,
    retries: 0,
    continueOnFailure: false,
  };
  if (type === "HTTP" || type === "WEBHOOK")
    return {
      ...common,
      type,
      config: { url: "", method: "POST", headers: {}, verifyTls: true },
    };
  if (type === "SSH")
    return {
      ...common,
      type,
      credentialId: "",
      config: {
        host: "",
        port: 22,
        username: "",
        command: "",
      },
    };
  if (type === "SHELL") return { ...common, type, config: { command: "" } };
  if (type === "AGENT_SHELL")
    return { ...common, type, config: { agentId: "", command: "" } };
  return {
    ...common,
    type: "EMAIL",
    credentialId: "",
    config: { to: "", subject: "", body: "" },
  };
};

function StepEditor({
  step,
  index,
  credentials,
  agents,
  onChange,
  onDelete,
}: {
  step: WorkflowStepInput;
  index: number;
  credentials: Credential[];
  agents: Array<{ id: string; name: string }>;
  onChange: (step: WorkflowStepInput) => void;
  onDelete: () => void;
}) {
  const config = step.config as Record<string, unknown>;
  const changeConfig = (key: string, value: unknown) =>
    onChange({
      ...step,
      config: { ...config, [key]: value },
    } as WorkflowStepInput);
  const compatibleTypes = compatibleCredentialTypes(step.type);
  const compatible = credentials.filter((credential) =>
    compatibleTypes.includes(credential.type),
  );
  return (
    <Accordion
      data-testid="workflow-step"
      defaultExpanded={index === 0}
      disableGutters
    >
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Typography fontWeight={700}>
          {index + 1}. {step.name || "未命名步骤"} · {step.type}
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack gap={2}>
          <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
            <TextField
              fullWidth
              label="步骤名称"
              value={step.name}
              onChange={(event) =>
                onChange({ ...step, name: event.target.value })
              }
            />
            <TextField
              select
              fullWidth
              label="动作类型"
              value={step.type}
              onChange={(event) =>
                onChange({
                  ...stepDefaults(
                    event.target.value as WorkflowStepInput["type"],
                  ),
                  ...(step.id ? { id: step.id } : {}),
                  name: step.name,
                })
              }
            >
              {["HTTP", "WEBHOOK", "SSH", "SHELL", "AGENT_SHELL", "EMAIL"].map(
                (type) => (
                  <MenuItem key={type} value={type}>
                    {type}
                  </MenuItem>
                ),
              )}
            </TextField>
          </Stack>
          {(step.type === "HTTP" || step.type === "WEBHOOK") && (
            <>
              <TextField
                label="请求地址"
                value={String(config.url ?? "")}
                onChange={(event) => changeConfig("url", event.target.value)}
              />
              <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
                <TextField
                  select
                  fullWidth
                  label="方法"
                  value={String(config.method ?? "POST")}
                  onChange={(event) =>
                    changeConfig("method", event.target.value)
                  }
                >
                  {[
                    "GET",
                    "HEAD",
                    "POST",
                    "PUT",
                    "PATCH",
                    "DELETE",
                    "OPTIONS",
                  ].map((method) => (
                    <MenuItem key={method} value={method}>
                      {method}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  fullWidth
                  label="认证凭据（可选）"
                  value={step.credentialId ?? ""}
                  onChange={(event) =>
                    onChange({
                      ...step,
                      credentialId: event.target.value || null,
                    })
                  }
                >
                  <MenuItem value="">不使用认证</MenuItem>
                  {compatible.map((item) => (
                    <MenuItem key={item.id} value={item.id}>
                      {item.name} · {item.type}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
              <KeyValueEditor
                label="请求头"
                value={(config.headers ?? {}) as Record<string, string>}
                onChange={(value) => changeConfig("headers", value)}
              />
              <TextField
                multiline
                minRows={3}
                label="请求正文（可使用受控事件模板）"
                value={String(config.body ?? "")}
                onChange={(event) => changeConfig("body", event.target.value)}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={config.verifyTls !== false}
                    onChange={(event) =>
                      changeConfig("verifyTls", event.target.checked)
                    }
                  />
                }
                label="严格校验 TLS 证书"
              />
              {config.verifyTls === false && (
                <Alert severity="warning">TLS 证书校验已关闭</Alert>
              )}
            </>
          )}
          {step.type === "SSH" && (
            <>
              <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
                <TextField
                  fullWidth
                  label="主机"
                  value={String(config.host ?? "")}
                  onChange={(event) => changeConfig("host", event.target.value)}
                />
                <TextField
                  fullWidth
                  type="number"
                  label="端口"
                  value={Number(config.port ?? 22)}
                  onChange={(event) =>
                    changeConfig("port", Number(event.target.value))
                  }
                />
                <TextField
                  fullWidth
                  label="用户名"
                  value={String(config.username ?? "")}
                  onChange={(event) =>
                    changeConfig("username", event.target.value)
                  }
                />
              </Stack>
              <TextField
                select
                label="SSH 凭据"
                value={step.credentialId ?? ""}
                onChange={(event) =>
                  onChange({ ...step, credentialId: event.target.value })
                }
              >
                {compatible.map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {item.name} · {item.type}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                multiline
                minRows={3}
                label="命令"
                value={String(config.command ?? "")}
                onChange={(event) =>
                  changeConfig("command", event.target.value)
                }
              />
            </>
          )}
          {step.type === "SHELL" && (
            <TextField
              multiline
              minRows={3}
              label="容器 Shell 命令"
              value={String(config.command ?? "")}
              onChange={(event) => changeConfig("command", event.target.value)}
            />
          )}
          {step.type === "AGENT_SHELL" && (
            <>
              <TextField
                select
                label="Linux Agent"
                value={String(config.agentId ?? "")}
                onChange={(event) =>
                  changeConfig("agentId", event.target.value)
                }
              >
                {agents.map((agent) => (
                  <MenuItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                multiline
                minRows={3}
                label="宿主命令"
                value={String(config.command ?? "")}
                onChange={(event) =>
                  changeConfig("command", event.target.value)
                }
              />
            </>
          )}
          {step.type === "EMAIL" && (
            <>
              <TextField
                select
                label="SMTP 凭据"
                value={step.credentialId ?? ""}
                onChange={(event) =>
                  onChange({ ...step, credentialId: event.target.value })
                }
              >
                {compatible.map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {item.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="收件人"
                value={String(config.to ?? "")}
                onChange={(event) => changeConfig("to", event.target.value)}
              />
              <TextField
                label="主题"
                value={String(config.subject ?? "")}
                onChange={(event) =>
                  changeConfig("subject", event.target.value)
                }
              />
              <TextField
                multiline
                minRows={3}
                label="正文"
                value={String(config.body ?? "")}
                onChange={(event) => changeConfig("body", event.target.value)}
              />
            </>
          )}
          <Divider />
          <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
            <TextField
              fullWidth
              type="number"
              label="超时（毫秒）"
              value={step.timeoutMs}
              onChange={(event) =>
                onChange({ ...step, timeoutMs: Number(event.target.value) })
              }
            />
            <TextField
              fullWidth
              type="number"
              label="重试次数"
              value={step.retries}
              onChange={(event) =>
                onChange({ ...step, retries: Number(event.target.value) })
              }
            />
            <FormControlLabel
              sx={{ minWidth: 150 }}
              control={
                <Switch
                  checked={step.continueOnFailure}
                  onChange={(event) =>
                    onChange({
                      ...step,
                      continueOnFailure: event.target.checked,
                    })
                  }
                />
              }
              label="失败后继续"
            />
          </Stack>
          <Button
            color="error"
            startIcon={<DeleteOutline />}
            onClick={onDelete}
          >
            删除步骤
          </Button>
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

export function WorkflowEditorDialog({
  open,
  workflow,
  onClose,
}: {
  open: boolean;
  workflow?: Workflow | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const fullScreen = useMediaQuery(useTheme().breakpoints.down("sm"));
  const monitors = useQuery({
    queryKey: ["monitors"],
    queryFn: api.monitors,
    enabled: open,
  });
  const credentials = useQuery({
    queryKey: ["credentials"],
    queryFn: api.credentials,
    enabled: open,
  });
  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: api.agents,
    enabled: open,
  });
  const [draft, setDraft] = useState<WorkflowInput>({
    name: "",
    monitorId: null,
    trigger: "DOWN",
    approvalMode: "AUTO",
    approvalTimeoutMinutes: 15,
    steps: [stepDefaults()],
  });
  const [validation, setValidation] = useState("");
  useEffect(() => {
    if (open)
      setDraft(
        workflow
          ? {
              name: workflow.name,
              monitorId: workflow.monitorId ?? workflow.monitor?.id ?? null,
              trigger: workflow.trigger,
              approvalMode: workflow.approvalMode,
              approvalTimeoutMinutes: workflow.approvalTimeoutMinutes,
              steps: workflow.steps.map(
                (step) =>
                  ({
                    id: step.id,
                    name: step.name,
                    type: step.type,
                    credentialId: step.credentialId,
                    timeoutMs: step.timeoutMs,
                    retries: step.retries,
                    continueOnFailure: step.continueOnFailure,
                    config: step.config,
                  }) as WorkflowStepInput,
              ),
            }
          : {
              name: "",
              monitorId: null,
              trigger: "DOWN",
              approvalMode: "AUTO",
              approvalTimeoutMinutes: 15,
              steps: [stepDefaults()],
            },
      );
  }, [open, workflow]);
  const mutation = useCommandMutation({
    mutationFn: (input: WorkflowInput) =>
      workflow
        ? api.updateWorkflow(workflow.id, input, workflow.version)
        : api.createWorkflow(input),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["workflows"] });
      onClose();
    },
    successMessage: feedbackMessage(
      workflow ? "feedback.command.workflowUpdated" : "feedback.command.workflowCreated",
    ),
    errorFeedback: false,
  });
  const submit = () => {
    const parsed = workflowInputSchema.safeParse(draft);
    if (!parsed.success) {
      setValidation(
        parsed.error.issues
          .map((issue) => `${issue.path.join(".")}：${issue.message}`)
          .join("；"),
      );
      return;
    }
    mutation.mutate(parsed.data);
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      fullScreen={fullScreen}
    >
      <DialogTitle>
        {workflow ? "编辑有序工作流" : "新建有序工作流"}
      </DialogTitle>
      <DialogContent>
        <Stack gap={2} sx={{ mt: 1 }}>
          {(validation || mutation.error) && (
            <ErrorAlert error={mutation.error ?? new Error(validation)} />
          )}
          <TextField
            label="工作流名称"
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
          />
          <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
            <TextField
              select
              fullWidth
              label="绑定监控（手动可不绑定）"
              value={draft.monitorId ?? ""}
              onChange={(event) =>
                setDraft({ ...draft, monitorId: event.target.value || null })
              }
            >
              <MenuItem value="">不绑定</MenuItem>
              {(monitors.data ?? []).map((monitor) => (
                <MenuItem key={monitor.id} value={monitor.id}>
                  {monitor.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              fullWidth
              label="触发事件"
              value={draft.trigger}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  trigger: event.target.value as WorkflowInput["trigger"],
                })
              }
            >
              {["DOWN", "RECOVERY", "MANUAL"].map((item) => (
                <MenuItem key={item} value={item}>
                  {item}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              fullWidth
              label="授权模式"
              value={draft.approvalMode}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  approvalMode: event.target
                    .value as WorkflowInput["approvalMode"],
                })
              }
            >
              <MenuItem value="AUTO">自动执行</MenuItem>
              <MenuItem value="APPROVAL">等待审批</MenuItem>
            </TextField>
          </Stack>
          {draft.approvalMode === "APPROVAL" && (
            <TextField
              type="number"
              label="审批超时（分钟）"
              value={draft.approvalTimeoutMinutes}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  approvalTimeoutMinutes: Number(event.target.value),
                })
              }
            />
          )}
          <Divider>执行步骤</Divider>
          {draft.steps.map((step, index) => (
            <StepEditor
              key={index}
              step={step}
              index={index}
              credentials={credentials.data ?? []}
              agents={agents.data ?? []}
              onChange={(next) =>
                setDraft({
                  ...draft,
                  steps: draft.steps.map((item, itemIndex) =>
                    itemIndex === index ? next : item,
                  ),
                })
              }
              onDelete={() =>
                setDraft({
                  ...draft,
                  steps: draft.steps.filter(
                    (_, itemIndex) => itemIndex !== index,
                  ),
                })
              }
            />
          ))}
          <Button
            variant="outlined"
            startIcon={<AddOutlined />}
            onClick={() =>
              setDraft({ ...draft, steps: [...draft.steps, stepDefaults()] })
            }
          >
            添加步骤
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={mutation.isPending || draft.steps.length === 0}
        >
          保存工作流
        </Button>
      </DialogActions>
    </Dialog>
  );
}
