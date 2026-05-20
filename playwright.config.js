import { defineConfig, devices } from "@playwright/test";

// Smoke-only Playwright setup. The full server is NOT started by Playwright —
// run `npm run dev` in a second terminal, then `npm run test:e2e`. CI should
// orchestrate the server lifecycle via the `webServer` block; this base config
// keeps the dev loop simple.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3001",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
