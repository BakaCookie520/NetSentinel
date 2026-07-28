import { expect, test } from "@playwright/test";
import { login } from "./auth";

test("operator confirms and deletes an incident", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop incident management regression");
  let deleted = false;
  await page.route("**/api/v1/incidents", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(deleted ? [] : [{
        id: "incident-1",
        title: "Synthetic outage",
        status: "RESOLVED",
        openedAt: new Date().toISOString(),
        monitor: { name: "Synthetic monitor" },
        assignee: null,
      }]),
    });
  });
  await page.route("**/api/v1/incidents/incident-1", async (route) => {
    expect(route.request().method()).toBe("DELETE");
    deleted = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });

  await login(page);
  await page.locator('a[href="/incidents"]').click();
  await expect(page.getByText("Synthetic outage")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除事件 Synthetic outage" }).click();

  await expect.poll(() => deleted).toBe(true);
  await expect(page.getByText("Synthetic outage")).toHaveCount(0);
});
