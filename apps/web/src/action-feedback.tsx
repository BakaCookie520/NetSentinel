import {
  Alert,
  Button,
  Grow,
  IconButton,
  Portal,
  Stack,
} from "@mui/material";
import { CloseOutlined } from "@mui/icons-material";
import {
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { RunStatus, WorkflowRunSummary } from "@netsentinel/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "./api";
import {
  feedbackMessage,
  formatActionError,
  noticeDuration,
  removeNoticeById,
  resolveFeedbackMessage,
  terminalFeedback,
  type ActionNotice,
  type LocalizedMessage,
} from "./action-feedback-core";

export {
  feedbackMessage,
  formatActionError,
  terminalFeedback,
} from "./action-feedback-core";
export type { LocalizedMessage } from "./action-feedback-core";

type Feedback = ActionNotice & {
  id: number;
};

type TrackedRun = {
  id: string;
  label: string;
};

type NotifyInput = Omit<Feedback, "id">;

type ActionFeedbackValue = {
  notify: (input: NotifyInput) => void;
  trackRun: (run: WorkflowRunSummary, label: string) => void;
  runCommand: <T>(
    command: () => Promise<T>,
    options: {
      successMessage: LocalizedMessage;
      errorMessage?: LocalizedMessage;
    },
  ) => Promise<T | undefined>;
};

const STORAGE_KEY = "netsentinel.tracked-runs";
const TERMINAL = new Set<RunStatus>([
  "SUCCEEDED",
  "FAILED",
  "UNKNOWN",
  "CANCELLED",
]);
const ActionFeedbackContext = createContext<ActionFeedbackValue | null>(null);

type PauseReason = "hover" | "focus" | "document";

function FeedbackItem({
  item,
  onRemove,
}: {
  item: Feedback;
  onRemove: (id: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(true);
  const remaining = useRef(noticeDuration(item.severity));
  const startedAt = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  const pauses = useRef(new Set<PauseReason>());

  const stopTimer = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (startedAt.current !== null) {
      remaining.current = Math.max(
        0,
        remaining.current - (performance.now() - startedAt.current),
      );
      startedAt.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    if (pauses.current.size || timer.current !== null || !open) return;
    if (remaining.current <= 0) {
      setOpen(false);
      return;
    }
    startedAt.current = performance.now();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      startedAt.current = null;
      remaining.current = 0;
      setOpen(false);
    }, remaining.current);
  }, [open]);

  const pause = useCallback(
    (reason: PauseReason) => {
      const wasRunning = pauses.current.size === 0;
      pauses.current.add(reason);
      if (wasRunning) stopTimer();
    },
    [stopTimer],
  );

  const resume = useCallback(
    (reason: PauseReason) => {
      pauses.current.delete(reason);
      if (pauses.current.size === 0) startTimer();
    },
    [startTimer],
  );

  const dismiss = useCallback(() => {
    stopTimer();
    setOpen(false);
  }, [stopTimer]);

  useEffect(() => {
    startTimer();
    return stopTimer;
  }, [startTimer, stopTimer]);

  useEffect(() => {
    const syncVisibility = () => {
      if (document.hidden) pause("document");
      else resume("document");
    };
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () =>
      document.removeEventListener("visibilitychange", syncVisibility);
  }, [pause, resume]);

  const locale = i18n.resolvedLanguage ?? i18n.language;
  const translate = useCallback(
    (key: string, values?: Record<string, string | number>) =>
      String(t(key, values)),
    [t],
  );
  const message = resolveFeedbackMessage(item.message, locale, translate);
  const actionLabel = item.actionLabel
    ? resolveFeedbackMessage(item.actionLabel, locale, translate)
    : String(t("feedback.view"));

  return (
    <Grow in={open} onExited={() => onRemove(item.id)} appear>
      <Alert
        data-feedback-id={item.id}
        severity={item.severity}
        variant="filled"
        role={item.severity === "error" || item.severity === "warning" ? "alert" : "status"}
        onMouseEnter={() => pause("hover")}
        onMouseLeave={() => resume("hover")}
        onFocusCapture={() => pause("focus")}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            resume("focus");
          }
        }}
        action={
          <Stack direction="row" alignItems="center" gap={0.25}>
            {item.href && (
              <Button
                color="inherit"
                component={RouterLink}
                to={item.href}
                onClick={dismiss}
                sx={{ whiteSpace: "nowrap" }}
              >
                {actionLabel}
              </Button>
            )}
            <IconButton
              color="inherit"
              size="small"
              aria-label={String(t("feedback.close"))}
              onClick={dismiss}
            >
              <CloseOutlined fontSize="small" />
            </IconButton>
          </Stack>
        }
        sx={{
          width: "100%",
          alignItems: "center",
          boxShadow: 6,
          pointerEvents: "auto",
          "& .MuiAlert-message": {
            minWidth: 0,
            overflowWrap: "anywhere",
          },
          "& .MuiAlert-action": { alignItems: "center", pt: 0 },
        }}
      >
        {message}
      </Alert>
    </Grow>
  );
}

function loadTrackedRuns(): TrackedRun[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter(
          (item): item is TrackedRun =>
            typeof item?.id === "string" && typeof item?.label === "string",
        )
      : [];
  } catch {
    return [];
  }
}

