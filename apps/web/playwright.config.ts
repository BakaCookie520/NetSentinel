import { defineConfig, devices } from "@playwright/test";
import { authStatePath } from "./tests/global-setup";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",
  webServer: { command: "pnpm dev", url: "http://127.0.0.1:5173", reuseExistingServer: !process.env.CI },
  use: { baseURL: "http://127.0.0.1:5173", storageState: authStatePath, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  reporter: "list",
});
