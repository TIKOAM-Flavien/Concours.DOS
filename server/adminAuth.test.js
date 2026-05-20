import test from "node:test";
import assert from "node:assert/strict";

import {
  createAdminSessionToken,
  getAdminAuthConfig,
  readAdminSession,
  verifyAdminPassword,
  verifyAdminUsername,
} from "./adminAuth.js";

test("admin session auth", async (t) => {
  const env = {
    PORTAL_ADMIN_USERNAME: "admin",
    PORTAL_ADMIN_PASSWORD: "AdminPass-2026-Safe",
    PORTAL_LINK_SECRET: "x".repeat(48),
    PORTAL_ADMIN_SESSION_TTL_HOURS: "1",
  };
  const config = getAdminAuthConfig(env);

  await t.test("validates username and password", () => {
    assert.equal(verifyAdminUsername("admin", config), true);
    assert.equal(verifyAdminUsername("other", config), false);
    assert.equal(verifyAdminPassword("AdminPass-2026-Safe", config), true);
    assert.equal(verifyAdminPassword("wrong", config), false);
  });

  await t.test("creates and reads a signed session", () => {
    const token = createAdminSessionToken(config, Date.now());
    const req = {
      headers: {
        cookie: `portal_admin_session=${encodeURIComponent(token)}`,
      },
    };
    const session = readAdminSession(req, env);
    assert.equal(session?.username, "admin");
  });
});