export function ActionFeedbackProvider({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<Feedback[]>([]);
  const sequence = useRef(0);
  const stack = useRef<HTMLDivElement | null>(null);
  const tracked = useRef(new Map(loadTrackedRuns().map((run) => [run.id, run])));

  const notify = useCallback((input: NotifyInput) => {
    setQueue((current) => [
      ...current,
      { ...input, id: ++sequence.current },
    ]);
  }, []);

  const persistTracked = useCallback(() => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([...tracked.current.values()]),
    );
  }, []);

  const finishRun = useCallback(
    (id: string, status: RunStatus) => {
      const run = tracked.current.get(id);
      if (!run || !TERMINAL.has(status)) return;
      tracked.current.delete(id);
      persistTracked();
      notify(terminalFeedback(run, status));
    },
    [notify, persistTracked],
  );

  const trackRun = useCallback(
    (run: WorkflowRunSummary, label: string) => {
      tracked.current.set(run.id, { id: run.id, label });
      persistTracked();
      notify({
        severity: "info",
        message: feedbackMessage("feedback.workflow.submitted", { label }),
        href: `/logs?source=ACTION&runId=${encodeURIComponent(run.id)}`,
        actionLabel: feedbackMessage("feedback.viewLogs"),
      });
      if (TERMINAL.has(run.status)) finishRun(run.id, run.status);
    },
    [finishRun, notify, persistTracked],
  );

  const runCommand = useCallback<ActionFeedbackValue["runCommand"]>(
    async (command, options) => {
      try {
        const result = await command();
        notify({ severity: "success", message: options.successMessage });
        return result;
      } catch (error) {
        notify({
          severity: "error",
          message: formatActionError(error, options.errorMessage),
        });
        return undefined;
      }
    },
    [notify],
  );

  useEffect(() => {
    if (!enabled) return;
    const events = new EventSource("/api/v1/events", { withCredentials: true });
    const finished = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as { runId: string; status: RunStatus };
        finishRun(data.runId, data.status);
      } catch {
        // Polling below remains the source-of-truth fallback for malformed events.
      }
    };
    events.addEventListener("workflow.finished", finished as EventListener);
    return () => events.close();
  }, [enabled, finishRun]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const poll = async () => {
      const runs = [...tracked.current.values()];
      await Promise.all(
        runs.map(async (run) => {
          try {
            const current = await api.workflowRun(run.id);
            if (active) finishRun(run.id, current.status);
          } catch {
            // A transient API error is surfaced by the next successful poll or SSE event.
          }
        }),
      );
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [enabled, finishRun]);

  const value = useMemo(
    () => ({ notify, trackRun, runCommand }),
    [notify, runCommand, trackRun],
  );
  const remove = useCallback(
    (id: number) => setQueue((items) => removeNoticeById(items, id)),
    [],
  );

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const element = stack.current;
      if (element) element.scrollTop = element.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [queue.length]);

  return (
    <ActionFeedbackContext.Provider value={value}>
      {children}
      {queue.length > 0 && (
        <Portal>
          <Stack
            ref={stack}
            data-feedback-stack
            role="region"
            aria-label={String(t("feedback.region"))}
            gap={1}
            sx={(theme) => ({
              position: "fixed",
              zIndex: theme.zIndex.snackbar,
              right: { xs: 2, sm: 3 },
              left: { xs: 2, sm: "auto" },
              bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
              width: { xs: "auto", sm: 560 },
              maxWidth: { xs: "calc(100vw - 32px)", sm: "calc(100vw - 48px)" },
              maxHeight: "calc(100dvh - 32px - env(safe-area-inset-bottom, 0px))",
              overflowY: "auto",
              overflowX: "hidden",
              overscrollBehavior: "contain",
              scrollbarWidth: "thin",
              pointerEvents: "none",
              pr: 0.25,
            })}
          >
            {queue.map((item) => (
              <FeedbackItem key={item.id} item={item} onRemove={remove} />
            ))}
          </Stack>
        </Portal>
      )}
    </ActionFeedbackContext.Provider>
  );
}

export function useActionFeedback() {
  const value = useContext(ActionFeedbackContext);
  if (!value) throw new Error("ActionFeedbackProvider is missing");
  return value;
}

type CommandMutationOptions<TData, TError, TVariables, TContext> =
  UseMutationOptions<TData, TError, TVariables, TContext> & {
    successMessage?:
      | LocalizedMessage
      | ((data: TData, variables: TVariables) => LocalizedMessage)
      | false;
    errorMessage?: LocalizedMessage;
    errorFeedback?: boolean;
    trackRun?: (data: TData, variables: TVariables) => {
      run: WorkflowRunSummary;
      label: string;
    } | null;
  };

export function useCommandMutation<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TContext = unknown,
>(
  options: CommandMutationOptions<TData, TError, TVariables, TContext>,
): UseMutationResult<TData, TError, TVariables, TContext> {
  const { notify, trackRun } = useActionFeedback();
  const {
    successMessage = feedbackMessage("feedback.command.defaultSuccess"),
    errorMessage,
    errorFeedback = true,
    trackRun: trackedRun,
    onSuccess,
    onError,
    ...mutationOptions
  } = options;

  return useMutation({
    ...mutationOptions,
    onSuccess: async (data, variables, mutationResult, context) => {
      const tracked = trackedRun?.(data, variables);
      if (tracked) trackRun(tracked.run, tracked.label);
      else if (successMessage)
        notify({
          severity: "success",
          message:
            typeof successMessage === "function"
              ? successMessage(data, variables)
              : successMessage,
        });
      await onSuccess?.(data, variables, mutationResult, context);
    },
    onError: async (error, variables, mutationResult, context) => {
      if (errorFeedback)
        notify({
          severity: "error",
          message: formatActionError(error, errorMessage),
        });
      await onError?.(error, variables, mutationResult, context);
    },
  });
}
