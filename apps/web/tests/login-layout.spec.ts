import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

for (const mode of ["light", "dark"]) {
  test(`login is centered on a distinct ${mode} surface`, async ({ page }, testInfo) => {
    await page.addInitScript((theme) => localStorage.setItem("netsentinel.theme", theme), mode);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "登录控制台" })).toBeVisible();
    const form = page.getByTestId("auth-form");
    const bounds = (await form.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2)).toBeLessThan(2);
    expect(Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2)).toBeLessThan(2);
    expect(await page.getByTestId("auth-layout").evaluate((element) => getComputedStyle(element).backgroundImage)).toBe("none");
    expect(await form.evaluate((element) => getComputedStyle(element).boxShadow)).toBe("none");
    await expect(page.locator(".login-intro")).toHaveCount(0);
    expect(await form.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(await page.getByTestId("auth-layout").evaluate((element) => getComputedStyle(element).backgroundColor));
    expect(await form.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe("1px");
    await expect(page.getByLabel("账号名称或邮箱")).toHaveAttribute("autocomplete", "username");
    await expect(page.getByLabel(/^密码/)).toHaveAttribute("autocomplete", "current-password");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`login-${mode}.png`), fullPage: true });
  });
}

test("short viewport keeps inputs and submit reachable", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 320 });
  await page.goto("/");
  await page.getByLabel("账号名称或邮箱").fill("admin");
  await page.getByLabel(/^密码/).fill("wrong-test-password");
  await page.route("**/api/v1/auth/login", (route) => route.fulfill({ status: 401, json: { detail: "AUTH_INVALID" } }));
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("无法登录");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "忘记密码或验证器？" }).click();
  await expect(page.getByRole("heading", { name: "恢复账户" })).toBeVisible();
  await page.getByRole("button", { name: "返回登录" }).click();
  await expect(page.getByRole("heading", { name: "登录控制台" })).toBeVisible();
});

test("keyboard submission preserves the two-factor challenge", async ({ page }) => {
  await page.route("**/api/v1/auth/login", (route) => route.fulfill({ json: { requiresTwoFactor: true, challengeId: "test-challenge" } }));
  await page.route("**/api/v1/auth/two-factor", (route) => {
    expect(route.request().postDataJSON()).toEqual({ challengeId: "test-challenge", code: "123456" });
    return route.fulfill({ status: 401, json: { detail: "AUTH_INVALID" } });
  });
  await page.goto("/");
  await page.getByLabel("账号名称或邮箱").fill("owner");
  const password = page.getByLabel(/^密码/);
  await password.fill("test-password");
  await password.press("Enter");
  const code = page.getByLabel("动态验证码或备用码");
  await expect(code).toBeVisible();
  await expect(code).toBeFocused();
  await code.fill("123456");
  await code.press("Enter");
  await expect(page.getByRole("alert")).toBeVisible();
});

test("password login still opens the console", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("账号名称或邮箱").fill("admin");
  await page.getByLabel(/^密码/).fill(process.env.E2E_REAL_PASSWORD ?? "IntegrationPass123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "运行总览" })).toBeVisible();
});

test("document references the shield favicon", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.svg");
  const response = await request.get("/favicon.svg");
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain("M12 2 4 5v6.09");
});
