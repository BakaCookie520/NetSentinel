import { expect, test, type Page } from "@playwright/test";
import { login } from "./auth";

const workflow = {
  id: "workflow-feedback",
  name: "Feedback smoke workflow",
  trigger: "MANUAL",
  approvalMode: "AUTO",
  approvalTimeoutMinutes: 15,
  version: 1,
  enabled: true,
  monitor: null,
  configurationComplete: true,
  steps: [
    {
      id: "step-feedback",
      position: 0,
      name: "Safe step",
      type: "SHELL",
      credentialId: null,
      timeoutMs: 1_000,
      retries: 0,
      continueOnFailure: false,
      config: { command: "echo feedback" },
    },
  ],
};

const pendingRun = {
  id: "run-feedback",
  workflowId: workflow.id,
  workflow: { id: workflow.id, name: workflow.name },
  status: "PENDING",
  trigger: "MANUAL",
  createdAt: new Date().toISOString(),
  startedAt: null,
  finishedAt: null,
  steps: [],
};

async function mockWorkflowList(page: Page) {
  await page.route("**/api/v1/workflows", async (route) => {
    if (route.request().method() === "GET") await route.fulfill({ json: [workflow] });
    else await route.continue();
  });
}

async function openWorkflows(page: Page, mobile: boolean) {
  if (mobile) await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "工作流", exact: true }).click();
}

test("manual workflow reports queueing, terminal status, and exact log", async ({
  page,
}, testInfo) => {
  await login(page);
  await mockWorkflowList(page);
  let polls = 0;
  await page.route("**/api/v1/workflows/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/${workflow.id}/execute`)) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ json: pendingRun });
      return;
    }
    if (url.pathname.endsWith(`/runs/${pendingRun.id}`)) {
      polls += 1;
      await route.fulfill({
        json: {
          ...pendingRun,
          status: polls > 1 ? "SUCCEEDED" : "RUNNING",
          startedAt: new Date().toISOString(),
          finishedAt: polls > 1 ? new Date().toISOString() : null,
        },
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/v1/logs?**", async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("runId")).toBe(pendingRun.id);
    await route.fulfill({
      json: {
        items: [
          {
            id: `action:${pendingRun.id}`,
            source: "ACTION",
            status: "SUCCESS",
            timestamp: new Date().toISOString(),
            title: workflow.name,
            summary: "工作流执行 · MANUAL",
            monitor: null,
            durationMs: 50,
            details: {
              runId: pendingRun.id,
              trigger: "MANUAL",
              runStatus: "SUCCEEDED",
              startedAt: new Date().toISOString(),
              finishedAt: new Date().toISOString(),
              steps: [],
            },
          },
        ],
        nextCursor: null,
      },
    });
  });

  await openWorkflows(page, testInfo.project.name === "mobile");
  const execute = page.getByRole("button", {
    name: `执行工作流 ${workflow.name}`,
  });
  await execute.click();
  await expect(execute).toBeDisabled();
  await expect(page.getByText(/已提交，正在等待执行结果/)).toBeVisible();
  await expect(page.locator("[data-feedback-id]")).toHaveCount(2, {
    timeout: 6_000,
  });
  await expect(page.getByText(/执行成功/)).toBeVisible();
  const notices = page.locator("[data-feedback-id]");
  const older = await notices.nth(0).boundingBox();
  const newer = await notices.nth(1).boundingBox();
  expect(older).not.toBeNull();
  expect(newer).not.toBeNull();
  expect(older!.y + older!.height).toBeLessThanOrEqual(newer!.y);
  await page.screenshot({
    path: testInfo.outputPath("workflow-success.png"),
    fullPage: true,
  });
  await notices
    .nth(0)
    .getByRole("button", { name: "关闭通知" })
    .click();
  await expect(notices).toHaveCount(1);
  await expect(page.getByText(/执行成功/)).toBeVisible();
  await notices.getByRole("link", { name: "查看日志" }).click();
  await expect(page).toHaveURL(/\/logs\?source=ACTION&runId=run-feedback/);
  await expect(page.getByRole("heading", { name: workflow.name })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("workflow-log.png"),
    fullPage: true,
  });
});

test("failed row command shows Problem Details and becomes usable again", async ({
  page,
}, testInfo) => {
  await login(page);
  await mockWorkflowList(page);
  await page.route(`**/api/v1/workflows/${workflow.id}`, async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/problem+json",
      json: {
        title: "CONFLICT",
        status: 409,
        detail: "Workflow has execution history and cannot be deleted",
      },
    });
  });
  await openWorkflows(page, testInfo.project.name === "mobile");
  const remove = page.getByRole("button", {
    name: `删除工作流 ${workflow.name}`,
  });
  page.once("dialog", (dialog) => dialog.accept());
  await remove.click();
  const localizedError = page.getByText("数据状态已发生变化，请刷新后重试");
  await expect(localizedError).toBeVisible();
  await expect(
    page.getByText("Workflow has execution history and cannot be deleted"),
  ).toBeHidden();
  await page.getByRole("button", { name: "切换语言" }).click();
  await expect(
    page.getByText("Workflow has execution history and cannot be deleted"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Switch language" }).click();
  await expect(localizedError).toBeVisible();
  await expect(remove).toBeEnabled();
  await expect(localizedError).toBeHidden({ timeout: 9_500 });
});

test("notification auto-dismiss pauses for hover and keyboard focus", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop timer interaction");
  await login(page);
  await page.route("**/api/v1/logs?**", async (route) => {
    await route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.goto("/logs");
  await page.getByRole("button", { name: "立即刷新日志" }).click();

  const notice = page.locator("[data-feedback-id]");
  await expect(notice).toHaveCount(1);
  await notice.hover();
  await page.waitForTimeout(4_500);
  await expect(notice).toBeVisible();

  await page.mouse.move(0, 0);
  await notice.getByRole("button", { name: "关闭通知" }).focus();
  await page.waitForTimeout(4_500);
  await expect(notice).toBeVisible();

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(notice).toBeHidden({ timeout: 4_500 });
});
