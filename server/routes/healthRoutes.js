import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";

import {
  roleIncludesAdmin,
  roleIncludesPortal,
} from "../bootstrap/role.js";
import { checkDatabaseHealth, getPool } from "../db.js";
import { getUploadStorageConfig } from "../documentFiles.js";
import { getFlowStatus } from "../flows.js";

async function checkStagingDirWritable(env) {
  const { stagingDir } = getUploadStorageConfig(env);
  await mkdir(stagingDir, { recursive: true });
  await access(stagingDir, constants.W_OK | constants.R_OK);
  return { ok: true, stagingDir };
}

export function registerHealthRoutes(app, ctx) {
  const { env, role, startupDiagnostics } = ctx;

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "portail-entreprise", now: new Date().toISOString(), role });
  });

  app.get("/readyz", async (_req, res) => {
    const errors = [...startupDiagnostics.errors];
    const warnings = [...startupDiagnostics.warnings];
    const checks = {};

    try {
      checks.database = await checkDatabaseHealth(getPool());
      if (!checks.database) {
        errors.push("Database health check failed.");
      }
    } catch (error) {
      checks.database = false;
      errors.push(`Database unreachable: ${error?.message || error}`);
    }

    const flows = getFlowStatus(env);
    checks.flows = flows;

    if (roleIncludesAdmin(role)) {
      checks.adminFlows = {
        sendInvitationsEnabled: flows.sendInvitationsEnabled,
        sendRemindersEnabled: flows.sendRemindersEnabled,
      };
    }

    if (roleIncludesPortal(role)) {
      checks.localStorage = { enabled: true };

      try {
        checks.stagingWritable = await checkStagingDirWritable(env);
      } catch (error) {
        checks.stagingWritable = { ok: false, error: error?.message || String(error) };
        errors.push(`Portal: upload staging directory is not writable (${error?.message || error}).`);
      }
    }

    const ok = errors.length === 0;
    const body = {
      ok,
      errors,
      warnings,
      checks,
      signingEnabled: startupDiagnostics.signingEnabled,
      buildReady: startupDiagnostics.buildReady,
      flows,
      role,
    };

    res.status(ok ? 200 : 503).json(body);
  });
}
