import { expect, test } from "@playwright/test";
import { login } from "./auth";

test("typed monitor fields persist through create and edit", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop editor flow");
  const name = `Playwright HTTP ${Date.now()}`;
  await login(page);
  await page.getByRole("button", { name: "监控", exact: true }).click();
  await page.getByRole("button", { name: "新建监控" }).click();
  const dialog = page.getByRole("dialog", { name: "新建监控" });
  await dialog.getByLabel("名称").fill(name);
  await dialog.getByLabel("目标地址").fill("https://example.com/health");
  await dialog.getByLabel("请求方法").click();
  await page.getByRole("option", { name: "POST" }).click();
  await dialog.getByRole("button", { name: "添加请求头" }).click();
  await dialog.getByLabel("名称").nth(1).fill("X-Plain");
  await dialog.getByLabel("值", { exact: true }).fill("plain-value");
  await dialog.getByLabel("请求正文（可选）").fill('{"ping":true}');
  await dialog.getByRole("button", { name: "创建监控" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(name, { exact: true })).toBeVisible();

  await page.getByText(name, { exact: true }).click();
  await page.getByRole("button", { name: "编辑" }).click();
  const edit = page.getByRole("dialog", { name: "编辑监控" });
  await expect(edit.getByLabel("目标地址")).toHaveValue(
    "https://example.com/health",
  );
  await expect(edit.getByLabel("请求正文（可选）")).toHaveValue(
    '{"ping":true}',
  );
  await expect(edit.getByLabel("值", { exact: true })).toHaveValue(
    "plain-value",
  );
  await edit.getByRole("button", { name: "取消" }).click();

  await page.getByText(name, { exact: true }).click();
  page.once("dialog", (confirm) => confirm.accept());
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
});

test("workflow step configuration persists and can be deleted", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop editor flow");
  const name = `Playwright workflow ${Date.now()}`;
  await login(page);
  await page.getByRole("button", { name: "工作流", exact: true }).click();
  await page.getByRole("button", { name: "新建工作流" }).click();
  const dialog = page.getByRole("dialog", { name: "新建有序工作流" });
  await dialog.getByLabel("工作流名称").fill(name);
  await dialog.getByLabel("触发事件").click();
  await page.getByRole("option", { name: "MANUAL" }).click();
  await dialog.getByLabel("步骤名称").fill("Run diagnostic");
  await dialog.getByLabel("动作类型").click();
  await page.getByRole("option", { name: "SHELL", exact: true }).click();
  await dialog.getByLabel("容器 Shell 命令").fill("echo healthy");
  await dialog.getByRole("button", { name: "保存工作流" }).click();
  await expect(dialog).toBeHidden();
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toContainText("配置完整");
  await row.getByRole("button", { name: "编辑" }).click();
  const edit = page.getByRole("dialog", { name: "编辑有序工作流" });
  await expect(edit.getByLabel("容器 Shell 命令")).toHaveValue("echo healthy");
  await edit.getByRole("button", { name: "取消" }).click();
  page.once("dialog", (confirm) => confirm.accept());
  await row.getByRole("button", { name: "删除" }).click();
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
});

test("mobile exposes the complete WebSocket editor without overflow", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile editor flow");
  await login(page);
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "监控", exact: true }).click();
  await page.getByRole("button", { name: "新建监控" }).click();
  const dialog = page.getByRole("dialog", { name: "新建监控" });
  await dialog.getByLabel("协议").click();
  await page.getByRole("option", { name: "WS / WSS" }).click();
  await expect(dialog.getByLabel("认证凭据（可选）")).toBeVisible();
  await expect(dialog.getByLabel("发送内容")).toBeVisible();
  await expect(dialog.getByLabel("成功条件")).toBeVisible();
  await dialog.getByLabel("成功条件").scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({
    path: testInfo.outputPath("mobile-websocket-editor.png"),
    fullPage: true,
  });
});

test("existing users expose versioned role and profile editing", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop access flow");
  await login(page);
  await page.getByRole("button", { name: "用户与权限", exact: true }).click();
  const row = page
    .getByRole("row")
    .filter({ hasText: "admin@netsentinel.local" });
  await row.getByRole("button", { name: "编辑" }).click();
  const dialog = page.getByRole("dialog", { name: "编辑用户" });
  await expect(dialog.getByLabel("显示名称")).not.toHaveValue("");
  await expect(dialog.getByLabel("角色")).toBeVisible();
  await expect(dialog.getByLabel("界面语言")).toBeVisible();
  await expect(dialog.getByLabel("显示时区")).toBeVisible();
  await dialog.getByRole("button", { name: "取消" }).click();
});

