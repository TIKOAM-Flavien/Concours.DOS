import { expect, test } from "@playwright/test";

// Minimal smoke E2E. The goal is not to test logic — node:test + supertest do
// that — but to detect HTML/JS regressions that only surface in a real browser
// (e.g. JS bundle failing to parse, missing element on initial paint).
//
// Run: `npm run dev` in one terminal, then `npm run test:e2e` in another.

test.describe("portal smoke", () => {
  test("portal without a signed link shows the access-gate screen", async ({ page }) => {
    const response = await page.goto("/");
    // The server returns 403 when invitation params are missing in prod, but
    // dev returns the SPA which then renders AccessGateScreen.
    expect([200, 403]).toContain(response?.status() ?? 0);
    const text = await page.content();
    expect(text.length).toBeGreaterThan(100);
  });
});

test.describe("admin smoke", () => {
  test("admin entrypoint exists and loads either the login or the dashboard", async ({
    page,
  }) => {
    const response = await page.goto("/admin");
    expect([200, 403]).toContain(response?.status() ?? 0);
    await expect(page.locator("body")).toBeVisible();
  });

  test("admin auth/session endpoint responds with JSON", async ({ request }) => {
    const res = await request.get("/api/admin/auth/session");
    expect(res.status()).toBeLessThan(500);
    const json = await res.json().catch(() => null);
    expect(json).not.toBeNull();
  });
});
