import { Box, Chip, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { MonitorStatus } from "./api";
import { useTranslation } from "react-i18next";

const statusMap: Record<MonitorStatus, { color: "success" | "warning" | "error" | "default" | "info" }> = {
  UP: { color: "success" }, DEGRADED: { color: "warning" }, DOWN: { color: "error" }, UNKNOWN: { color: "info" }, PAUSED: { color: "default" },
};
export function StatusChip({ status }: { status: MonitorStatus }) { const { t } = useTranslation(); const item = statusMap[status]; return <Chip size="small" variant={status === "UP" ? "outlined" : "filled"} color={item.color} label={t(`status.${status}`)} />; }

export function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }} gap={2} sx={{ mb: 2.5 }}>
    <Box><Typography variant="h1">{title}</Typography><Typography color="text.secondary" sx={{ mt: 0.5 }}>{subtitle}</Typography></Box>{action}
  </Stack>;
}

export function RelativeTime({ value }: { value?: string | null }) {
  const { t } = useTranslation();
  if (!value) return <span>—</span>;
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  return <span>{minutes < 1 ? t("time.now") : minutes < 60 ? t("time.minutes", { count: minutes }) : t("time.hours", { count: Math.round(minutes / 60) })}</span>;
}
