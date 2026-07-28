import type { RunStatus } from "@netsentinel/contracts";

export type FeedbackSeverity = "success" | "error" | "warning" | "info";
export type FeedbackMessageKey = `feedback.${string}`;
export type FeedbackValues = Record<string, string | number>;

export type LocalizedMessage = {
  key: FeedbackMessageKey;
  values?: FeedbackValues;
  englishDetail?: string;
};

export type ActionNotice = {
  severity: FeedbackSeverity;
  message: LocalizedMessage;
  href?: string;
  actionLabel?: LocalizedMessage;
};

type ErrorShape = Error & {
  status?: number;
  problemTitle?: string;
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

function errorMessageKey(status?: number): FeedbackMessageKey {
  if (status === 400 || status === 422) return "feedback.error.badRequest";
  if (status === 401) return "feedback.error.unauthorized";
  if (status === 403) return "feedback.error.forbidden";
  if (status === 404) return "feedback.error.notFound";
  if (status === 409) return "feedback.error.conflict";
  if (status === 429) return "feedback.error.rateLimited";
  if (status !== undefined && status >= 500) return "feedback.error.server";
  return "feedback.error.unknown";
}

export function formatActionError(
  error: unknown,
  fallback?: LocalizedMessage,
): LocalizedMessage {
  if (fallback) return fallback;
  if (!(error instanceof Error)) return feedbackMessage("feedback.error.unknown");

  const shaped = error as ErrorShape;
  const key =
    shaped.name === "TypeError" && shaped.status === undefined
      ? "feedback.error.network"
      : errorMessageKey(shaped.status);
  return {
    key,
    ...(error.message ? { englishDetail: error.message } : {}),
  };
}

export function resolveFeedbackMessage(
  message: LocalizedMessage,
  locale: string,
  translate: (key: string, values?: FeedbackValues) => string,
): string {
  if (locale.toLowerCase().startsWith("en") && message.englishDetail) {
    return message.englishDetail;
  }
  return translate(message.key, message.values);
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
