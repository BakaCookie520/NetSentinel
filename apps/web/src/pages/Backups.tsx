import { useEffect, useState } from "react";
import { BACKUP_GROUPS, type BackupGroup } from "@netsentinel/contracts";
import { Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Drawer, FormControlLabel, LinearProgress, MenuItem, Paper, Skeleton, Stack, Switch, TextField, Typography } from "@mui/material";
import { AddOutlined, DownloadOutlined, FileUploadOutlined, HistoryOutlined, MoreHorizOutlined, SaveOutlined, ScheduleOutlined } from "@mui/icons-material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../api";
import { backups, type BackupEntry, type BackupJob, type BackupPolicy } from "../backup-api";
import { PageHeader } from "../components";
import { errorText } from "../error-messages";
import "../backup-i18n";

type Action = "create" | "import" | "edit" | "download" | "restore" | "delete";
const bytes = (value: number) => value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
function Groups({ value, available = BACKUP_GROUPS, onChange }: { value: BackupGroup[]; available?: readonly BackupGroup[]; onChange(groups: BackupGroup[]): void }) {
  const { t } = useTranslation();
  return <Box component="fieldset" sx={{ m: 0, border: 1, borderColor: "divider", borderRadius: 2, px: 2, pb: 1 }}>
    <Typography component="legend" variant="subtitle2" sx={{ px: 0.5 }}>{t("backup.groupsLabel")}</Typography>
    <Stack>{available.map((group) => <FormControlLabel key={group}
      control={<Checkbox checked={value.includes(group)} onChange={(_, checked) => onChange(checked ? [...value, group] : value.filter((item) => item !== group))} />}
      label={<Box><Typography variant="body2">{t(`backup.groups.${group}`)}</Typography><Typography variant="caption" color="text.secondary">{t(`backup.groupHints.${group}`)}</Typography></Box>} />)}</Stack>
  </Box>;
}
export function BackupsPage() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const me = useQuery({ queryKey: ["current-user"], queryFn: api.me });
  const permitted = me.data?.user.authentication === "session" && (me.data.user.permissions.includes("backup:manage") || me.data.user.permissions.includes("*"));
  const enabled = Boolean(permitted && !api.isDemo);
  const list = useQuery({ queryKey: ["backups"], queryFn: backups.list, enabled, refetchInterval: 5000 });
  const policy = useQuery({ queryKey: ["backup-policy"], queryFn: backups.policy, enabled });
  const [draft, setDraft] = useState<BackupPolicy>();
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [policyOpen, setPolicyOpen] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [groups, setGroups] = useState<BackupGroup[]>([...BACKUP_GROUPS]);
  const [selected, setSelected] = useState<BackupEntry | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [secret, setSecret] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [job, setJob] = useState<BackupJob | null>(null);
  const [preview, setPreview] = useState<BackupEntry | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  useEffect(() => { if (policy.data) setDraft({ ...policy.data, groups: policy.data.groups ?? [...BACKUP_GROUPS] }); }, [policy.data]);
  useEffect(() => {
    if (!job || job.status !== "running") return;
    let stopped = false;
    const timer = setInterval(() => {
      void backups.job(job.id).then(async (next) => {
        if (stopped) return;
        if (next.status === "succeeded") {
          if (next.type === "restore" && next.sessionReset !== false) {
            sessionStorage.removeItem("netsentinel.user"); sessionStorage.removeItem("netsentinel.csrf");
            sessionStorage.setItem("netsentinel.restored", "true"); window.location.assign("/"); return;
          }
          setMessage(t("backup.complete"));
          await client.invalidateQueries({ queryKey: ["backups"] });
          if (next.type === "import" && next.backupId) {
            const entries = await backups.list();
            if (!stopped) setPreview(entries.find((entry) => entry.id === next.backupId) ?? null);
          }
        } else if (next.status === "failed") setError(errorText(next.error, "备份操作失败，请检查服务日志后重试。"));
        // Updating the terminal status tears down this effect. Finish import
        // preview loading first, rather than cancelling our own async callback.
        if (!stopped) setJob(next);
      }).catch((error: unknown) => {
        if (stopped) return;
        if (job.type === "restore" && job.sessionReset !== false && error instanceof ApiError && error.status === 401) {
          setReconnecting(true);
          void fetch("/api/v1/health/ready").then((response) => response.json()).then((health: { restoring?: boolean }) => {
            if (!health.restoring && !stopped) {
              sessionStorage.removeItem("netsentinel.user"); sessionStorage.removeItem("netsentinel.csrf");
              sessionStorage.setItem("netsentinel.restored", "true"); window.location.assign("/");
            }
          }).catch(() => undefined);
        } else setError(errorText(error));
      });
    }, 1500);
    return () => { stopped = true; clearInterval(timer); };
  }, [job?.id, job?.status, t, client]);
  const open = (next: Action, entry?: BackupEntry) => {
    setAction(next); setSelected(entry ?? null); setName(entry?.name ?? `${t("backup.sources.manual")} ${new Date().toLocaleString(i18n.language)}`);
    setGroups([...(entry?.groups ?? BACKUP_GROUPS)]);
    setNote(entry?.note ?? ""); setSecret(""); setConfirmation(""); setFile(undefined); setError(""); setMessage("");
  };
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError(""); setMessage("");
    try { await operation(); } catch (error) { setError(errorText(error)); } finally { setBusy(false); }
  };
  const submit = () => run(async () => {
    let started: BackupJob | undefined;
    if (action === "create") started = await backups.create(name.trim(), note, groups);
    if (action === "import") {
      if (!file) return;
      if (file.size > (policy.data?.uploadMaxBytes ?? 1024 ** 3)) throw new Error(t("backup.uploadTooLarge", { lng: "zh-CN" }));
      started = await backups.import(file, secret, name.trim());
    }
    if (action === "edit" && selected) await backups.update(selected.id, name.trim(), note);
    if (action === "delete" && selected) await backups.remove(selected.id);
    if (action === "download" && selected) await backups.download(selected.id, secret);
    if (action === "restore" && selected) started = await backups.restore(selected.id, secret, confirmation, groups);
    if (started) setJob(started); else setMessage(t("backup.complete"));
    setAction(null); setSecret(""); setConfirmation("");
    await client.invalidateQueries({ queryKey: ["backups"] });
  });
  const savePolicy = () => run(async () => {
    if (!draft) return;
    if ((password || passwordConfirm) && (password.length < 12 || password !== passwordConfirm)) throw new Error(t("backup.passwordMismatch", { lng: "zh-CN" }));
    const { passwordConfigured: _configured, uploadMaxBytes: _limit, ...options } = draft;
    await backups.savePolicy({ ...options, ...(password ? { password } : {}) });
    setPassword(""); setPasswordConfirm(""); setMessage(t("backup.saved"));
    await client.invalidateQueries({ queryKey: ["backup-policy"] }); setPolicyOpen(false);
  });
  const processing = busy || job?.status === "running";
  const date = (value?: string) => value ? new Date(value).toLocaleString(i18n.language) : "—";
  if (api.isDemo) return <Alert severity="info">{t("backup.demo")}</Alert>;
  if (me.isPending) return <Skeleton variant="rounded" height={240} />;
  if (!permitted) return <Alert severity="warning">{t("backup.forbidden", { lng: "zh-CN" })}</Alert>;
  return <>
    <PageHeader title={t("backup.title")} subtitle={t("backup.subtitle")} action={<Stack direction="row" gap={1} flexWrap="wrap">
      <Button startIcon={<ScheduleOutlined />} onClick={() => setPolicyOpen(true)}>{t("backup.policy")}</Button>
      <Button startIcon={<FileUploadOutlined />} disabled={processing} onClick={() => open("import")}>{t("backup.import")}</Button>
      <Button variant="contained" startIcon={<AddOutlined />} disabled={processing || !policy.data?.passwordConfigured} onClick={() => open("create")}>{t("backup.create")}</Button>
    </Stack>} />
    <Stack gap={2.5}>
      <Alert severity="warning">{t("backup.warning")}</Alert>
      {!policy.data?.passwordConfigured && policy.isSuccess && <Alert severity="info" action={<Button size="small" onClick={() => setPolicyOpen(true)}>{t("backup.policy")}</Button>}>{t("backup.setup")}</Alert>}
      {(error || list.error || policy.error) && <Alert severity="error" onClose={() => setError("")}>{error || errorText(list.error ?? policy.error, "无法读取备份信息，请稍后重试。")}</Alert>}
      {message && <Alert severity="success" onClose={() => setMessage("")}>{message}</Alert>}
      {job?.status === "running" && <Paper variant="outlined" sx={{ p: 2.5 }} aria-live="polite"><Typography fontWeight={650} sx={{ mb: 1.5 }}>{reconnecting ? t("backup.reconnect") : t(`backup.${job.type === "restore" ? "restoring" : job.type === "import" ? "importing" : "creating"}`)}</Typography><LinearProgress /></Paper>}
      <Stack direction="row" justifyContent="space-between" alignItems="center"><Typography variant="h2">{t("backup.history")}</Typography><Chip size="small" variant="outlined" label={list.data?.length ?? 0} /></Stack>
      {list.isPending ? [0, 1, 2].map((n) => <Skeleton key={n} variant="rounded" height={150} />) : list.data?.length === 0 ? <Paper variant="outlined" sx={{ py: 6, px: 3, textAlign: "center" }}><HistoryOutlined sx={{ fontSize: 38, color: "text.secondary", mb: 1.5 }} /><Typography variant="h2">{t("backup.empty")}</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>{t("backup.emptyHint")}</Typography></Paper> :
        list.data?.map((entry) => <Paper component="article" variant="outlined" key={entry.id} sx={{ p: { xs: 2, sm: 2.5 } }}>
          <Stack direction={{ xs: "column", sm: "row" }} gap={1.5} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
            <Box sx={{ minWidth: 0 }}><Typography fontWeight={700} sx={{ overflowWrap: "anywhere" }}>{entry.name}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, overflowWrap: "anywhere" }}>{entry.note || t("backup.noNote")}</Typography></Box>
            <Stack direction="row" gap={1}><Chip size="small" variant="outlined" label={t(`backup.sources.${entry.source}`)} /><Chip size="small" color={entry.status === "ready" ? "success" : entry.status === "failed" ? "error" : "info"} label={t(`backup.statuses.${entry.status}`, entry.status === "failed" ? { lng: "zh-CN" } : {})} /></Stack>
          </Stack>
          <Box component="dl" sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" }, gap: 2, my: 2.5, fontVariantNumeric: "tabular-nums" }}>
            {[["createdAt", date(entry.createdAt)], ["dataTime", date(entry.dataTime)], ["size", bytes(entry.size)], ["version", `v${entry.formatVersion}`]].map(([label, value]) => <Box key={label}><Typography component="dt" variant="caption" color="text.secondary">{t(`backup.${label}`)}</Typography><Typography component="dd" variant="body2" sx={{ m: 0, mt: 0.5, overflowWrap: "anywhere" }}>{value}</Typography></Box>)}
          </Box>
          {entry.error && <Alert severity="error" sx={{ mb: 2 }}>{errorText(entry.error, "备份操作失败，请检查服务日志后重试。")}</Alert>}
          <Divider /><Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 1.5 }}>
            <Button size="small" onClick={() => setPreview(entry)} startIcon={<MoreHorizOutlined />}>{t("backup.details")}</Button>
            <Button size="small" disabled={processing} onClick={() => open("edit", entry)}>{t("backup.edit")}</Button>
            <Button size="small" disabled={processing || entry.status !== "ready"} startIcon={<DownloadOutlined />} onClick={() => open("download", entry)}>{t("backup.download")}</Button>
            <Button size="small" disabled={processing || entry.status !== "ready" || !policy.data?.passwordConfigured} onClick={() => open("restore", entry)}>{t("backup.restore")}</Button>
            <Button size="small" color="error" disabled={processing} onClick={() => open("delete", entry)}>{t("backup.delete")}</Button>
          </Stack>
        </Paper>)}
    </Stack>
    <Drawer anchor="right" open={policyOpen} onClose={() => !busy && setPolicyOpen(false)} PaperProps={{ sx: { width: { xs: "100%", sm: 460 }, p: 3 } }}>
      <Stack gap={2.5}><Typography variant="h2">{t("backup.policy")}</Typography>{error && <Alert severity="error">{error}</Alert>}
        {draft && <><TextField type="password" label={t("backup.password")} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} helperText={t("backup.passwordHint")} />
          <TextField type="password" label={t("backup.passwordConfirm")} autoComplete="new-password" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} />
          <Divider /><FormControlLabel control={<Switch checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />} label={t("backup.automatic")} />
          <TextField select label={t("backup.frequency")} value={draft.frequency} onChange={(e) => setDraft({ ...draft, frequency: e.target.value as "daily" | "weekly" })}>{["daily", "weekly"].map((value) => <MenuItem key={value} value={value}>{t(`backup.${value}`)}</MenuItem>)}</TextField>
          {draft.frequency === "weekly" && <TextField select label={t("backup.weekday")} value={draft.weekday} onChange={(e) => setDraft({ ...draft, weekday: Number(e.target.value) })}>{Array.from({ length: 7 }, (_, index) => <MenuItem key={index} value={index}>{new Intl.DateTimeFormat(i18n.language, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + index)))}</MenuItem>)}</TextField>}
          <TextField type="time" label={t("backup.time")} slotProps={{ inputLabel: { shrink: true } }} value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} />
          <TextField label={t("backup.timezone")} value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} />
          <TextField type="number" label={t("backup.retain")} value={draft.retain} onChange={(e) => setDraft({ ...draft, retain: Number(e.target.value) })} helperText={t("backup.retainHint")} />
          <Groups value={draft.groups} onChange={(groups) => setDraft({ ...draft, groups })} />
          <Button variant="contained" disabled={busy || processing || !draft.groups.length} startIcon={<SaveOutlined />} onClick={() => void savePolicy()}>{t("backup.save")}</Button></>}
        <Button onClick={() => setPolicyOpen(false)}>{t("backup.close")}</Button>
      </Stack>
    </Drawer>
    <Dialog open={action !== null} onClose={() => !busy && setAction(null)} fullWidth maxWidth="sm" aria-labelledby="backup-action-title">
      <DialogTitle id="backup-action-title">{t(`backup.${action ?? "create"}`)}</DialogTitle><DialogContent><Stack gap={2.5} sx={{ pt: 1 }}>
        {error && <Alert severity="error">{error}</Alert>}
        {action === "import" && <><Alert severity="info">{t("backup.importHint")}</Alert><Button component="label" variant="outlined">{file?.name ?? t("backup.file")}<input hidden type="file" accept=".nsbackup" onChange={(e) => { const chosen = e.target.files?.[0]; setFile(chosen); if (chosen) setName(chosen.name.replace(/\.nsbackup$/u, "").slice(0, 120)); }} /></Button></>}
        {["create", "edit", "import"].includes(action ?? "") && <TextField label={t("backup.name")} value={name} onChange={(e) => setName(e.target.value)} inputProps={{ maxLength: 120 }} />}
        {["create", "edit"].includes(action ?? "") && <TextField label={t("backup.note")} multiline minRows={2} value={note} onChange={(e) => setNote(e.target.value)} inputProps={{ maxLength: 2000 }} />}
        {action === "download" && <Alert severity="info">{t("backup.downloadHint")}</Alert>}
        {action === "restore" && <Alert severity="warning">{t(groups.includes("accounts") ? "backup.restoreAccounts" : "backup.restoreSelection")}</Alert>}
        {(action === "create" || action === "restore") && <Groups value={groups} available={action === "restore" ? selected?.groups : undefined} onChange={setGroups} />}
        {action === "delete" && <Alert severity="warning">{t("backup.deleteWarning")}</Alert>}
        {["download", "restore", "import"].includes(action ?? "") && <TextField label={t(action === "import" ? "backup.importPassword" : "backup.currentPassword")} type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />}
        {action === "restore" && <TextField label={t("backup.confirmation")} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />}
        {busy && <LinearProgress />}
      </Stack></DialogContent><DialogActions><Button disabled={busy} onClick={() => setAction(null)}>{t("backup.cancel")}</Button><Button variant="contained" color={action === "delete" || action === "restore" ? "error" : "primary"} disabled={busy || ((action === "create" || action === "restore") && !groups.length) || (["create", "edit", "import"].includes(action ?? "") && !name.trim()) || (["download", "restore", "import"].includes(action ?? "") && !secret) || (action === "import" && !file) || (action === "restore" && confirmation !== "RESTORE")} onClick={() => void submit()}>{t("backup.confirm")}</Button></DialogActions>
    </Dialog>
    <Drawer anchor="right" open={preview !== null} onClose={() => setPreview(null)} PaperProps={{ sx: { width: { xs: "100%", sm: 480 }, p: 3 } }}>
      {preview && <Stack gap={2.5}><Typography variant="h2">{t("backup.details")}</Typography>{preview.source === "import" && <Alert severity="info">{t("backup.preview")}</Alert>}<Typography fontWeight={700} sx={{ overflowWrap: "anywhere" }}>{preview.name}</Typography><Typography color="text.secondary">{date(preview.dataTime)}</Typography><Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>{preview.note}</Typography><Stack direction="row" flexWrap="wrap" gap={1}>{(preview.groups ?? BACKUP_GROUPS).map((group) => <Chip key={group} size="small" label={t(`backup.groups.${group}`)} />)}</Stack><Divider /><Typography fontWeight={650}>{t("backup.records")}</Typography>{Object.entries(preview.counts ?? {}).map(([table, count]) => <Stack key={table} direction="row" justifyContent="space-between"><Typography variant="body2">{table}</Typography><Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>{count.toLocaleString(i18n.language)}</Typography></Stack>)}<Button variant="contained" disabled={processing || preview.status !== "ready" || !policy.data?.passwordConfigured} onClick={() => { open("restore", preview); setPreview(null); }}>{t("backup.restore")}</Button><Button onClick={() => setPreview(null)}>{t("backup.close")}</Button></Stack>}
    </Drawer>
  </>;
}
