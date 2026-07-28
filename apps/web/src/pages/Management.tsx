import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  AddOutlined,
  CheckCircleOutline,
  ContentCopyOutlined,
  DeleteOutline,
  EditOutlined,
  KeyOutlined,
  PlayArrowOutlined,
  OpenInNewOutlined,
  RefreshOutlined,
  SaveOutlined,
  SecurityOutlined,
  TerminalOutlined,
} from "@mui/icons-material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PERMISSIONS,
  credentialInputSchema,
  type CredentialInput,
} from "@netsentinel/contracts";
import {
  api,
  type ApiToken,
  type Credential,
  type MaintenanceInput,
  type MaintenanceWindow,
  type Role,
  type User,
  type Workflow,
} from "../api";
import { PageHeader, RelativeTime } from "../components";
import { ErrorAlert, WorkflowEditorDialog } from "../typed-forms";
import {
  feedbackMessage,
  useActionFeedback,
  useCommandMutation,
} from "../action-feedback";
import {
  THEME_COLOR_OPTIONS,
  isThemeColor,
  setThemeColorPreference,
  type ThemeColor,
} from "../theme";

export function WorkflowsPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["workflows"], queryFn: api.workflows });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Workflow | null>(null);
  const execute = useCommandMutation({
    mutationFn: api.executeWorkflow,
    onSuccess: () => void client.invalidateQueries({ queryKey: ["workflows"] }),
    trackRun: (run) => ({ run, label: run.workflow.name }),
  });
  const remove = useCommandMutation({
    mutationFn: api.deleteWorkflow,
    onSuccess: () => void client.invalidateQueries({ queryKey: ["workflows"] }),
    successMessage: feedbackMessage("feedback.command.workflowDeleted"),
  });
  return (
    <>
      <PageHeader
        title="有序工作流"
        subtitle="故障、恢复或手动事件触发的顺序动作；高风险操作可要求审批。"
        action={
          <Button
            variant="contained"
            startIcon={<AddOutlined />}
            onClick={() => setOpen(true)}
          >
            新建工作流
          </Button>
        }
      />
      <Paper variant="outlined">
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>工作流</TableCell>
                <TableCell>触发</TableCell>
                <TableCell>授权</TableCell>
                <TableCell>步骤</TableCell>
                <TableCell>状态</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(query.data ?? []).map((workflow) => (
                <TableRow key={workflow.id}>
                  <TableCell>
                    <Typography fontWeight={700}>{workflow.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {workflow.monitor?.name ?? "未绑定监控"}
                    </Typography>
                  </TableCell>
                  <TableCell>{workflow.trigger}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={
                        workflow.approvalMode === "AUTO"
                          ? "自动执行"
                          : `审批 ${workflow.approvalTimeoutMinutes} 分钟`
                      }
                      color={
                        workflow.approvalMode === "APPROVAL"
                          ? "warning"
                          : "default"
                      }
                    />
                  </TableCell>
                  <TableCell>{workflow.steps.length}</TableCell>
                  <TableCell>
                    {workflow.configurationComplete ? (
                      <Chip
                        size="small"
                        color="success"
                        variant="outlined"
                        label="配置完整"
                      />
                    ) : (
                      <Chip size="small" color="error" label="配置不完整" />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="手动执行">
                      <span>
                        <IconButton
                          disabled={
                            !workflow.configurationComplete ||
                            (execute.isPending && execute.variables === workflow.id)
                          }
                          aria-label={`执行工作流 ${workflow.name}`}
                          onClick={() => execute.mutate(workflow.id)}
                        >
                          {execute.isPending && execute.variables === workflow.id ? (
                            <CircularProgress size={18} />
                          ) : (
                            <PlayArrowOutlined />
                          )}
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="编辑">
                      <IconButton
                        aria-label={`编辑工作流 ${workflow.name}`}
                        onClick={() => setEditing(workflow)}
                      >
                        <EditOutlined />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="删除">
                      <IconButton
                        color="error"
                        aria-label={`删除工作流 ${workflow.name}`}
                        disabled={
                          remove.isPending && remove.variables === workflow.id
                        }
                        onClick={() => {
                          if (
                            window.confirm(
                              `确定删除工作流“${workflow.name}”吗？`,
                            )
                          )
                            remove.mutate(workflow.id);
                        }}
                      >
                        {remove.isPending && remove.variables === workflow.id ? (
                          <CircularProgress size={18} />
                        ) : (
                          <DeleteOutline />
                        )}
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      <WorkflowEditorDialog
        open={open || Boolean(editing)}
        workflow={editing}
        onClose={() => {
          setOpen(false);
          setEditing(null);
        }}
      />
    </>
  );
}

interface CredentialDraft {
  name: string;
  type: CredentialInput["type"];
  secret: string;
  passphrase: string;
  username: string;
  password: string;
  headerName: string;
  value: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  placement: "BEARER" | "QUERY";
  queryParamName: string;
}
const emptyCredential = (
  type: CredentialInput["type"] = "HTTP_BEARER",
): CredentialDraft => ({
  name: "",
  type,
  secret: "",
  passphrase: "",
  username: "",
  password: "",
  headerName: "X-API-Key",
  value: "",
  host: "",
  port: 587,
  secure: false,
  user: "",
  from: "",
  placement: "BEARER",
  queryParamName: "access_token",
});
function credentialPayload(draft: CredentialDraft): unknown {
  if (draft.type === "SSH_KEY")
    return {
      name: draft.name,
      type: draft.type,
      secret: draft.secret,
      ...(draft.passphrase ? { passphrase: draft.passphrase } : {}),
    };
  if (["SSH_PASSWORD", "HTTP_BEARER"].includes(draft.type))
    return { name: draft.name, type: draft.type, secret: draft.secret };
  if (draft.type === "HTTP_BASIC")
    return {
      name: draft.name,
      type: draft.type,
      username: draft.username,
      password: draft.password,
    };
  if (draft.type === "HTTP_API_KEY")
    return {
      name: draft.name,
      type: draft.type,
      headerName: draft.headerName,
      value: draft.value,
    };
  if (draft.type === "WS_TOKEN")
    return {
      name: draft.name,
      type: draft.type,
      token: draft.secret,
      placement: draft.placement,
      queryParamName: draft.queryParamName,
    };
  return {
    name: draft.name,
    type: "SMTP",
    host: draft.host,
    port: draft.port,
    secure: draft.secure,
    user: draft.user,
    password: draft.password,
    from: draft.from,
  };
}
function CredentialDialog({
  open,
  credential,
  onClose,
}: {
  open: boolean;
  credential?: Credential | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState(emptyCredential());
  const [validation, setValidation] = useState("");
  useEffect(() => {
    if (open)
      setDraft({
        ...emptyCredential(credential?.type),
        name: credential?.name ?? "",
      });
  }, [open, credential]);
  const mutation = useCommandMutation({
    mutationFn: (input: CredentialInput) =>
      credential
        ? api.rotateCredential(credential.id, input, credential.version)
        : api.createCredential(input),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["credentials"] });
      onClose();
    },
    successMessage: feedbackMessage(
      credential ? "feedback.command.credentialRotated" : "feedback.command.credentialCreated",
    ),
    errorFeedback: false,
  });
  const set = <K extends keyof CredentialDraft>(
    key: K,
    value: CredentialDraft[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = () => {
    const parsed = credentialInputSchema.safeParse(credentialPayload(draft));
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
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{credential ? "轮换凭据" : "新建加密凭据"}</DialogTitle>
      <DialogContent>
        <Stack gap={2} sx={{ mt: 1 }}>
          {(validation || mutation.error) && (
            <ErrorAlert error={mutation.error ?? new Error(validation)} />
          )}
          <TextField
            label="名称"
            value={draft.name}
            onChange={(event) => set("name", event.target.value)}
          />
          <TextField
            select
            label="类型"
            value={draft.type}
            disabled={Boolean(credential)}
            onChange={(event) =>
              setDraft({
                ...emptyCredential(
                  event.target.value as CredentialInput["type"],
                ),
                name: draft.name,
              })
            }
          >
            {[
              "HTTP_BEARER",
              "HTTP_BASIC",
              "HTTP_API_KEY",
              "WS_TOKEN",
              "SSH_PASSWORD",
              "SSH_KEY",
              "SMTP",
            ].map((type) => (
              <MenuItem key={type} value={type}>
                {type}
              </MenuItem>
            ))}
          </TextField>
          {["SSH_PASSWORD", "SSH_KEY", "HTTP_BEARER"].includes(draft.type) && (
            <TextField
              multiline={draft.type === "SSH_KEY"}
              minRows={draft.type === "SSH_KEY" ? 5 : undefined}
              type={draft.type === "SSH_KEY" ? "text" : "password"}
              label={
                draft.type === "SSH_KEY"
                  ? "私钥"
                  : draft.type === "SSH_PASSWORD"
                    ? "SSH 密码"
                    : "Bearer Token"
              }
              value={draft.secret}
              onChange={(event) => set("secret", event.target.value)}
            />
          )}
          {draft.type === "SSH_KEY" && (
            <TextField
              type="password"
              label="私钥口令（可选）"
              autoComplete="new-password"
              value={draft.passphrase}
              onChange={(event) => set("passphrase", event.target.value)}
              helperText="用于解密受口令保护的私钥，保存后不会回显"
            />
          )}
          {draft.type === "HTTP_BASIC" && (
            <>
              <TextField
                label="用户名"
                value={draft.username}
                onChange={(event) => set("username", event.target.value)}
              />
              <TextField
                type="password"
                label="密码"
                value={draft.password}
                onChange={(event) => set("password", event.target.value)}
              />
            </>
          )}
          {draft.type === "HTTP_API_KEY" && (
            <>
              <TextField
                label="请求头名称"
                value={draft.headerName}
                onChange={(event) => set("headerName", event.target.value)}
                helperText="例如 X-API-Key"
              />
              <TextField
                type="password"
                label="API Key 值"
                value={draft.value}
                onChange={(event) => set("value", event.target.value)}
              />
            </>
          )}
          {draft.type === "WS_TOKEN" && (
            <>
              <TextField
                type="password"
                label="WebSocket Token"
                value={draft.secret}
                onChange={(event) => set("secret", event.target.value)}
              />
              <TextField
                select
                label="传递方式"
                value={draft.placement}
                onChange={(event) =>
                  set(
                    "placement",
                    event.target.value as CredentialDraft["placement"],
                  )
                }
              >
                <MenuItem value="BEARER">Authorization Bearer 请求头</MenuItem>
                <MenuItem value="QUERY">URL 查询参数</MenuItem>
              </TextField>
              {draft.placement === "QUERY" && (
                <>
                  <TextField
                    label="查询参数名"
                    value={draft.queryParamName}
                    onChange={(event) =>
                      set("queryParamName", event.target.value)
                    }
                    helperText="默认 access_token，可使用字母、数字、下划线、点和连字符"
                  />
                  <Alert severity="warning">
                    查询参数可能被目标服务器或反向代理记录，请确认其日志保护策略。
                  </Alert>
                </>
              )}
            </>
          )}
          {draft.type === "SMTP" && (
            <>
              <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
                <TextField
                  fullWidth
                  label="SMTP 主机"
                  value={draft.host}
                  onChange={(event) => set("host", event.target.value)}
                />
                <TextField
                  fullWidth
                  type="number"
                  label="端口"
                  value={draft.port}
                  onChange={(event) => set("port", Number(event.target.value))}
                />
              </Stack>
              <FormControlLabel
                control={
                  <Switch
                    checked={draft.secure}
                    onChange={(event) => set("secure", event.target.checked)}
                  />
                }
                label="使用隐式 TLS"
              />
              <TextField
                label="用户名"
                value={draft.user}
                onChange={(event) => set("user", event.target.value)}
              />
              <TextField
                type="password"
                label="密码"
                value={draft.password}
                onChange={(event) => set("password", event.target.value)}
              />
              <TextField
                type="email"
                label="发件人地址"
                value={draft.from}
                onChange={(event) => set("from", event.target.value)}
              />
            </>
          )}
          {credential && (
            <Alert severity="info">
              旧值不会回显。提交后会整体替换该凭据的加密内容。
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={mutation.isPending}
        >
          {credential ? "确认轮换" : "保存凭据"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function CredentialsPage() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["credentials"],
    queryFn: api.credentials,
  });
  const [open, setOpen] = useState(false);
  const [rotating, setRotating] = useState<Credential | null>(null);
  const remove = useCommandMutation({
    mutationFn: api.deleteCredential,
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["credentials"] }),
    successMessage: feedbackMessage("feedback.command.credentialDeleted"),
  });
  return (
    <>
      <PageHeader
        title="凭据库"
        subtitle="敏感信息使用部署主密钥加密；保存后不再回显明文。"
        action={
          <Button
            variant="contained"
            startIcon={<AddOutlined />}
            onClick={() => setOpen(true)}
          >
            新建凭据
          </Button>
        }
      />
      <Paper variant="outlined">
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>名称</TableCell>
                <TableCell>类型</TableCell>
                <TableCell>状态</TableCell>
                <TableCell>创建时间</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(query.data ?? []).map((credential) => (
                <TableRow key={credential.id}>
                  <TableCell>
                    <Stack direction="row" gap={1} alignItems="center">
                      <KeyOutlined color="action" />
                      <Typography fontWeight={700}>
                        {credential.name}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>{credential.type}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color="success"
                      variant="outlined"
                      label="已加密"
                    />
                  </TableCell>
                  <TableCell>
                    <RelativeTime value={credential.createdAt} />
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      startIcon={<RefreshOutlined />}
                      onClick={() => setRotating(credential)}
                    >
                      轮换
                    </Button>
                    <IconButton
                      color="error"
                      aria-label={`删除凭据 ${credential.name}`}
                      disabled={
                        remove.isPending && remove.variables === credential.id
                      }
                      onClick={() => {
                        if (
                          window.confirm(
                            `确定删除凭据“${credential.name}”吗？被引用时服务器会拒绝。`,
                          )
                        )
                          remove.mutate(credential.id);
                      }}
                    >
                      {remove.isPending && remove.variables === credential.id ? (
                        <CircularProgress size={18} />
                      ) : (
                        <DeleteOutline />
                      )}
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {remove.error && (
          <Box p={2}>
            <ErrorAlert error={remove.error} />
          </Box>
        )}
      </Paper>
      <CredentialDialog
        open={open || Boolean(rotating)}
        credential={rotating}
        onClose={() => {
          setOpen(false);
          setRotating(null);
        }}
      />
    </>
  );
}

interface MaintenanceDraft extends MaintenanceInput {
  mode: "ONCE" | "CRON";
}
const emptyMaintenance: MaintenanceDraft = {
  name: "",
  monitorId: null,
  timezone: "Asia/Shanghai",
  enabled: true,
  mode: "ONCE",
  startsAt: "",
  endsAt: "",
  cron: "",
  durationMinutes: 60,
};
function MaintenanceDialog({
  open,
  item,
  onClose,
}: {
  open: boolean;
  item?: MaintenanceWindow | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const monitors = useQuery({
    queryKey: ["monitors"],
    queryFn: api.monitors,
    enabled: open,
  });
  const [draft, setDraft] = useState<MaintenanceDraft>(emptyMaintenance);
  useEffect(() => {
    if (open)
      setDraft(
        item
          ? {
              name: item.name,
              monitorId: item.monitorId,
              timezone: item.timezone,
              enabled: item.enabled,
              mode: item.cron ? "CRON" : "ONCE",
              startsAt: item.startsAt
                ? new Date(item.startsAt).toISOString().slice(0, 16)
                : "",
              endsAt: item.endsAt
                ? new Date(item.endsAt).toISOString().slice(0, 16)
                : "",
              cron: item.cron ?? "",
              durationMinutes: item.durationMinutes ?? 60,
            }
          : emptyMaintenance,
      );
  }, [open, item]);
  const mutation = useCommandMutation({
    mutationFn: (input: MaintenanceInput) =>
      item
        ? api.updateMaintenance(item.id, input, item.version)
        : api.createMaintenance(input),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["maintenance"] });
      onClose();
    },
    successMessage: feedbackMessage(
      item ? "feedback.command.maintenanceUpdated" : "feedback.command.maintenanceCreated",
    ),
    errorFeedback: false,
  });
  const submit = () => {
    const base = {
      name: draft.name,
      monitorId: draft.monitorId || null,
      timezone: draft.timezone,
      enabled: draft.enabled,
    };
    const input: MaintenanceInput =
      draft.mode === "CRON"
        ? { ...base, cron: draft.cron, durationMinutes: draft.durationMinutes }
        : {
            ...base,
            startsAt: new Date(draft.startsAt!).toISOString(),
            endsAt: new Date(draft.endsAt!).toISOString(),
          };
    mutation.mutate(input);
  };
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{item ? "编辑维护窗口" : "新建维护窗口"}</DialogTitle>
      <DialogContent>
        <Stack gap={2} sx={{ mt: 1 }}>
          <ErrorAlert error={mutation.error} />
          <TextField
            label="名称"
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
          />
          <TextField
            select
            label="监控范围"
            value={draft.monitorId ?? ""}
            onChange={(event) =>
              setDraft({ ...draft, monitorId: event.target.value || null })
            }
          >
            <MenuItem value="">全部监控</MenuItem>
            {(monitors.data ?? []).map((monitor) => (
              <MenuItem key={monitor.id} value={monitor.id}>
                {monitor.name}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
            <TextField
              select
              fullWidth
              label="模式"
              value={draft.mode}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  mode: event.target.value as MaintenanceDraft["mode"],
                })
              }
            >
              <MenuItem value="ONCE">一次性</MenuItem>
              <MenuItem value="CRON">Cron 计划</MenuItem>
            </TextField>
            <TextField
              fullWidth
              label="IANA 时区"
              value={draft.timezone}
              onChange={(event) =>
                setDraft({ ...draft, timezone: event.target.value })
              }
            />
          </Stack>
          {draft.mode === "ONCE" ? (
            <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
              <TextField
                fullWidth
                type="datetime-local"
                label="开始"
                InputLabelProps={{ shrink: true }}
                value={draft.startsAt}
                onChange={(event) =>
                  setDraft({ ...draft, startsAt: event.target.value })
                }
              />
              <TextField
                fullWidth
                type="datetime-local"
                label="结束"
                InputLabelProps={{ shrink: true }}
                value={draft.endsAt}
                onChange={(event) =>
                  setDraft({ ...draft, endsAt: event.target.value })
                }
              />
            </Stack>
          ) : (
            <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
              <TextField
                fullWidth
                label="Cron 表达式"
                value={draft.cron}
                onChange={(event) =>
                  setDraft({ ...draft, cron: event.target.value })
                }
              />
              <TextField
                fullWidth
                type="number"
                label="持续分钟"
                value={draft.durationMinutes}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    durationMinutes: Number(event.target.value),
                  })
                }
              />
            </Stack>
          )}
          <FormControlLabel
            control={
              <Switch
                checked={draft.enabled}
                onChange={(event) =>
                  setDraft({ ...draft, enabled: event.target.checked })
                }
              />
            }
            label="启用"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="contained"
          disabled={
            !draft.name ||
            mutation.isPending ||
            (draft.mode === "ONCE"
              ? !draft.startsAt || !draft.endsAt
              : !draft.cron)
          }
          onClick={submit}
        >
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function MaintenancePage() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["maintenance"],
    queryFn: api.maintenance,
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MaintenanceWindow | null>(null);
  const remove = useCommandMutation({
    mutationFn: api.deleteMaintenance,
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["maintenance"] }),
    successMessage: feedbackMessage("feedback.command.maintenanceDeleted"),
  });
  return (
    <>
      <PageHeader
        title="维护窗口"
        subtitle="窗口内继续探测，但抑制 incident 和动作。"
        action={
          <Button
            variant="contained"
            startIcon={<AddOutlined />}
            onClick={() => setOpen(true)}
          >
            新建窗口
          </Button>
        }
      />
      <Paper variant="outlined">
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>名称</TableCell>
                <TableCell>范围</TableCell>
                <TableCell>计划</TableCell>
                <TableCell>时区</TableCell>
                <TableCell>状态</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(query.data ?? []).map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Typography fontWeight={700}>{item.name}</Typography>
                  </TableCell>
                  <TableCell>{item.monitor?.name ?? "全部监控"}</TableCell>
                  <TableCell>
                    {item.cron
                      ? `${item.cron} / ${item.durationMinutes} 分钟`
                      : `${item.startsAt ? new Date(item.startsAt).toLocaleString() : "-"} 至 ${item.endsAt ? new Date(item.endsAt).toLocaleString() : "-"}`}
                  </TableCell>
                  <TableCell>{item.timezone}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={item.enabled ? "success" : "default"}
                      label={item.enabled ? "启用" : "停用"}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      aria-label={`编辑维护窗口 ${item.name}`}
                      onClick={() => setEditing(item)}
                    >
                      <EditOutlined />
                    </IconButton>
                    <IconButton
                      color="error"
                      aria-label={`删除维护窗口 ${item.name}`}
                      disabled={remove.isPending && remove.variables === item.id}
                      onClick={() => {
                        if (window.confirm(`确定删除“${item.name}”吗？`))
                          remove.mutate(item.id);
                      }}
                    >
                      {remove.isPending && remove.variables === item.id ? (
                        <CircularProgress size={18} />
                      ) : (
                        <DeleteOutline />
                      )}
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      <MaintenanceDialog
        open={open || Boolean(editing)}
        item={editing}
        onClose={() => {
          setOpen(false);
          setEditing(null);
        }}
      />
    </>
  );
}

