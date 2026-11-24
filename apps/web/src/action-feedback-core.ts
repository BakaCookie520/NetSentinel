import type { RunStatus } from "@netsentinel/contracts";
import { errorText } from "./error-messages";

export type FeedbackSeverity = "success" | "error" | "warning" | "info";
export type FeedbackMessageKey = `feedback.${string}`;
export type FeedbackValues = Record<string, string | number>;

export type LocalizedMessage = {
  key: FeedbackMessageKey;
  values?: FeedbackValues;
  text?: string;
};

export type ActionNotice = {
  severity: FeedbackSeverity;
  message: LocalizedMessage;
  href?: string;
  actionLabel?: LocalizedMessage;
};

export function feedbackMessage(
  key: FeedbackMessageKey,
  values?: FeedbackValues,
): LocalizedMessage {
  return { key, ...(values ? { values } : {}) };
}

export function noticeDuration(severity: FeedbackSeverity): number {
  if (severity === "error") return 8_000;
  if (severity === "warning") return 6_000;
  return 4_000;
}

export function removeNoticeById<T extends { id: number }>(
  items: T[],
  id: number,
): T[] {
  return items.filter((item) => item.id !== id);
}

export function formatActionError(
  error: unknown,
  fallback?: LocalizedMessage,
): LocalizedMessage {
  if (fallback) return fallback;
  return { key: "feedback.error.unknown", text: errorText(error) };
}

export function resolveFeedbackMessage(
  message: LocalizedMessage,
  translate: (key: string, values?: FeedbackValues) => string,
): string {
  return message.text ?? translate(message.key, message.values);
}

export function terminalFeedback(
  run: { id: string; label: string },
  status: RunStatus,
): ActionNotice {
  const href = `/logs?source=ACTION&runId=${encodeURIComponent(run.id)}`;
  const key: FeedbackMessageKey =
    status === "SUCCEEDED"
      ? "feedback.workflow.succeeded"
      : status === "CANCELLED"
        ? "feedback.workflow.cancelled"
        : status === "UNKNOWN"
          ? "feedback.workflow.unknown"
          : "feedback.workflow.failed";
  const severity: FeedbackSeverity =
    status === "SUCCEEDED"
      ? "success"
      : status === "FAILED"
        ? "error"
        : "warning";
  return {
    severity,
    message: feedbackMessage(key, { label: run.label }),
    href,
    actionLabel: feedbackMessage("feedback.viewLogs"),
  };
}
