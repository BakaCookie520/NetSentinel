import { expect, test, type Locator } from "@playwright/test";

async function box(locator: Locator) {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  return bounds!;
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

for (const viewport of [
  { width: 960, height: 640 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
]) {
  test(`login introduction does not overlap at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");

    const protocol = page.getByText("探测协议", { exact: true });
    const actions = page.getByText("动作类型", { exact: true });
    const encryption = page.getByText("凭据加密", { exact: true });
    const footer = page.getByText("SELF-HOSTED NETWORK OPERATIONS", { exact: true });
    const bounds = await Promise.all([box(protocol), box(actions), box(encryption), box(footer)]);

    expect(overlaps(bounds[0], bounds[1])).toBe(false);
    expect(overlaps(bounds[1], bounds[2])).toBe(false);
    expect(Math.max(bounds[0].y + bounds[0].height, bounds[1].y + bounds[1].height, bounds[2].y + bounds[2].height)).toBeLessThanOrEqual(bounds[3].y);
  });
}

test("short desktop viewport scrolls instead of overlapping", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 420 });
  await page.goto("/");
  const footer = page.getByText("SELF-HOSTED NETWORK OPERATIONS", { exact: true });
  const encryption = page.getByText("凭据加密", { exact: true });
  const footerBounds = await box(footer);
  const encryptionBounds = await box(encryption);
  expect(encryptionBounds.y + encryptionBounds.height).toBeLessThanOrEqual(footerBounds.y);
});

test("mobile login omits the desktop introduction", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "登录控制台" })).toBeVisible();
  await expect(page.getByText("SELF-HOSTED NETWORK OPERATIONS", { exact: true })).toBeHidden();
});

test("document references the shield favicon", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.svg");
  const response = await request.get("/favicon.svg");
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain("M12 2 4 5v6.09");
});