function OneTimeToken({ token }: { token: string }) {
  const { runCommand } = useActionFeedback();
  return (
    <TextField
      fullWidth
      label="一次性令牌"
      value={token}
      InputProps={{
        readOnly: true,
        endAdornment: (
          <Tooltip title="复制">
            <IconButton
              aria-label="复制一次性令牌"
              onClick={() =>
                void runCommand(() => navigator.clipboard.writeText(token), {
                  successMessage: feedbackMessage("feedback.command.tokenCopied"),
                  errorMessage: feedbackMessage("feedback.command.tokenCopyFailed"),
                })
              }
            >
              <ContentCopyOutlined />
            </IconButton>
          </Tooltip>
        ),
      }}
    />
  );
}
export function AgentsPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["agents"], queryFn: api.agents });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const enroll = useCommandMutation({
    mutationFn: api.enrollAgent,
    onSuccess: async (result) => {
      setToken(result.enrollmentToken);
      await client.invalidateQueries({ queryKey: ["agents"] });
    },
    successMessage: feedbackMessage("feedback.command.agentEnrollmentCreated"),
  });
  const rotate = useCommandMutation({
    mutationFn: ({ id, rowVersion }: { id: string; rowVersion: number }) =>
      api.rotateAgent(id, rowVersion),
    onSuccess: (result) => setToken(result.enrollmentToken),
    successMessage: feedbackMessage("feedback.command.agentRotated"),
  });
  const revoke = useCommandMutation({
    mutationFn: ({ id, rowVersion }: { id: string; rowVersion: number }) =>
      api.revokeAgent(id, rowVersion),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["agents"] }),
    successMessage: feedbackMessage("feedback.command.agentRevoked"),
  });
  return (
    <>
      <PageHeader
        title="Linux Agent"
        subtitle="Agent 仅建立出站 WSS 连接，执行受控宿主命令。"
        action={
          <Button
            variant="contained"
            startIcon={<AddOutlined />}
            onClick={() => {
              setToken("");
              setOpen(true);
            }}
          >
            注册 Agent
          </Button>
        }
      />
      {token && (
        <Alert
          severity="success"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" onClick={() => setToken("")}>
              关闭
            </Button>
          }
        >
          <OneTimeToken token={token} />
        </Alert>
      )}
      <Paper variant="outlined">
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Agent</TableCell>
                <TableCell>状态</TableCell>
                <TableCell>版本</TableCell>
                <TableCell>最后心跳</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(query.data ?? []).map((agent) => (
                <TableRow key={agent.id}>
                  <TableCell>
                    <Stack direction="row" gap={1} alignItems="center">
                      <TerminalOutlined color="action" />
                      <Typography fontWeight={700}>{agent.name}</Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={agent.status === "ONLINE" ? "success" : "default"}
                      label={agent.status}
                    />
                  </TableCell>
                  <TableCell>{agent.version ?? "-"}</TableCell>
                  <TableCell>
                    <RelativeTime value={agent.lastSeenAt} />
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      startIcon={<RefreshOutlined />}
                      aria-label={`轮换 Agent ${agent.name} 凭据`}
                      disabled={
                        agent.status === "REVOKED" ||
                        (rotate.isPending && rotate.variables?.id === agent.id)
                      }
                      onClick={() => {
                        if (
                          window.confirm("轮换后旧凭据会立即失效，是否继续？")
                        )
                          rotate.mutate({
                            id: agent.id,
                            rowVersion: agent.rowVersion,
                          });
                      }}
                    >
                      {rotate.isPending && rotate.variables?.id === agent.id
                        ? "轮换中"
                        : "轮换凭据"}
                    </Button>
                    <IconButton
                      color="error"
                      aria-label={`撤销 Agent ${agent.name}`}
                      disabled={
                        agent.status === "REVOKED" ||
                        (revoke.isPending && revoke.variables?.id === agent.id)
                      }
                      onClick={() => {
                        if (window.confirm(`确定撤销 Agent“${agent.name}”吗？`))
                          revoke.mutate({
                            id: agent.id,
                            rowVersion: agent.rowVersion,
                          });
                      }}
                    >
                      {revoke.isPending && revoke.variables?.id === agent.id ? (
                        <CircularProgress size={18} />
                      ) : (
                        <DeleteOutline />
                      )}
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>注册 Linux Agent</DialogTitle>
        <DialogContent>
          <Stack gap={2} sx={{ mt: 1 }}>
            {token ? (
              <>
                <Alert severity="success" icon={<CheckCircleOutline />}>
                  Agent 已创建。令牌只显示一次。
                </Alert>
                <OneTimeToken token={token} />
              </>
            ) : (
              <>
                <ErrorAlert error={enroll.error} />
                <TextField
                  label="Agent 名称"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <Alert severity="info">
                  首次成功连接后，一次性注册令牌将失效。
                </Alert>
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>
            {token ? "完成" : "取消"}
          </Button>
          {!token && (
            <Button
              variant="contained"
              disabled={!name || enroll.isPending}
              onClick={() => enroll.mutate(name)}
            >
              生成令牌
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}

function RoleDialog({
  open,
  role,
  onClose,
}: {
  open: boolean;
  role?: Role | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  useEffect(() => {
    if (open) {
      setName(role?.name ?? "");
      setDescription(role?.description ?? "");
      setPermissions(role?.permissions ?? []);
    }
  }, [open, role]);
  const mutation = useCommandMutation({
    mutationFn: () =>
      role
        ? api.updateRole(role.id, {
            name,
            description,
            permissions,
            version: role.version,
          })
        : api.createRole({ name, description, permissions }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["roles"] });
      onClose();
    },
    successMessage: feedbackMessage(
      role ? "feedback.command.roleUpdated" : "feedback.command.roleCreated",
    ),
    errorFeedback: false,
  });
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{role ? "编辑角色" : "新建角色"}</DialogTitle>
      <DialogContent>
        <Stack gap={2} sx={{ mt: 1 }}>
          <ErrorAlert error={mutation.error} />
          <TextField
            label="名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <TextField
            label="说明"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "1fr 1fr",
                md: "1fr 1fr 1fr",
              },
            }}
          >
            {PERMISSIONS.map((permission) => (
              <FormControlLabel
                key={permission}
                control={
                  <Checkbox
                    checked={permissions.includes(permission)}
                    onChange={(event) =>
                      setPermissions(
                        event.target.checked
                          ? [...permissions, permission]
                          : permissions.filter((item) => item !== permission),
                      )
                    }
                  />
                }
                label={permission}
              />
            ))}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="contained"
          disabled={!name || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          保存角色
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function UserDialog({
  open,
  roles,
  user,
  onClose,
}: {
  open: boolean;
  roles: Role[];
  user?: User | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [locale, setLocale] = useState<"zh-CN" | "en-US">("zh-CN");
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [disabled, setDisabled] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(user?.displayName ?? "");
    setEmail(user?.email ?? "");
    setPassword("");
    setRoleIds(user?.roles.map(({ role }) => role.id) ?? []);
    setLocale(user?.locale ?? "zh-CN");
    setTimezone(user?.timezone ?? "Asia/Shanghai");
    setDisabled(Boolean(user?.disabledAt));
  }, [open, user]);
  const mutation = useCommandMutation({
    mutationFn: () =>
      user
        ? api.updateUser(user.id, {
            version: user.version,
            displayName: name,
            locale,
            timezone,
            disabled,
            roleIds,
          })
        : api.createUser({ email, displayName: name, password, roleIds }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["users"] });
      onClose();
    },
    successMessage: feedbackMessage(
      user ? "feedback.command.userUpdated" : "feedback.command.userCreated",
    ),
    errorFeedback: false,
  });
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{user ? "编辑用户" : "添加本地用户"}</DialogTitle>
      <DialogContent>
        <Stack gap={2} sx={{ mt: 1 }}>
          <ErrorAlert error={mutation.error} />
          <TextField
            label="显示名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {!user && (
            <>
              <TextField
                type="email"
                label="邮箱"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <TextField
                type="password"
                label="临时密码"
                helperText="至少 12 个字符"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </>
          )}
          <TextField
            select
            SelectProps={{ multiple: true }}
            label="角色"
            value={roleIds}
            onChange={(event) =>
              setRoleIds(
                typeof event.target.value === "string"
                  ? event.target.value.split(",")
                  : event.target.value,
              )
            }
          >
            {roles.map((role) => (
              <MenuItem key={role.id} value={role.id}>
                {role.name}
              </MenuItem>
            ))}
          </TextField>
          {user && (
            <>
              <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
                <TextField
                  select
                  fullWidth
                  label="界面语言"
                  value={locale}
                  onChange={(event) =>
                    setLocale(event.target.value as "zh-CN" | "en-US")
                  }
                >
                  <MenuItem value="zh-CN">简体中文</MenuItem>
                  <MenuItem value="en-US">English</MenuItem>
                </TextField>
                <TextField
                  fullWidth
                  label="显示时区"
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                />
              </Stack>
              <FormControlLabel
                control={
                  <Switch
                    checked={disabled}
                    onChange={(event) => setDisabled(event.target.checked)}
                  />
                }
                label="禁用账户"
              />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="contained"
          disabled={
            !name ||
            (!user && (!email || password.length < 12)) ||
            mutation.isPending
          }
          onClick={() => mutation.mutate()}
        >
          {user ? "保存用户" : "创建用户"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function TokenDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [token, setToken] = useState("");
  const mutation = useCommandMutation({
    mutationFn: () => api.createToken({ name, scopes }),
    onSuccess: async (result) => {
      setToken(result.token);
      await client.invalidateQueries({ queryKey: ["tokens"] });
    },
    successMessage: feedbackMessage("feedback.command.apiTokenCreated"),
    errorFeedback: false,
  });
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>创建 API 令牌</DialogTitle>
      <DialogContent>
        <Stack gap={2} sx={{ mt: 1 }}>
          {token ? (
            <>
              <Alert severity="success">令牌只显示一次。</Alert>
              <OneTimeToken token={token} />
            </>
          ) : (
            <>
              <ErrorAlert error={mutation.error} />
              <TextField
                label="令牌名称"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "1fr",
                    sm: "1fr 1fr",
                    md: "1fr 1fr 1fr",
                  },
                }}
              >
                {PERMISSIONS.map((permission) => (
                  <FormControlLabel
                    key={permission}
                    control={
                      <Checkbox
                        checked={scopes.includes(permission)}
                        onChange={(event) =>
                          setScopes(
                            event.target.checked
                              ? [...scopes, permission]
                              : scopes.filter((item) => item !== permission),
                          )
                        }
                      />
                    }
                    label={permission}
                  />
                ))}
              </Box>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{token ? "完成" : "取消"}</Button>
        {!token && (
          <Button
            variant="contained"
            disabled={!name || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            创建令牌
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export function AccessPage() {
  const client = useQueryClient();
  const [tab, setTab] = useState(0);
  const [userOpen, setUserOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [roleOpen, setRoleOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [tokenOpen, setTokenOpen] = useState(false);
  const users = useQuery({ queryKey: ["users"], queryFn: api.users });
  const roles = useQuery({ queryKey: ["roles"], queryFn: api.roles });
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: api.tokens });
  const deleteRole = useCommandMutation({
    mutationFn: api.deleteRole,
    onSuccess: () => void client.invalidateQueries({ queryKey: ["roles"] }),
    successMessage: feedbackMessage("feedback.command.roleDeleted"),
  });
  const revoke = useCommandMutation({
    mutationFn: api.revokeToken,
    onSuccess: () => void client.invalidateQueries({ queryKey: ["tokens"] }),
    successMessage: feedbackMessage("feedback.command.apiTokenRevoked"),
  });
  const action =
    tab === 0 ? (
      <Button
        variant="contained"
        startIcon={<AddOutlined />}
        onClick={() => setUserOpen(true)}
      >
        添加用户
      </Button>
    ) : tab === 1 ? (
      <Button
        variant="contained"
        startIcon={<AddOutlined />}
        onClick={() => setRoleOpen(true)}
      >
        新建角色
      </Button>
    ) : (
      <Button
        variant="contained"
        startIcon={<AddOutlined />}
        onClick={() => setTokenOpen(true)}
      >
        创建令牌
      </Button>
    );
  return (
    <>
      <PageHeader
        title="用户与权限"
        subtitle="角色由固定权限键组合，API 令牌只能缩小当前用户权限。"
        action={action}
      />
      <Paper variant="outlined">
        <Tabs
          value={tab}
          onChange={(_event, value) => setTab(value)}
          sx={{ borderBottom: 1, borderColor: "divider" }}
        >
          <Tab label="用户" />
          <Tab label="角色" />
          <Tab label="API 令牌" />
        </Tabs>
        {tab === 0 && (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>用户</TableCell>
                  <TableCell>角色</TableCell>
                  <TableCell>时区</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(users.data ?? []).map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <Typography fontWeight={700}>
                        {user.displayName}
                      </Typography>
                      <Typography variant="caption">{user.email}</Typography>
                    </TableCell>
                    <TableCell>
                      {user.roles.map(({ role }) => (
                        <Chip
                          key={role.id}
                          size="small"
                          label={role.name}
                          sx={{ mr: 0.5 }}
                        />
                      ))}
                    </TableCell>
                    <TableCell>{user.timezone}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={user.disabledAt ? "default" : "success"}
                        label={user.disabledAt ? "已禁用" : "有效"}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        startIcon={<EditOutlined />}
                        onClick={() => setEditingUser(user)}
                      >
                        编辑
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {tab === 1 && (
          <Stack divider={<Divider />}>
            {(roles.data ?? []).map((role) => (
              <Stack
                key={role.id}
                direction={{ xs: "column", sm: "row" }}
                alignItems={{ sm: "center" }}
                gap={1.5}
                sx={{ p: 2 }}
              >
                <SecurityOutlined color={role.system ? "primary" : "action"} />
                <Box flex={1}>
                  <Typography fontWeight={700}>{role.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {role.description || "无说明"}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  label={`${role.permissions.length} 项权限`}
                />
                <Button
                  size="small"
                  disabled={role.system}
                  onClick={() => setEditingRole(role)}
                >
                  编辑
                </Button>
                <IconButton
                  color="error"
                  aria-label={`删除角色 ${role.name}`}
                  disabled={
                    role.system ||
                    (deleteRole.isPending && deleteRole.variables === role.id)
                  }
                  onClick={() => {
                    if (window.confirm(`确定删除角色“${role.name}”吗？`))
                      deleteRole.mutate(role.id);
                  }}
                >
                  {deleteRole.isPending && deleteRole.variables === role.id ? (
                    <CircularProgress size={18} />
                  ) : (
                    <DeleteOutline />
                  )}
                </IconButton>
              </Stack>
            ))}
          </Stack>
        )}
        {tab === 2 && (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>名称</TableCell>
                  <TableCell>范围</TableCell>
                  <TableCell>创建时间</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(tokens.data ?? []).map((token: ApiToken) => (
                  <TableRow key={token.id}>
                    <TableCell>{token.name}</TableCell>
                    <TableCell>{token.scopes.length} 项权限</TableCell>
                    <TableCell>
                      <RelativeTime value={token.createdAt} />
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={token.revokedAt ? "已撤销" : "有效"}
                        color={token.revokedAt ? "default" : "success"}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        color="error"
                        disabled={
                          Boolean(token.revokedAt) ||
                          (revoke.isPending && revoke.variables === token.id)
                        }
                        onClick={() => {
                          if (window.confirm(`确定撤销令牌“${token.name}”吗？`))
                            revoke.mutate(token.id);
                        }}
                      >
                        {revoke.isPending && revoke.variables === token.id
                          ? "撤销中"
                          : "撤销"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
      <UserDialog
        open={userOpen || Boolean(editingUser)}
        roles={roles.data ?? []}
        user={editingUser}
        onClose={() => {
          setUserOpen(false);
          setEditingUser(null);
        }}
      />
      <RoleDialog
        open={roleOpen || Boolean(editingRole)}
        role={editingRole}
        onClose={() => {
          setRoleOpen(false);
          setEditingRole(null);
        }}
      />
      <TokenDialog open={tokenOpen} onClose={() => setTokenOpen(false)} />
    </>
  );
}

export function AuditPage() {
  const query = useQuery({ queryKey: ["audit"], queryFn: api.audit });
  const { notify } = useActionFeedback();
  const exportCsv = () => {
    try {
      const quote = (value: unknown) =>
        `"${String(value ?? "").replaceAll('"', '""')}"`;
      const rows = [
        ["time", "action", "resourceType", "resourceId", "actorId"],
        ...(query.data ?? []).map((item) => [
          item.createdAt,
          item.action,
          item.resourceType,
          item.resourceId ?? "",
          item.actorId ?? "",
        ]),
      ];
      const blob = new Blob(
        ["\uFEFF" + rows.map((row) => row.map(quote).join(",")).join("\r\n")],
        { type: "text/csv;charset=utf-8" },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `netsentinel-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      notify({
        severity: "success",
        message: feedbackMessage("feedback.command.auditExported", {
          count: query.data?.length ?? 0,
        }),
      });
    } catch {
      notify({
        severity: "error",
        message: feedbackMessage("feedback.command.auditExportFailed"),
      });
    }
  };
  return (
    <>
      <PageHeader
        title="审计日志"
        subtitle="追踪认证、配置、审批和动作执行变化。"
        action={
          <Button
            variant="outlined"
            disabled={!query.data?.length}
            onClick={exportCsv}
          >
            导出 CSV
          </Button>
        }
      />
      <Paper variant="outlined">
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>时间</TableCell>
                <TableCell>动作</TableCell>
                <TableCell>资源类型</TableCell>
                <TableCell>资源 ID</TableCell>
                <TableCell>执行者</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(query.data ?? []).map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <RelativeTime value={event.createdAt} />
                  </TableCell>
                  <TableCell>
                    <Typography component="code" variant="body2">
                      {event.action}
                    </Typography>
                  </TableCell>
                  <TableCell>{event.resourceType}</TableCell>
                  <TableCell>{event.resourceId ?? "-"}</TableCell>
                  <TableCell>{event.actorId ?? "系统"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </>
  );
}

interface SettingsDraft {
  timezone: string;
  locale: string;
  themeColor: ThemeColor;
  probeRetentionDays: number;
  auditRetentionDays: number;
  egressAllow: string;
  egressDeny: string;
  metricsEnabled: boolean;
  jsonLogs: boolean;
  statusPageEnabled: boolean;
  statusPageTitle: string;
  statusPageDescription: string;
  statusPageSupportUrl: string;
}
const defaultSettings: SettingsDraft = {
  timezone: "UTC",
  locale: "zh-CN",
  themeColor: "sky",
  probeRetentionDays: 90,
  auditRetentionDays: 365,
  egressAllow: "",
  egressDeny: "",
  metricsEnabled: true,
  jsonLogs: true,
  statusPageEnabled: true,
  statusPageTitle: "NetSentinel Status",
  statusPageDescription: "服务运行状态与历史可用性。",
  statusPageSupportUrl: "",
};
export function SettingsPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [draft, setDraft] = useState(defaultSettings);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!query.data) return;
    const values = new Map(query.data.map((item) => [item.key, item.value]));
    const storedThemeColor = values.get("themeColor");
    setDraft({
      timezone: String(values.get("timezone") ?? "UTC"),
      locale: String(values.get("locale") ?? "zh-CN"),
      themeColor: isThemeColor(storedThemeColor) ? storedThemeColor : "sky",
      probeRetentionDays: Number(values.get("probeRetentionDays") ?? 90),
      auditRetentionDays: Number(values.get("auditRetentionDays") ?? 365),
      egressAllow: Array.isArray(values.get("egressAllow"))
        ? (values.get("egressAllow") as string[]).join("\n")
        : "",
      egressDeny: Array.isArray(values.get("egressDeny"))
        ? (values.get("egressDeny") as string[]).join("\n")
        : "",
      metricsEnabled: values.get("metricsEnabled") !== false,
      jsonLogs: values.get("jsonLogs") !== false,
      statusPageEnabled: values.get("statusPageEnabled") !== false,
      statusPageTitle: String(values.get("statusPageTitle") ?? "NetSentinel Status"),
      statusPageDescription: String(values.get("statusPageDescription") ?? ""),
      statusPageSupportUrl: String(values.get("statusPageSupportUrl") ?? ""),
    });
  }, [query.data]);
  const mutation = useCommandMutation({
    mutationFn: () => {
      if (!draft.statusPageTitle.trim()) throw new Error("状态页标题不能为空");
      if (draft.statusPageSupportUrl.trim()) {
        try {
          const supportUrl = new URL(draft.statusPageSupportUrl);
          if (!["http:", "https:", "mailto:"].includes(supportUrl.protocol)) throw new Error();
        } catch {
          throw new Error("请输入有效的 HTTP、HTTPS 或 mailto 支持链接");
        }
      }
      return api.saveSettings([
        { key: "timezone", value: draft.timezone },
        { key: "locale", value: draft.locale },
        { key: "themeColor", value: draft.themeColor },
        { key: "probeRetentionDays", value: draft.probeRetentionDays },
        { key: "auditRetentionDays", value: draft.auditRetentionDays },
        {
          key: "egressAllow",
          value: draft.egressAllow
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean),
        },
        {
          key: "egressDeny",
          value: draft.egressDeny
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean),
        },
        { key: "metricsEnabled", value: draft.metricsEnabled },
        { key: "jsonLogs", value: draft.jsonLogs },
        { key: "statusPageEnabled", value: draft.statusPageEnabled },
        { key: "statusPageTitle", value: draft.statusPageTitle.trim() },
        { key: "statusPageDescription", value: draft.statusPageDescription.trim() },
        { key: "statusPageSupportUrl", value: draft.statusPageSupportUrl.trim() || null },
      ]);
    },
    onSuccess: (settings) => {
      client.setQueryData(["settings"], settings);
      setThemeColorPreference(draft.themeColor);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    successMessage: feedbackMessage("feedback.command.settingsSaved"),
    errorFeedback: false,
  });
  return (
    <>
      <PageHeader
        title="系统设置"
        subtitle="配置实例时区、数据保留、出口策略和自身可观测性。"
        action={
          <Button
            variant="contained"
            startIcon={<SaveOutlined />}
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            保存修改
          </Button>
        }
      />
      {saved && (
        <Alert severity="success" sx={{ mb: 2 }}>
          设置已保存。
        </Alert>
      )}
      <ErrorAlert error={mutation.error} />
      <Stack gap={2}>
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="h2">常规</Typography>
          <Stack direction={{ xs: "column", md: "row" }} gap={2} sx={{ mt: 2 }}>
            <TextField
              fullWidth
              label="实例默认时区"
              value={draft.timezone}
              onChange={(event) =>
                setDraft({ ...draft, timezone: event.target.value })
              }
            />
            <TextField
              select
              fullWidth
              label="默认语言"
              value={draft.locale}
              onChange={(event) =>
                setDraft({ ...draft, locale: event.target.value })
              }
            >
              <MenuItem value="zh-CN">简体中文</MenuItem>
              <MenuItem value="en-US">English</MenuItem>
            </TextField>
          </Stack>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "flex-start" }} gap={2}>
            <Box>
              <Typography variant="h2">公开状态页</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                向未登录访客公开服务可用性和脱敏事件，内部目标与错误不会显示。
              </Typography>
            </Box>
            <Button component="a" href="/status" target="_blank" rel="noopener noreferrer" variant="outlined" endIcon={<OpenInNewOutlined />}>
              打开状态页
            </Button>
          </Stack>
          <FormControlLabel
            sx={{ mt: 1 }}
            control={
              <Switch
                checked={draft.statusPageEnabled}
                onChange={(event) => setDraft({ ...draft, statusPageEnabled: event.target.checked })}
              />
            }
            label="启用公开状态页"
          />
          <Stack gap={2} sx={{ mt: 1.5 }}>
            <TextField
              fullWidth
              required
              inputProps={{ maxLength: 80 }}
              label="状态页标题"
              value={draft.statusPageTitle}
              onChange={(event) => setDraft({ ...draft, statusPageTitle: event.target.value })}
            />
            <TextField
              fullWidth
              multiline
              minRows={2}
              inputProps={{ maxLength: 300 }}
              label="状态页说明"
              value={draft.statusPageDescription}
              onChange={(event) => setDraft({ ...draft, statusPageDescription: event.target.value })}
            />
            <TextField
              fullWidth
              type="url"
              label="支持链接（可选）"
              placeholder="https://support.example.com"
              value={draft.statusPageSupportUrl}
              onChange={(event) => setDraft({ ...draft, statusPageSupportUrl: event.target.value })}
              helperText="支持 HTTP、HTTPS 或 mailto 地址"
            />
          </Stack>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="h2">主题色</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            选择控制台的强调色，浅蓝为默认值。
          </Typography>
          <Stack direction="row" gap={1.5} flexWrap="wrap" sx={{ mt: 2 }}>
            {THEME_COLOR_OPTIONS.map((option) => {
              const selected = draft.themeColor === option.value;
              return (
                <Tooltip key={option.value} title={option.label}>
                  <Box
                    component="button"
                    type="button"
                    aria-label={`主题色 ${option.label}`}
                    aria-pressed={selected}
                    onClick={() =>
                      setDraft({ ...draft, themeColor: option.value })
                    }
                    sx={{
                      width: 48,
                      height: 48,
                      p: 0,
                      display: "grid",
                      placeItems: "center",
                      borderRadius: 1,
                      border: "2px solid",
                      borderColor: selected ? "primary.main" : "divider",
                      bgcolor: "transparent",
                      cursor: "pointer",
                      transition: "border-color 120ms ease, transform 120ms ease",
                      "&:hover": { transform: "translateY(-1px)" },
                      "&:focus-visible": {
                        outline: "2px solid",
                        outlineColor: "primary.main",
                        outlineOffset: 2,
                      },
                    }}
                  >
                    <Box
                      sx={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        bgcolor: option.swatch,
                      }}
                    />
                  </Box>
                </Tooltip>
              );
            })}
          </Stack>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="h2">数据保留</Typography>
          <Stack direction={{ xs: "column", md: "row" }} gap={2} sx={{ mt: 2 }}>
            <TextField
              fullWidth
              type="number"
              label="探测与事件（天）"
              value={draft.probeRetentionDays}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  probeRetentionDays: Number(event.target.value),
                })
              }
            />
            <TextField
              fullWidth
              type="number"
              label="动作与审计（天）"
              value={draft.auditRetentionDays}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  auditRetentionDays: Number(event.target.value),
                })
              }
            />
          </Stack>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="h2">出口策略</Typography>
          <Stack direction={{ xs: "column", md: "row" }} gap={2} sx={{ mt: 2 }}>
            <TextField
              fullWidth
              multiline
              minRows={3}
              label="额外允许的域名或 CIDR"
              value={draft.egressAllow}
              onChange={(event) =>
                setDraft({ ...draft, egressAllow: event.target.value })
              }
            />
            <TextField
              fullWidth
              multiline
              minRows={3}
              label="额外拒绝的域名或 CIDR"
              value={draft.egressDeny}
              onChange={(event) =>
                setDraft({ ...draft, egressDeny: event.target.value })
              }
            />
          </Stack>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="h2">自身可观测性</Typography>
          <FormControlLabel
            control={
              <Switch
                checked={draft.metricsEnabled}
                onChange={(event) =>
                  setDraft({ ...draft, metricsEnabled: event.target.checked })
                }
              />
            }
            label="启用 Prometheus metrics"
          />
          <FormControlLabel
            control={
              <Switch
                checked={draft.jsonLogs}
                onChange={(event) =>
                  setDraft({ ...draft, jsonLogs: event.target.checked })
                }
              />
            }
            label="输出结构化 JSON 日志"
          />
        </Paper>
      </Stack>
    </>
  );
}