test("dark dialogs use a compact themed scrollbar", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop visual flow");
  await page.setViewportSize({ width: 1440, height: 760 });
  await page.addInitScript(() =>
    localStorage.setItem("netsentinel.theme", "dark"),
  );
  await login(page);
  await page.getByRole("button", { name: "监控", exact: true }).click();
  await page.getByRole("button", { name: "新建监控" }).click();
  const content = page
    .getByRole("dialog", { name: "新建监控" })
    .locator(".MuiDialogContent-root");
  await expect(content).toBeVisible();
  expect(
    await content.evaluate(
      (element) => getComputedStyle(element).scrollbarColor,
    ),
  ).not.toBe("auto");
  expect(
    await content.evaluate(
      (element) => getComputedStyle(element, "::-webkit-scrollbar").width,
    ),
  ).toBe("10px");
  await page.screenshot({
    path: testInfo.outputPath("dark-themed-scrollbar.png"),
    fullPage: true,
  });
});

test("an empty authentication selector offers inline credential creation", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop credential flow");
  const credentialName = `Inline Bearer ${Date.now()}`;
  await login(page);
  await page.getByRole("button", { name: "监控", exact: true }).click();
  await page.getByRole("button", { name: "新建监控" }).click();
  const dialog = page.getByRole("dialog", { name: "新建监控" });
  await dialog.getByLabel("认证凭据（可选）").click();
  await expect(page.getByRole("option", { name: "不使用认证" })).toBeVisible();
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "新建认证凭据" }).click();
  const credentialDialog = page.getByRole("dialog", { name: "新建认证凭据" });
  await credentialDialog.getByLabel("凭据名称").fill(credentialName);
  await credentialDialog
    .getByRole("textbox", { name: "Bearer Token", exact: true })
    .fill("playwright-secret");
  await credentialDialog.getByRole("button", { name: "创建并使用" }).click();
  await expect(credentialDialog).toBeHidden();
  await expect(
    dialog.getByRole("combobox", { name: "认证凭据（可选）" }),
  ).toContainText(credentialName);

  const credentials = (await (
    await page.request.get("/api/v1/credentials")
  ).json()) as Array<{ id: string; name: string }>;
  const created = credentials.find(
    (credential) => credential.name === credentialName,
  );
  expect(created).toBeTruthy();
  await dialog.getByRole("button", { name: "取消" }).click();
  const csrf = await page.evaluate(
    () => sessionStorage.getItem("netsentinel.csrf") ?? "",
  );
  const response = await page.request.delete(
    `/api/v1/credentials/${created!.id}`,
    { headers: { "x-csrf-token": csrf } },
  );
  expect(response.ok()).toBeTruthy();
});

test("invalid HTTP targets show an actionable field error", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop validation flow");
  await login(page);
  await page.getByRole("button", { name: "监控", exact: true }).click();
  await page.getByRole("button", { name: "新建监控" }).click();
  const dialog = page.getByRole("dialog", { name: "新建监控" });
  await dialog.getByLabel("名称", { exact: true }).fill("Invalid URL example");
  await dialog.getByLabel("目标地址").fill("1111");
  await dialog.getByRole("button", { name: "创建监控" }).click();
  await expect(
    dialog.getByText("目标地址必须是以 http:// 或 https:// 开头的完整 URL"),
  ).toBeVisible();
  await expect(dialog.getByLabel("目标地址")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("manual probe stays busy until a fresh result is visible", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop manual probe flow");
  await login(page);
  await page.getByRole("button", { name: "监控", exact: true }).click();
  await page
    .locator("tbody tr")
    .filter({ hasText: "https://astrbot.bakacookie520.top/api/v1" })
    .click();
  await expect(page.getByRole("heading", { name: "11" })).toBeVisible();
  const checkButton = page.getByRole("button", { name: "立即探测" });
  await checkButton.click();
  await expect(page.getByRole("button", { name: "正在探测" })).toBeDisabled();
  await expect(page.getByText(/探测完成/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/最近结果/)).toBeVisible();
  await expect(page.getByText("系统运行正常", { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("manual-probe-result.png"),
    fullPage: true,
  });
});
