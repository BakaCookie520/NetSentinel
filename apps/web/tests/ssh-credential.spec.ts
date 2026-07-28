import { expect, test } from "@playwright/test";
import { login } from "./auth";

test("SSH key credentials accept a passphrase without echoing stored secrets", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop credential flow");
  await login(page);

  const existing = {
    id: "credential-existing",
    name: "Existing deploy key",
    type: "SSH_KEY",
    configured: true,
    createdAt: "2026-07-26T10:00:00.000Z",
    version: 1,
  };
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/v1/credentials", async (route) => {
    if (route.request().method() === "POST") {
      submitted = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ...existing,
          id: "credential-created",
          name: submitted.name,
          version: 1,
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([existing]),
    });
  });

  await page.goto("/credentials");
  await page.getByRole("button", { name: "轮换" }).click();
  await expect(page.getByLabel("私钥", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("私钥口令（可选）", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "取消" }).click();

  await page.getByRole("button", { name: "新建凭据" }).click();
  await page.getByLabel("类型").click();
  await page.getByRole("option", { name: "SSH_KEY" }).click();
  await page.getByLabel("名称").fill("Encrypted deploy key");
  await page.getByLabel("私钥", { exact: true }).fill("private-key");
  await page.getByLabel("私钥口令（可选）", { exact: true }).fill("key-passphrase");
  await page.getByRole("button", { name: "保存凭据" }).click();

  await expect.poll(() => submitted).toEqual({
    name: "Encrypted deploy key",
    type: "SSH_KEY",
    secret: "private-key",
    passphrase: "key-passphrase",
  });
  await expect(page.getByRole("dialog")).toBeHidden();
});
