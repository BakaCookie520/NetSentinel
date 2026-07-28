import { expect, test, type Page } from "@playwright/test";
import { login } from "./auth";

test("operator can filter runtime logs and inspect details", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop runtime log flow");
  await login(page);
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/v1/logs?") && response.ok(),
  );
  await page.getByRole("button", { name: "运行日志" }).click();
  const response = await responsePromise;
  const payload = (await response.json()) as { items: unknown[] };
  expect(Array.isArray(payload.items)).toBeTruthy();
  await expect(page.getByRole("heading", { name: "运行日志" })).toBeVisible();
  await expect(page.getByText(/当前显示 \d+ 条记录/)).toBeVisible();

  await page.getByRole("button", { name: "探测", exact: true }).click();
  const rows = page.getByTestId("runtime-log-row");
  if ((await rows.count()) > 0) {
    await expect(rows.first()).toContainText("探测");
    await rows.first().click();
    await expect(
      page.getByRole("button", { name: "关闭日志详情" }),
    ).toBeVisible();
    await expect(page.getByText("记录 ID", { exact: true })).toBeVisible();
  }
  await page.screenshot({
    path: testInfo.outputPath("runtime-logs.png"),
    fullPage: true,
  });
});

test("runtime logs are usable from mobile navigation", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile runtime log flow");
  await login(page);
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "运行日志" }).click();
  await expect(page.getByRole("heading", { name: "运行日志" })).toBeVisible();
  await expect(page.getByRole("region", { name: "日志筛选" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("runtime-logs-mobile.png"),
    fullPage: true,
  });
});

test("deep-linked action log drawer closes without losing other filters", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop deep-link regression");
  await login(page);
  await page.route("**/api/v1/logs?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "action:run-deep-link",
            source: "ACTION",
            status: "FAILURE",
            timestamp: "2026-07-26T11:43:31.000Z",
            title: "Restart service",
            summary: "Workflow run / MANUAL",
            monitor: { id: "monitor-1", name: "Service", target: "https://example.com" },
            durationMs: 732,
            details: {
              runId: "run-deep-link",
              trigger: "MANUAL",
              runStatus: "FAILED",
              startedAt: "2026-07-26T11:43:30.000Z",
              finishedAt: "2026-07-26T11:43:31.000Z",
              steps: [],
            },
          },
        ],
        nextCursor: null,
      }),
    });
  });

  await page.goto("/logs?source=ACTION&runId=run-deep-link");
  const close = page.getByRole("button", { name: "关闭日志详情" });
  await expect(close).toBeVisible();
  await close.click();
  await expect(close).toBeHidden();

  const url = new URL(page.url());
  expect(url.searchParams.get("runId")).toBeNull();
  expect(url.searchParams.get("source")).toBe("ACTION");

  const row = page.getByTestId("runtime-log-row").first();
  await row.click();
  await expect(close).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(close).toBeHidden();

  await row.click();
  await expect(close).toBeVisible();
  await page.locator(".MuiBackdrop-root").click({ position: { x: 5, y: 5 } });
  await expect(close).toBeHidden();
});
