import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });
test("four-step installation supports optional 2FA and mandatory recovery acknowledgement", async ({ page }, testInfo) => {
  let step = 0; let finished = false; let acknowledged = false;
  const user = { id: "setup-owner", email: "owner@example.com", displayName: "Owner", avatarUrl: null, permissions: ["monitor:read", "backup:manage"], authentication: "session", forcePasswordChange: false };
  await page.route("**/api/v1/setup/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/status")) return route.fulfill({ json: { initialized: finished, step, database: step ? "sqlite" : null } });
    if (path.endsWith("/unlock")) return route.fulfill({ json: { csrfToken: "setup-csrf" } });
    if (path.endsWith("/database")) { expect(route.request().postDataJSON()).toEqual({ type: "sqlite" }); step = 1; return route.fulfill({ json: { ok: true } }); }
    if (path.endsWith("/account")) { expect(route.request().postDataJSON().email).toBe("owner@example.com"); step = 2; return route.fulfill({ json: { ok: true } }); }
    if (path.endsWith("/security")) return route.fulfill({ json: { recoveryKey: "recovery-test-key-save-offline-never-log", secret: "JBSWY3DPEHPK3PXP", otpauth: "otpauth://totp/test", qrCode: "data:image/png;base64,iVBORw0KGgo=", backupCodes: ["one-time-backup-code"] } });
    if (path.endsWith("/finish")) {
      acknowledged = route.request().postDataJSON().recoverySaved; expect(acknowledged).toBe(true);
      expect(route.request().postDataJSON().enableTotp).toBe(false); finished = true;
      return route.fulfill({ json: { user, csrfToken: "session-csrf" } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user } }));
  await page.route("**/api/v1/health/ready", (route) => route.fulfill({ json: { status: "ready", workerConnected: true } }));
  await page.route("**/api/v1/dashboard", (route) => route.fulfill({ json: { monitors: [], openIncidents: 0, pendingApprovals: 0, uptimePercent: null, probeResults24h: 0, latencyTrend: [] } }));
  await page.route("**/api/v1/approvals", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.getByLabel("一次性安装令牌").fill("token-from-server-logs");
  await page.getByRole("button", { name: "验证安装令牌" }).click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByLabel("管理员邮箱").fill("owner@example.com");
  await page.getByLabel("显示名称").fill("Owner");
  await page.getByLabel("管理员密码", { exact: true }).fill("Install-password-123!");
  await page.getByLabel("再次输入密码").fill("Install-password-123!");
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(page.getByRole("button", { name: "完成初始化" })).toBeDisabled();
  await expect(page.getByText("recovery-test-key-save-offline-never-log")).toBeVisible();
  await page.getByLabel("启用验证器双重认证（可跳过）").check();
  await expect(page.getByLabel("动态验证码或备用码")).toBeVisible();
  await page.getByLabel("启用验证器双重认证（可跳过）").uncheck();
  await page.getByLabel("我已安全保存账户恢复密钥").check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("setup-security.png"), fullPage: true });
  await page.getByRole("button", { name: "完成初始化" }).click();
  await expect(page.getByText("初始化完成", { exact: true })).toBeVisible();
  expect(acknowledged).toBe(true);
  await page.getByRole("button", { name: "进入控制台" }).click();
  await expect(page.getByRole("heading", { name: "运行总览" })).toBeVisible();
});
