import { describe, expect, it } from "vitest";
import { errorText, validationSummary, validationText } from "./error-messages";

describe("Chinese error messages", () => {
  it.each([
    ["ORIGIN_NOT_ALLOWED", "WEB_ORIGIN"],
    ["SETUP_UNAUTHORIZED", "安装令牌不正确"],
    ["AUTH_2FA_INVALID", "验证码或备用码无效"],
    ["BACKUP_PASSWORD_REQUIRED", "独立备份口令"],
    ["TARGET_BLOCKED", "出口访问策略阻止"],
    ["SSH disconnected; result uncertain", "执行结果不确定"],
  ])("explains %s without changing the original code", (code, explanation) => {
    const error = new Error(code);
    expect(errorText(error)).toContain(explanation);
    expect(error.message).toBe(code);
  });

  it("uses actionable Chinese fallbacks for unknown server and network errors", () => {
    const error = Object.assign(new Error("Unexpected upstream exception"), { status: 502 });
    expect(errorText(error)).toBe("服务器发生异常，请稍后重试。");
    expect(errorText(new TypeError("Failed to fetch"))).toContain("网络连接失败");
    expect(errorText("UNRECOGNIZED_ERROR", "无法读取初始化状态。")).toBe("无法读取初始化状态。");
    expect(errorText(new Error("监控不存在"))).toBe("监控不存在");
  });

  it("translates server validation issues and names the affected fields", () => {
    const error = Object.assign(new Error("Validation failed"), {
      status: 400,
      errors: [
        { path: "email", message: "Invalid email address" },
        { path: "password", message: "Too small: expected string to have >=12 characters" },
      ],
    });
    expect(errorText(error)).toBe("请检查输入。邮箱：请输入有效的邮箱地址。 密码：至少需要 12 个字符。");
  });

  it("uses local validation metadata and hides untranslated field names", () => {
    expect(validationText({ code: "too_big", origin: "number", maximum: 100, message: "Custom limit" }))
      .toBe("数值不能大于 100。");
    expect(validationSummary([{ path: ["steps", 0, "credentialId"], message: "Invalid input" }]))
      .toBe("步骤 › 第 1 项：输入的数据类型或格式不正确。");
  });
});
