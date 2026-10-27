import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e", fullyParallel: false, workers: 1,
  use: { baseURL: "http://127.0.0.1:3200", trace: "retain-on-failure" },
  webServer: { command: "node scripts/test-integration.mjs --serve-e2e --production", url: "http://127.0.0.1:3200/api/health", reuseExistingServer: false, timeout: 120_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }, { name: "mobile-webkit", use: { ...devices["iPhone 13"] } }],
});
