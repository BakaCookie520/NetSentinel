import { expect, test } from "@playwright/test";
import { login } from "./auth";

// The UI test intercepts only the backup subsystem. Destructive restore tests
// run separately against the isolated API/database, not shared E2E fixtures.
test("backup console manages encrypted recovery points without horizontal overflow", async ({ page }, testInfo) => {
  await login(page);
  let configured = false;
  let entries: Array<Record<string, unknown>> = [];
  let job: Record<string, unknown> = {};
  const entry = { id: "11111111-1111-4111-8111-111111111111", name: "完整站点", note: "异地副本", source: "manual", status: "ready", size: 12000, formatVersion: 1, createdAt: "2026-10-31T03:00:00Z", dataTime: "2026-10-31T03:00:00Z", counts: { User: 1, Monitor: 2, ProbeResult: 500 } };
  await page.route("**/api/v1/admin/backups**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const path = url.pathname.replace("/api/v1/admin/backups", "");
    if (path === "/policy") {
      if (method === "PUT") configured = true;
      return route.fulfill({ json: { enabled: false, frequency: "daily", time: "03:00", weekday: 0, timezone: "Asia/Shanghai", retain: 7, passwordConfigured: configured, uploadMaxBytes: 1073741824 } });
    }
    if (path.startsWith("/jobs/")) return route.fulfill({ json: { ...job, status: "succeeded", phase: "complete" } });
    if (!path && method === "POST") {
      const input = route.request().postDataJSON() as { name: string; note: string };
      entries = [{ ...entry, ...input }]; job = { id: "22222222-2222-4222-8222-222222222222", type: "create", status: "running", phase: "preparing", backupId: entry.id };
      return route.fulfill({ status: 202, json: job });
    }
    if (path === "/import") {
      entries.push({ ...entry, id: "33333333-3333-4333-8333-333333333333", name: "portable", source: "import" });
      job = { id: "44444444-4444-4444-8444-444444444444", type: "import", status: "running", phase: "preparing", backupId: "33333333-3333-4333-8333-333333333333" };
      return route.fulfill({ status: 202, json: job });
    }
    if (path.endsWith("/download")) return route.fulfill({ contentType: "application/octet-stream", headers: { "content-disposition": 'attachment; filename="site.nsbackup"' }, body: "encrypted-test-file" });
    if (method === "DELETE") { entries = entries.filter((item) => !path.endsWith(String(item.id))); return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: entries });
  });
  await page.goto("/backups");
  await expect(page.getByRole("heading", { name: "备份与恢复" })).toBeVisible();
  await page.getByRole("button", { name: "备份策略", exact: true }).first().click();
  await page.getByLabel("独立备份口令", { exact: true }).fill("backup-passphrase-123");
  await page.getByLabel("再次输入备份口令").fill("backup-passphrase-123");
  await page.getByRole("button", { name: "保存策略" }).click();
  await expect(page.getByText("备份策略已保存")).toBeVisible();
  await page.getByRole("button", { name: "立即备份" }).click();
  await page.getByLabel("备份名称").fill("完整站点"); await page.getByLabel("备注", { exact: true }).fill("异地副本");
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByText("完整站点", { exact: true })).toBeVisible();
  await expect(page.getByText("操作已完成")).toBeVisible();
  await page.getByRole("button", { name: "导出备份", exact: true }).click();
  await page.getByLabel("当前账户密码").fill("IntegrationPass123!");
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "确认", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("site.nsbackup");
  await page.getByRole("button", { name: "导入备份", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "portable.nsbackup", mimeType: "application/octet-stream", buffer: Buffer.from("encrypted-test-file") });
  await page.getByLabel("来源备份口令").fill("backup-passphrase-123"); await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByText("导入校验完成，请核对备份信息，再决定是否恢复。")).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "恢复此备份", exact: true }).first().click();
  await page.getByLabel("当前账户密码").fill("IntegrationPass123!");
  await expect(page.getByRole("button", { name: "确认", exact: true })).toBeDisabled();
  await page.getByLabel("输入 RESTORE 确认覆盖").fill("RESTORE");
  await expect(page.getByRole("button", { name: "确认", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "删除", exact: true }).last().click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.locator("article")).toHaveCount(1);
  await page.getByRole("button", { name: "立即备份" }).focus();
  await expect(page.getByRole("button", { name: "立即备份" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".MuiDialog-root")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("backups.png"), fullPage: true });
  await page.getByRole("button", { name: "切换语言" }).click();
  await page.getByRole("menuitem", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Backups & recovery" })).toBeVisible();
});
