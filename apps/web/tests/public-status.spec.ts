import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

const history = Array.from({ length: 90 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 4, 1 + index)).toISOString().slice(0, 10),
  status: index === 72 ? "DEGRADED" : "OPERATIONAL",
  uptimePercent: index === 72 ? 99.5 : 100,
}));

test("anonymous visitors can view a localized public status page", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => localStorage.setItem("netsentinel.status.locale", "zh-CN"));
  await page.route("**/api/v1/public/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "public, max-age=15" },
      body: JSON.stringify({
        enabled: true,
        generatedAt: "2026-07-27T04:00:00.000Z",
        title: "Cookie Cloud Status",
        description: "核心服务实时可用性",
        supportUrl: "https://support.example.com/",
        themeColor: "sky",
        overallStatus: "OPERATIONAL",
        groups: [{ name: "核心服务", services: [{ id: "public-api", name: "主 API", status: "OPERATIONAL", uptimePercent: 99.998, history }] }],
        incidents: [],
      }),
    });
  });

  await page.goto("/status");
  await expect(page).toHaveURL(/\/status$/);
  await expect(page.getByRole("heading", { name: "Cookie Cloud Status" })).toBeVisible();
  await expect(page.getByText("所有系统运行正常")).toBeVisible();
  await expect(page.getByText("主 API")).toBeVisible();
  await expect(page.getByText("99.998%", { exact: false })).toBeVisible();
  await expect(page.getByText("登录控制台")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toContain("dark");

  await page.getByRole("button", { name: "切换为 English" }).click();
  await expect(page.getByText("All systems operational")).toBeVisible();

  const service = page.getByText("主 API").locator("xpath=ancestor::*[self::div][1]");
  await expect(service).toBeVisible();
});

test("an enabled page with no published monitors has an explicit empty state", async ({ page }) => {
  await page.route("**/api/v1/public/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      enabled: true,
      generatedAt: new Date().toISOString(),
      title: "Empty Status",
      overallStatus: "NO_DATA",
      groups: [],
      incidents: [],
    }) });
  });
  await page.goto("/status");
  await expect(page.getByText(/No monitors are published yet|尚未公开任何监控服务/)).toBeVisible();
});

test("public API failures are visible and retryable", async ({ page }) => {
  await page.route("**/api/v1/public/status", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/problem+json", body: JSON.stringify({ title: "Unavailable" }) });
  });
  await page.goto("/status");
  await expect(page.getByText(/Unable to load service status|无法加载服务状态/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Reload|重新加载/ })).toBeEnabled();
});

test("disabled status page returns a clear anonymous state", async ({ page }) => {
  await page.route("**/api/v1/public/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: false, generatedAt: new Date().toISOString() }) });
  });
  await page.goto("/status");
  await expect(page.getByText(/Public status page is disabled|公开状态页已关闭/)).toBeVisible();
});
