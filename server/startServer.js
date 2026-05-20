import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyBodySizeErrorHandler,
  applyPortalRateLimits,
  applySecurityHeaders,
  createApp,
} from "./app/createApp.js";
import { loadEnvFiles } from "./app/env.js";
import { getStaticBundle } from "./app/staticBundle.js";
import {
  getAppRole,
  roleIncludesAdmin,
  roleIncludesPortal,
} from "./bootstrap/role.js";
import { initDatabase } from "./db.js";
import {
  markExpiredInvitations,
  pruneExpiredSignedInvitations,
  pruneRevokedInvitations,
  scrubOldAuditPayloads,
} from "./db.js";
import { buildRequestContext, getStartupDiagnostics } from "./lib/requestContext.js";
import { registerAdminRoutes } from "./routes/adminRoutes.js";
import { registerHealthRoutes } from "./routes/healthRoutes.js";
import { registerPortalRoutes } from "./routes/portalRoutes.js";
import { registerStaticRoutes } from "./routes/staticRoutes.js";
import { parsePositiveInt } from "./security.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

export async function startServer() {
  const shellEnvKeys = new Set(Object.keys(process.env));
  loadEnvFiles(rootDir, [".env", ".env.local"], shellEnvKeys);

  const env = process.env;
  const port = env.PORT || 3001;
  const role = getAppRole(env);

  // Run diagnostics BEFORE initDatabase so a misconfigured prod start fails
  // fast without opening a Postgres connection. Static-bundle checks tolerate
  // a missing build, since the role/diagnostics tests run independently.
  const staticBundle = getStaticBundle(rootDir, role);
  const startupDiagnostics = getStartupDiagnostics(staticBundle, { env, role });

  for (const warning of startupDiagnostics.warnings) {
    console.warn(`[startup] ${warning}`);
  }

  if (startupDiagnostics.errors.length) {
    for (const error of startupDiagnostics.errors) {
      console.error(`[startup] ${error}`);
    }

    if (env.NODE_ENV === "production") {
      console.error(
        "[startup] Refusing to start in production with the errors above. Fix the configuration and retry."
      );
      process.exit(1);
    }
  }

  await initDatabase(env);

  const maxFileMb = Math.max(parsePositiveInt(env.PORTAL_MAX_FILE_MB, 20), 1);
  const { app, isProduction, bodyLimitMb, portalRateLimitPerMinute, portalUploadRateLimitPerMinute } =
    createApp({ env });

  if (roleIncludesPortal(role)) {
    applyPortalRateLimits(app, {
      portalRateLimitPerMinute,
      portalUploadRateLimitPerMinute,
    });
  }

  applyBodySizeErrorHandler(app, bodyLimitMb, maxFileMb);
  applySecurityHeaders(app, { isProduction, env });

  const ctx = buildRequestContext({
    rootDir,
    env,
    staticBundle,
    startupDiagnostics,
    role,
    port,
  });

  registerHealthRoutes(app, ctx);

  if (roleIncludesAdmin(role) || roleIncludesPortal(role)) {
    app.use("/api", ctx.requireTrustedBrowserOrigin);
  }

  if (roleIncludesAdmin(role)) {
    registerAdminRoutes(app, ctx);
  }

  if (roleIncludesPortal(role)) {
    registerPortalRoutes(app, ctx);
  }

  registerStaticRoutes(app, ctx);

  const server = app.listen(port, () => {
    console.log(`[bootstrap] role=${role} listening on http://localhost:${port}`);
  });

  const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;

  async function runAdminMaintenance() {
    try {
      const expired = await markExpiredInvitations();
      const prune = await pruneRevokedInvitations();
      const pruneSigned = await pruneExpiredSignedInvitations();
      const scrub = await scrubOldAuditPayloads();
      if (expired.updated || prune.removed || pruneSigned.removed || scrub.scrubbed) {
        console.log(
          `[maintenance:admin] marked ${expired.updated} expired invitations, pruned ${prune.removed} revoked, ${pruneSigned.removed} signed invitations, scrubbed ${scrub.scrubbed} audit payloads (cutoff ${prune.cutoff})`
        );
      }
    } catch (error) {
      console.warn("[maintenance:admin] cleanup failed:", error?.message || error);
    }
  }

  async function runPortalMaintenance() {
    try {
      const purgedUploads = await ctx.purgeExpiredLocalDocumentFiles();
      if (purgedUploads.removed) {
        console.log(
          `[maintenance:portal] purged ${purgedUploads.removed} local upload(s)`
        );
      }
    } catch (error) {
      console.warn("[maintenance:portal] cleanup failed:", error?.message || error);
    }
  }

  async function runScheduledCleanup() {
    if (roleIncludesAdmin(role)) {
      await runAdminMaintenance();
    }
    if (roleIncludesPortal(role)) {
      await runPortalMaintenance();
    }
  }

  const maintenanceStartTimer = setTimeout(runScheduledCleanup, 30 * 1000);
  maintenanceStartTimer.unref();
  const maintenanceInterval = setInterval(runScheduledCleanup, MAINTENANCE_INTERVAL_MS);
  maintenanceInterval.unref();

  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down.`);
    clearTimeout(maintenanceStartTimer);
    clearInterval(maintenanceInterval);
    const watchdog = setTimeout(() => {
      console.warn("[shutdown] forced exit after timeout.");
      process.exit(0);
    }, 15000);
    watchdog.unref();
    server.close(() => {
      clearTimeout(watchdog);
      process.exit(0);
    });
  }

  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });

  return { app, server, ctx };
}
