#!/usr/bin/env node
/**
 * Smoke test against a running admin + portal stack (Docker prod or dev server).
 *
 * Usage:
 *   npm run smoke:e2e
 *
 * Env (optional overrides):
 *   SMOKE_ADMIN_URL=http://localhost:3003
 *   SMOKE_PORTAL_URL=http://localhost:3002
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFiles } from "../server/app/env.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shellEnvKeys = new Set(Object.keys(process.env));
loadEnvFiles(rootDir, [".env", ".env.local", ".env.production"], shellEnvKeys);

const ADMIN_URL = (process.env.SMOKE_ADMIN_URL || "http://localhost:3003").replace(/\/$/, "");
const PORTAL_URL = (process.env.SMOKE_PORTAL_URL || "http://localhost:3002").replace(/\/$/, "");
const ADMIN_USER = process.env.PORTAL_ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.PORTAL_ADMIN_PASSWORD || "";

function fail(message) {
  console.error(`[smoke] FAIL: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`[smoke] OK: ${message}`);
}

function parseCookies(setCookieHeader) {
  const headers = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
    ? [setCookieHeader]
    : [];
  return headers.map((entry) => entry.split(";")[0]).join("; ");
}

async function requestJson(url, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { response, data };
}

async function main() {
  console.log(`[smoke] Admin: ${ADMIN_URL}`);
  console.log(`[smoke] Portal: ${PORTAL_URL}`);

  const health = await requestJson(`${ADMIN_URL}/health`);
  if (!health.response.ok || !health.data?.ok) {
    fail(`admin /health (${health.response.status})`);
  }
  pass("admin /health");

  const portalHealth = await requestJson(`${PORTAL_URL}/health`);
  if (!portalHealth.response.ok || !portalHealth.data?.ok) {
    fail(`portal /health (${portalHealth.response.status})`);
  }
  pass("portal /health");

  if (!ADMIN_PASSWORD) {
    fail("PORTAL_ADMIN_PASSWORD is required for smoke login.");
  }

  const login = await requestJson(`${ADMIN_URL}/api/admin/auth/login`, {
    method: "POST",
    body: { username: ADMIN_USER, password: ADMIN_PASSWORD },
  });
  if (!login.response.ok || !login.data?.authenticated) {
    fail(`admin login (${login.response.status}): ${login.data?.error || "unknown"}`);
  }
  const cookie = parseCookies(login.response.headers.getSetCookie?.() || []);
  pass("admin login");

  const suffix = Date.now();
  const projectId = `project-smoke-${suffix}`;
  const companyDbId = `company-smoke-${suffix}`;

  const project = await requestJson(`${ADMIN_URL}/api/admin/projects/${projectId}`, {
    method: "PUT",
    headers: { cookie },
    body: {
      name: `Smoke test ${suffix}`,
      dossierId: `SMOKE-${suffix}`,
      folderPath: `/sites/SMOKE/${suffix}`,
      deadline: "2030-12-31T23:59:59.000Z",
      customDocuments: [],
    },
  });
  if (!project.response.ok || !project.data?.id) {
    fail(`create project (${project.response.status}): ${project.data?.error || "unknown"}`);
  }
  pass(`project ${projectId}`);

  const company = await requestJson(
    `${ADMIN_URL}/api/admin/projects/${projectId}/companies/${companyDbId}`,
    {
      method: "PUT",
      headers: { cookie },
      body: {
        companyName: `Smoke Corp ${suffix}`,
        companyId: `ENT-SMOKE-${suffix}`,
        contactName: "Smoke Tester",
        companyEmail: `smoke-${suffix}@example.test`,
        submissionId: `sub-smoke-${suffix}`,
        expectedDocuments: ["NOTE_PRESENTATION", "EXTRAIT_KBIS"],
      },
    }
  );
  if (!company.response.ok || !company.data?.id) {
    fail(`create company (${company.response.status}): ${company.data?.error || "unknown"}`);
  }
  pass(`company ${companyDbId}`);

  const signed = await requestJson(`${ADMIN_URL}/api/admin/invitations/sign`, {
    method: "POST",
    headers: { cookie },
    body: {
      context: {
        projectId,
        companyId: company.data.companyId,
        companyName: company.data.companyName,
        companyEmail: company.data.companyEmail,
        contactName: company.data.contactName,
        submissionId: company.data.submissionId,
        contestName: project.data.name,
        dossierId: project.data.dossierId,
        folderPath: project.data.folderPath,
        deadline: project.data.deadline,
        documents: company.data.expectedDocuments,
      },
    },
  });
  if (!signed.response.ok || !signed.data?.url) {
    fail(`sign invitation (${signed.response.status}): ${signed.data?.error || "unknown"}`);
  }
  pass("invitation signed");

  const signedUrl = new URL(signed.data.url);
  const portalDepotUrl = `${PORTAL_URL}/depot?${signedUrl.searchParams.toString()}`;
  const depotPage = await fetch(portalDepotUrl);
  if (!depotPage.ok) {
    fail(`portal /depot with signed link (${depotPage.status})`);
  }
  const depotHtml = await depotPage.text();
  if (!depotHtml.includes("root") && !depotHtml.includes("depot")) {
    fail("portal /depot HTML unexpected");
  }
  pass("portal /depot accepts signed link");

  const verify = await requestJson(`${PORTAL_URL}/api/portal/verify`, {
    method: "POST",
    body: {
      inv: signedUrl.searchParams.get("inv"),
      sig: signedUrl.searchParams.get("sig"),
      alg: signedUrl.searchParams.get("alg") || "HS256",
    },
  });
  if (!verify.response.ok || !verify.data?.ok) {
    fail(`portal verify (${verify.response.status}): ${verify.data?.error || "unknown"}`);
  }
  pass("portal /api/portal/verify");

  const overview = await requestJson(`${ADMIN_URL}/api/admin/overview`, {
    headers: { cookie },
  });
  if (!overview.response.ok || !Array.isArray(overview.data?.projects)) {
    fail(`admin overview (${overview.response.status})`);
  }
  pass("admin overview");

  await requestJson(`${ADMIN_URL}/api/admin/projects/${projectId}`, {
    method: "DELETE",
    headers: { cookie },
  });
  pass("cleanup project deleted");

  console.log("[smoke] All checks passed.");
}

main().catch((error) => {
  console.error("[smoke] ERROR:", error?.message || error);
  process.exit(1);
});
