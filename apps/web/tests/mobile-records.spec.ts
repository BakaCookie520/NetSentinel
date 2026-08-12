import { expect, test } from "@playwright/test";
import { login } from "./auth";

test("mobile monitor and workflow lists use complete record cards", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile record layout");
  await login(page);

  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "监控", exact: true }).click();
  await expect(page.locator(".mobile-record-list")).toBeVisible();
  await expect(page.locator(".desktop-record-table")).toBeHidden();
  await expect(page.locator(".mobile-record-card").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-monitors-cards.png"), fullPage: true });

  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "工作流", exact: true }).click();
  await expect(page.locator(".mobile-record-list")).toBeVisible();
  await expect(page.locator(".desktop-record-table")).toBeHidden();
  await expect(page.locator(".mobile-record-card").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-workflows-cards.png"), fullPage: true });
});
