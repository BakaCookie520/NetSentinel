import { expect, test } from "@playwright/test";
import { login } from "./auth";

test("settings groups general, backups, mail and account security with compatible deep links", async ({ page }, testInfo) => {
  await login(page);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(page.getByRole("heading", { name: "常规设置", exact: true })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "系统设置子页面" });
  await expect(navigation.getByRole("link")).toHaveCount(4);
  await expect(navigation.getByRole("link", { name: /常规设置/ })).toHaveAttribute("aria-current", "page");
  await navigation.getByRole("link", { name: /备份与恢复/ }).click();
  await expect(page).toHaveURL(/\/settings\/backups$/);
  await expect(page.getByRole("heading", { name: "备份与恢复", exact: true })).toBeVisible();
  await navigation.getByRole("link", { name: /邮件服务/ }).click();
  await expect(page.getByRole("heading", { name: "邮件服务", exact: true })).toBeVisible();
  await navigation.getByRole("link", { name: /账户安全/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/settings\/security$/);
  await expect(page.getByRole("heading", { name: "账户安全", exact: true })).toBeVisible();
  await page.reload();
  await expect(navigation.getByRole("link", { name: /账户安全/ })).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("settings-security.png"), fullPage: true });
  await page.goto("/backups");
  await expect(page).toHaveURL(/\/settings\/backups$/);
  await page.goto("/security");
  await expect(page).toHaveURL(/\/settings\/security$/);
  await page.getByRole("button", { name: "账户菜单" }).click();
  await page.getByRole("menuitem", { name: "账户安全", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/security$/);
  await page.getByRole("button", { name: "切换语言" }).click();
  await page.getByRole("menuitem", { name: "English" }).click();
  await expect(page.getByRole("navigation", { name: "Settings pages" }).getByRole("link", { name: /Account security/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Account security", exact: true })).toBeVisible();
});

test("personal security remains available without system or backup permissions", async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: {
    user: { id: "settings-member", email: "member@example.com", displayName: "Member", avatarUrl: null, permissions: [], authentication: "session", forcePasswordChange: false },
  } }));
  await page.route("**/api/v1/auth/me/security", (route) => route.fulfill({ json: {
    totpEnabled: false, recoveryConfigured: true, backupCodesRemaining: 0,
  } }));
  const adminRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/v1\/(?:settings|admin\/(?:backups|mail))/.test(request.url())) adminRequests.push(request.url());
  });
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings\/security$/);
  const navigation = page.getByRole("navigation", { name: "系统设置子页面" });
  await expect(navigation.getByRole("link")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "账户安全", exact: true })).toBeVisible();
  await page.goto("/settings/backups");
  await expect(page.getByText("你没有访问此设置页面的权限，请选择其他设置。")).toBeVisible();
  await page.goto("/settings/mail");
  await expect(page.getByText("你没有访问此设置页面的权限，请选择其他设置。")).toBeVisible();
  await page.goto("/settings/general");
  await expect(page.getByText("你没有访问此设置页面的权限，请选择其他设置。")).toBeVisible();
  expect(adminRequests).toEqual([]);
});
