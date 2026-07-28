import { expect, test } from "@playwright/test";
import { login } from "./auth";

test("zero monitors never render placeholder latency or threshold data", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop dashboard regression");
  await page.route("**/api/v1/dashboard", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        monitors: [],
        openIncidents: 0,
        pendingApprovals: 0,
        uptimePercent: 100,
        latencyTrend: [],
      }),
    });
  });

  await login(page);

  await expect(page.getByTestId("dashboard-latency-empty")).toBeVisible();
  await expect(page.getByTestId("dashboard-latency-chart")).toHaveCount(0);
  await expect(page.getByText(/^0 个目标/)).toBeVisible();
});
