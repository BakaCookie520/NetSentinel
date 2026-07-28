import { describe, expect, it } from "vitest";
import {
  feedbackMessage,
  formatActionError,
  noticeDuration,
  removeNoticeById,
  resolveFeedbackMessage,
  terminalFeedback,
} from "./action-feedback-core";

describe("action feedback", () => {
  it("maps severity to an independent auto-dismiss duration", () => {
    expect(noticeDuration("success")).toBe(4_000);
    expect(noticeDuration("info")).toBe(4_000);
    expect(noticeDuration("warning")).toBe(6_000);
    expect(noticeDuration("error")).toBe(8_000);
  });

  it("removes only the requested notice", () => {
    expect(removeNoticeById([{ id: 1 }, { id: 2 }, { id: 3 }], 2)).toEqual([
      { id: 1 },
      { id: 3 },
    ]);
  });

  it("localizes English server errors for simplified Chinese", () => {
    const error = Object.assign(new Error("An unexpected error occurred"), {
      status: 500,
      problemTitle: "INTERNAL_SERVER_ERROR",
    });
    const message = formatActionError(error);
    const translate = (key: string) =>
      ({ "feedback.error.server": "服务器发生异常，请稍后重试" })[key] ?? key;

    expect(resolveFeedbackMessage(message, "zh-CN", translate)).toBe(
      "服务器发生异常，请稍后重试",
    );
    expect(resolveFeedbackMessage(message, "en-US", translate)).toBe(
      "An unexpected error occurred",
    );
  });

  it("uses a caller-provided localized error before HTTP classification", () => {
    const fallback = feedbackMessage("feedback.command.logsRefreshFailed");
    expect(
      formatActionError(
        Object.assign(new Error("An unexpected error occurred"), { status: 500 }),
        fallback,
      ),
    ).toBe(fallback);
  });

  it.each([
    ["SUCCEEDED", "success", "feedback.workflow.succeeded"],
    ["FAILED", "error", "feedback.workflow.failed"],
    ["CANCELLED", "warning", "feedback.workflow.cancelled"],
    ["UNKNOWN", "warning", "feedback.workflow.unknown"],
  ] as const)("maps %s workflow runs to localized terminal feedback", (status, severity, key) => {
    const feedback = terminalFeedback(
      { id: "run/123", label: "Recovery" },
      status,
    );
    expect(feedback.severity).toBe(severity);
    expect(feedback.message.key).toBe(key);
    expect(feedback.message.values).toEqual({ label: "Recovery" });
    expect(feedback.href).toBe("/logs?source=ACTION&runId=run%2F123");
  });
});
