import { expect, test } from "@playwright/test";
import { login } from "./auth";

test("workflow editor adds and removes steps", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop workflow editor flow");
  await login(page);
  await page.getByRole("button", { name: "工作流" }).click();
  await page.getByRole("button", { name: "新建工作流" }).click();
  const dialog = page.getByRole("dialog", { name: "新建有序工作流" });
  const steps = dialog.getByTestId("workflow-step");
  await expect(steps).toHaveCount(1);
  await dialog.getByRole("button", { name: "添加步骤" }).click();
  await expect(steps).toHaveCount(2);
  await dialog.getByRole("button", { name: "删除步骤" }).first().click();
  await expect(steps).toHaveCount(1);
  await expect(steps.nth(0)).toContainText("1.");
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toBeHidden();
});

test("operator can inspect the dashboard and create a monitor", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop management flow");
  const name = `Dashboard monitor ${Date.now()}`;
  await login(page);
  await expect(page.getByRole("heading", { name: "运行总览" })).toBeVisible();
  await page.getByRole("button", { name: "监控" }).click();
  await page.getByRole("button", { name: "新建监控" }).click();
  const dialog = page.getByRole("dialog", { name: "新建监控" });
  await dialog.getByLabel("名称").fill(name);
  await dialog.getByLabel("目标地址").fill("https://example.com/health");
  await dialog.getByRole("button", { name: "创建监控" }).click();
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("monitors.png"), fullPage: true });
  await row.click();
  page.once("dialog", (confirmation) => confirmation.accept());
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
});

test("mobile navigation exposes incident response", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile navigation flow");
  await login(page);
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "事件" }).click();
  await expect(page.getByRole("heading", { name: "事件响应" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-incidents.png"), fullPage: true });
});

test("desktop supports dark theme and English locale", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop appearance flow");
  await login(page);
  await page.getByRole("button", { name: "外观" }).click();
  await page.getByRole("menuitem", { name: "深色模式" }).click();
  await page.getByRole("button", { name: "切换语言" }).click();
  await page.getByRole("menuitem", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(16, 24, 32)");
  await page.screenshot({ path: testInfo.outputPath("dashboard-dark-en.png"), fullPage: true });
});
