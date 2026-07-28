import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { authMetadataPath } from "./global-setup";

const { csrfToken, user } = JSON.parse(
  readFileSync(authMetadataPath, "utf8"),
) as {
  csrfToken: string;
  user: unknown;
};

export async function login(page: Page) {
  await page.addInitScript(
    ({ token, currentUser }) => {
      window.sessionStorage.setItem("netsentinel.csrf", token);
      window.sessionStorage.setItem(
        "netsentinel.user",
        JSON.stringify(currentUser),
      );
    },
    { token: csrfToken, currentUser: user },
  );
  await page.goto("/");
  const loginHeading = page.getByRole("heading", { name: "登录控制台" });
  if (await loginHeading.isVisible()) {
    await page
      .getByLabel("密码")
      .fill(process.env.E2E_REAL_PASSWORD ?? "IntegrationPass123!");
    await page.getByRole("button", { name: "登录", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "运行总览" })).toBeVisible();
}
