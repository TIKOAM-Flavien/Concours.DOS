import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import rateLimit from "express-rate-limit";

import {
  normalizeDocumentId,
  resolveDocumentList,
} from "../src/config/documentCatalog.js";
import {
  getAllProjects,
  getProject,
  upsertProject,
  deleteProject as removeProject,
  setProjectArchived,
  upsertCompany,
  deleteCompany as removeCompany,
  writeAuditLog,
} from "./db.js";
import {
  bumpSubmissionDailyUsage,
  getSubmissionDailyUsage,
  isInvitationRevoked,
  listRevokedInvitations,
  pruneRevokedInvitations,
  revokeInvitation,
  scrubOldAuditPayloads,
} from "./db.js";
import { callDownloadFlow, callFlow, getFlowConfig, getFlowStatus } from "./flows.js";
import {
  buildSignedInvitationUrl,
  getInvitationPayloadIssues,
  getSigningConfig,
  hashSignedContextId,
  isInvitationDeadlinePast,
  normalizeSharePointFolderPath,
  parsePositiveInt,
  sanitizeInvitationContext,
  verifySignedContext,
} from "./security.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const shellEnvKeys = new Set(Object.keys(process.env));
const SENSITIVE_PUBLIC_ENV_KEYS = [
  "VITE_CLIENT_PORTAL_LINK_SECRET",
  "VITE_POWER_AUTOMATE_GET_DOCUMENTS_URL",
  "VITE_POWER_AUTOMATE_DOWNLOAD_FILE_URL",
  "VITE_POWER_AUTOMATE_UPLOAD_FILE_URL",
  "VITE_POWER_AUTOMATE_UPDATE_FILE_URL",
  "VITE_POWER_AUTOMATE_DELETE_FILE_URL",
];

loadEnvFiles([".env", ".env.local"]);

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === "production";
const maxFileMb = Math.max(parsePositiveInt(process.env.PORTAL_MAX_FILE_MB, 20), 1);
const portalRateLimitPerMinute = Math.max(
  parsePositiveInt(process.env.PORTAL_RATE_LIMIT_PER_MINUTE, 60),
  1
);
const portalUploadRateLimitPerMinute = Math.max(
  parsePositiveInt(process.env.PORTAL_UPLOAD_RATE_LIMIT_PER_MINUTE, 10),
  1
);
const submissionDailyBudget = Math.max(
  parsePositiveInt(process.env.PORTAL_SUBMISSION_DAILY_BUDGET, 300),
  1
);
// Hard ceiling on per-link TTL so an admin cannot mint a quasi-permanent link
// even if PORTAL_LINK_SECRET is never rotated. Default 1 year = 525600 minutes.
const MAX_INVITATION_TTL_MINUTES = Math.max(
  parsePositiveInt(process.env.PORTAL_LINK_TTL_MAX_MINUTES, 525600),
  1
);
const base64OverheadRatio = 4 / 3; // base64 expands data ~33%
const estimatedJsonOverheadMb = 2; // small envelope: metadata + JSON syntax
const bodyLimitMb = Math.max(
  parsePositiveInt(
    process.env.PORTAL_MAX_BODY_MB,
    Math.ceil(maxFileMb * base64OverheadRatio + estimatedJsonOverheadMb)
  ),
  1
);

function maxBase64CharsForFileMb(fileMb) {
  // For a file of N bytes, base64 length is 4*ceil(N/3).
  const bytes = Math.max(1, Math.floor(fileMb * 1024 * 1024));
  return 4 * Math.ceil(bytes / 3);
}

const maxFileContentChars = maxBase64CharsForFileMb(maxFileMb);

app.disable("x-powered-by");

{
  const trustProxy = String(process.env.TRUST_PROXY || "").trim().toLowerCase();
  if (trustProxy === "1" || trustProxy === "true") {
    // Safer default than `true`: only trust loopback proxies.
    app.set("trust proxy", "loopback");
  } else if (trustProxy) {
    // Accept Express-compatible values, e.g. "loopback", "uniquelocal",
    // or a comma-separated list of IPs/subnets.
    const value = trustProxy.includes(",")
      ? trustProxy.split(",").map((part) => part.trim()).filter(Boolean)
      : trustProxy;
    app.set("trust proxy", value);
  }
}

app.use(express.json({ limit: `${bodyLimitMb}mb` }));
app.use(
  "/api/portal",
  rateLimit({
    windowMs: 60 * 1000,
    limit: portalRateLimitPerMinute,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Rate limit exceeded. Please wait and try again." },
    // Upload has its own dedicated limiter; do not double-count it against
    // the general bucket (which would make normal uploads evict other portal
    // requests from the same IP). Path is relative to the mount so we match
    // "/upload" and "/upload/*".
    skip: (req) => {
      const skipped = req.path === "/upload" || req.path.startsWith("/upload/");
      return skipped;
    },
  })
);
app.use(
  "/api/portal/upload",
  rateLimit({
    windowMs: 60 * 1000,
    limit: portalUploadRateLimitPerMinute,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Upload rate limit exceeded. Please wait and try again." },
    skip: () => false,
  })
);
app.use((err, req, res, next) => {
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({
      error: "Payload too large.",
      hint: `Increase PORTAL_MAX_BODY_MB (currently ${bodyLimitMb}MB) or reduce the upload size. For file uploads, PORTAL_MAX_FILE_MB is ${maxFileMb}MB.`,
    });
  }
  return next(err);
});
// HSTS is opt-in at the app layer: only emit it when the operator explicitly
// declares the deployment is behind HTTPS. The default 1-year max-age with
// includeSubDomains matches Mozilla baseline; `preload` is intentionally NOT
  // the default; operators must submit the domain to hstspreload.org first.
const HSTS_ENABLED = (() => {
  const raw = String(process.env.PORTAL_FORCE_HSTS || "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return isProduction; // safe default: HSTS on in NODE_ENV=production
})();
const HSTS_VALUE = (() => {
  const maxAge = Math.max(
    parsePositiveInt(process.env.PORTAL_HSTS_MAX_AGE, 31536000),
    0
  );
  const includeSubDomains =
    String(process.env.PORTAL_HSTS_INCLUDE_SUBDOMAINS || "true")
      .trim()
      .toLowerCase() !== "false";
  const preload =
    String(process.env.PORTAL_HSTS_PRELOAD || "false").trim().toLowerCase() ===
    "true";
  return [
    `max-age=${maxAge}`,
    includeSubDomains ? "includeSubDomains" : "",
    preload ? "preload" : "",
  ]
    .filter(Boolean)
    .join("; ");
})();

app.use((req, res, next) => {
  res.set("Content-Security-Policy", [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-src 'self' blob:",
  ].join("; "));
  res.set("Cross-Origin-Opener-Policy", "same-origin");
  res.set("Cross-Origin-Resource-Policy", "same-origin");
  res.set("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  // Belt-and-braces against accidental indexing of the portal entry point or
  // the admin shell. Search engines must not crawl `/depot` (which always
  // returns 403 without a signed link anyway) nor `/admin` (localhost-only).
  res.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");

  if (HSTS_ENABLED && HSTS_VALUE) {
    res.set("Strict-Transport-Security", HSTS_VALUE);
  }

  if (
    req.path.startsWith("/api") ||
    req.path === "/health" ||
    req.path === "/readyz"
  ) {
    res.set("Cache-Control", "no-store");
  }

  next();
});

// Public robots.txt: blanket disallow. The portal is invite-only and the
// admin shell is localhost-only, so neither should ever surface in a search
// index. Served before static assets so it wins over any future bundled copy.
app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send("User-agent: *\nDisallow: /\n");
});
app.use("/api", requireTrustedBrowserOrigin);

const staticBundle = getStaticBundle();
const startupDiagnostics = getStartupDiagnostics(staticBundle);

for (const warning of startupDiagnostics.warnings) {
  console.warn(`[startup] ${warning}`);
}

if (startupDiagnostics.errors.length) {
  for (const error of startupDiagnostics.errors) {
    console.error(`[startup] ${error}`);
  }

  if (isProduction) {
    process.exit(1);
  }
}

function loadEnvFiles(fileNames) {
  for (const fileName of fileNames) {
    const path = resolve(rootDir, fileName);
    if (!existsSync(path)) continue;

    const source = readFileSync(path, "utf8");
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;

      const key = match[1];
      if (shellEnvKeys.has(key)) continue;

      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value.replace(/\\n/g, "\n");
    }
  }
}

function wrap(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      console.error(err);
      res.status(err.statusCode || 500).json({ error: err.message });
    });
  };
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function forbidden(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

function tooManyRequests(message) {
  const error = new Error(message);
  error.statusCode = 429;
  return error;
}

function serviceUnavailable(message) {
  const error = new Error(message);
  error.statusCode = 503;
  return error;
}

function normalizeIp(rawIp) {
  const value = String(rawIp || "").trim().toLowerCase();
  if (value.startsWith("::ffff:")) return value.slice(7);
  return value;
}

function getActorIp(req) {
  return normalizeIp(req.socket?.remoteAddress || req.ip || "");
}

function audit(req, action, payload) {
  try {
    writeAuditLog({ actorIp: getActorIp(req), action, payload });
  } catch (error) {
    console.warn("[audit] failed:", error?.message || error);
  }
}

function isLocalRequest(req) {
  const ip = normalizeIp(req.socket?.remoteAddress);
  return ip === "127.0.0.1" || ip === "::1";
}

function requireLocalAdmin(req, res, next) {
  if (isLocalRequest(req)) return next();
  return res.status(403).json({
    error:
      "Admin access is restricted to localhost. Use a local session on the server host.",
  });
}

function isLocalhostHost(value) {
  const text = String(value || "").trim().toLowerCase();
  const host = text.startsWith("[::1]") ? "[::1]" : text.split(":")[0];
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

function isTrustedBrowserOrigin(req) {
  const fetchSite = String(req.get("sec-fetch-site") || "").toLowerCase();
  if (fetchSite && fetchSite === "cross-site") return false;

  const origin = req.get("origin");
  if (!origin) return true;

  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  const requestHost = String(req.get("host") || "").toLowerCase();
  if (originUrl.host.toLowerCase() === requestHost) return true;

  const { publicPortalUrl } = getSigningConfig(process.env);
  if (publicPortalUrl) {
    try {
      const publicUrl = new URL(publicPortalUrl);
      if (originUrl.origin === publicUrl.origin) return true;
    } catch {
      // Invalid public URL is already reported by startup diagnostics.
    }
  }

  return !isProduction && isLocalhostHost(originUrl.host);
}

function requireTrustedBrowserOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (isTrustedBrowserOrigin(req)) return next();
  return res.status(403).json({ error: "Cross-origin API request rejected." });
}

function normalizeTextField(value, fieldName, { required = false, max = 500 } = {}) {
  const normalized = String(value || "").trim();
  if (required && !normalized) {
    throw badRequest(`Missing required field: ${fieldName}`);
  }
  if (normalized.length > max) {
    throw badRequest(`Field too long: ${fieldName}`);
  }
  return normalized;
}

function normalizeEmailField(value, fieldName, { required = false } = {}) {
  const email = normalizeTextField(value, fieldName, { required, max: 320 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest(`Invalid email: ${fieldName}`);
  }
  return email;
}

function normalizeDocumentIds(rawDocumentIds) {
  if (!Array.isArray(rawDocumentIds)) {
    throw badRequest("expectedDocuments/documents must be an array.");
  }

  const ids = Array.from(
    new Set(
      rawDocumentIds
        .map((value) => normalizeDocumentId(value))
        .filter(Boolean)
    )
  );

  return ids;
}

function normalizeDeadline(value) {
  const deadline = normalizeTextField(value, "deadline", { max: 100 });
  if (!deadline) return "";

  const parsed = new Date(deadline);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest("Invalid deadline value.");
  }

  return deadline;
}

function normalizeCustomProjectDocuments(raw) {
  const source = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
    ? raw.split(/\r?\n/)
    : [];

  const items = source
    .map((value) => (typeof value === "string" ? value : value?.label || value?.name || ""))
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  const seen = new Set();
  const out = [];
  for (const label of items) {
    const id = normalizeDocumentId(`CUSTOM_${label}`);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label,
      category: "Pieces specifiques",
      summary: "Piece specifique definie pour ce projet.",
      acceptedFormats: ["PDF"],
      accent: "#4b5563",
    });
  }

  return out;
}

function normalizeFileName(value) {
  const trimmed = normalizeTextField(value, "fileName", { required: true, max: 260 });
  const safeName = trimmed.split(/[\\/]/).pop()?.trim() || "";
  if (!safeName) {
    throw badRequest("Invalid fileName.");
  }
  return safeName;
}

function prefixFileNameWithCompany(fileName, companyName) {
  const prefix = (companyName || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 3)
    .toUpperCase();
  if (!prefix) return fileName;
  if (fileName.startsWith(`${prefix}_`)) return fileName;
  return `${prefix}_${fileName}`;
}

function ensureFlowUrl(url, label) {
  if (!url) {
    throw serviceUnavailable(
      `${label}: configure the corresponding POWER_AUTOMATE_* environment variable on the server.`
    );
  }
}

function sanitizeProjectPayload(raw = {}) {
  return {
    name: normalizeTextField(raw.name, "name", { required: true, max: 180 }),
    dossierId: normalizeTextField(raw.dossierId, "dossierId", {
      required: true,
      max: 180,
    }),
    folderPath: normalizeSharePointFolderPath(
      normalizeTextField(raw.folderPath, "folderPath", {
        required: true,
        max: 500,
      })
    ),
    deadline: normalizeDeadline(raw.deadline),
    customDocuments: normalizeCustomProjectDocuments(raw.customDocuments),
  };
}

function sanitizeCompanyPayload(raw = {}) {
  const expectedDocuments = normalizeDocumentIds(raw.expectedDocuments);
  if (!expectedDocuments.length) {
    throw badRequest("At least one expected document is required.");
  }

  return {
    companyName: normalizeTextField(raw.companyName, "companyName", {
      required: true,
      max: 180,
    }),
    companyId: normalizeTextField(raw.companyId, "companyId", {
      required: true,
      max: 120,
    }),
    contactName: normalizeTextField(raw.contactName, "contactName", {
      required: true,
      max: 180,
    }),
    companyEmail: normalizeEmailField(raw.companyEmail, "companyEmail", {
      required: true,
    }),
    submissionId: normalizeTextField(raw.submissionId, "submissionId", {
      required: true,
      max: 180,
    }),
    expectedDocuments,
  };
}

function buildMetadata(context, document) {
  return {
    dossierId: context.dossierId,
    companyId: context.companyId,
    companyName: context.companyName,
    companyEmail: context.companyEmail,
    contactName: context.contactName,
    contestName: context.contestName,
    deadline: context.deadline,
    submissionId: context.submissionId,
    documentType: document.id,
    documentLabel: document.label,
    source: "client-portal",
  };
}

function resolvePortalEntryUrl(req) {
  const { publicPortalUrl } = getSigningConfig(process.env);
  if (publicPortalUrl) {
    try {
      const configured = new URL(publicPortalUrl);
      if (!configured.pathname || configured.pathname === "/") {
        configured.pathname = "/depot";
      }
      return configured.toString();
    } catch {
      // Invalid URL in environment, fallback to current host.
    }
  }

  const protocol = req.protocol || "http";
  const host = req.get("host") || `localhost:${PORT}`;
  return new URL("/depot", `${protocol}://${host}`).toString();
}

function getStaticBundle() {
  const distAllDir = resolve(rootDir, "dist-all");
  const splitPortalDir = resolve(rootDir, "dist");
  const splitAdminDir = resolve(rootDir, "dist-admin");

  const distAllPortalHtml = resolve(distAllDir, "index.html");
  const distAllAdminHtml = resolve(distAllDir, "admin.html");

  if (existsSync(distAllPortalHtml) && existsSync(distAllAdminHtml)) {
    return {
      portalHtmlPath: distAllPortalHtml,
      adminHtmlPath: distAllAdminHtml,
      assetsDirs: [resolve(distAllDir, "assets")],
    };
  }

  const splitPortalHtml = resolve(splitPortalDir, "index.html");
  const splitAdminHtml = resolve(splitAdminDir, "admin.html");
  if (existsSync(splitPortalHtml) && existsSync(splitAdminHtml)) {
    return {
      portalHtmlPath: splitPortalHtml,
      adminHtmlPath: splitAdminHtml,
      assetsDirs: [resolve(splitAdminDir, "assets"), resolve(splitPortalDir, "assets")],
    };
  }

  return null;
}

function renderDepotAccessError(res, code) {
  const messages = {
    missing_ctx: "Le lien ne contient pas de contexte (ctx).",
    missing_sig: "Le lien ne contient pas de signature (sig).",
    invalid_alg: "L'algorithme de signature n'est pas supporte.",
    invalid_sig: "La signature du lien est invalide.",
    invalid_ctx: "Le contexte du lien est invalide.",
    invalid_exp: "La date d'expiration du lien est invalide.",
    invalid_payload: "Le lien signe ne contient pas toutes les informations requises.",
    expired: "Le lien est expire.",
    deadline_passed:
      "La date limite de depot est passee. Le portail n'est plus accessible pour cette invitation.",
    revoked: "Le lien a ete revoque.",
    missing_secret: "La signature serveur n'est pas configuree.",
  };

  const message = messages[code] || "Lien de depot invalide.";
  res.status(403).type("html").send(
    `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Acces refuse</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; background: #f6f7fb; color: #182033; }
      main { max-width: 680px; margin: 8vh auto; padding: 2rem; background: #fff; border-radius: 14px; box-shadow: 0 14px 30px rgba(16, 24, 40, 0.1); }
      h1 { margin: 0 0 0.75rem; font-size: 1.4rem; }
      p { margin: 0; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <h1>Acces depot refuse</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`
  );
}

function verifyInvitationFields(payload) {
  const issues = getInvitationPayloadIssues(payload);
  if (issues.length) {
    return { ok: false, code: "invalid_payload", issues };
  }

  return { ok: true, code: "ok", issues: [] };
}

function ensureInvitationNotRevoked(ctx) {
  const id = hashSignedContextId(ctx);
  if (isInvitationRevoked(id)) {
    throw forbidden("Signed invitation revoked.");
  }
}

function requireSignedDepotLink(req, res, next) {
  const { secret } = getSigningConfig(process.env);
  const ctx = String(req.query.ctx || "");
  const sig = String(req.query.sig || "");
  const alg = String(req.query.alg || "HS256");

  const verification = verifySignedContext({
    ctx,
    sig,
    alg,
    secret,
  });

  if (!verification.ok) {
    return renderDepotAccessError(res, verification.code);
  }

  const payloadCheck = verifyInvitationFields(verification.payload);
  if (!payloadCheck.ok) {
    return renderDepotAccessError(res, payloadCheck.code);
  }

  if (isInvitationDeadlinePast(verification.payload)) {
    return renderDepotAccessError(res, "deadline_passed");
  }

  try {
    ensureInvitationNotRevoked(ctx);
  } catch {
    return renderDepotAccessError(res, "revoked");
  }

  return next();
}

function getVerifiedInvitationFromBody(body = {}) {
  const signing = getSigningConfig(process.env);
  const ctx = normalizeTextField(body.ctx, "ctx", { required: true, max: 4000 });
  const sig = normalizeTextField(body.sig, "sig", { required: true, max: 512 });
  const alg = normalizeTextField(body.alg || "HS256", "alg", { max: 20 }) || "HS256";

  const verification = verifySignedContext({
    ctx,
    sig,
    alg,
    secret: signing.secret,
  });

  if (!verification.ok) {
    throw forbidden(`Signed invitation rejected (${verification.code}).`);
  }

  const payloadCheck = verifyInvitationFields(verification.payload);
  if (!payloadCheck.ok) {
    throw forbidden(
      `Signed invitation is incomplete: ${payloadCheck.issues.join(", ")}.`
    );
  }

  if (isInvitationDeadlinePast(verification.payload)) {
    throw forbidden("Signed invitation rejected (deadline_passed).");
  }

  ensureInvitationNotRevoked(ctx);

  return sanitizeInvitationContext(verification.payload);
}

// Check-only: throws 429 when the per-submission budget is exhausted. Does
// not mutate state. Call BEFORE the (potentially failing) Power Automate flow.
function checkSubmissionDailyBudget(invitation, { cost = 1 } = {}) {
  const submissionId = String(invitation?.submissionId || "").trim();
  if (!submissionId) return { submissionId: "", used: 0, remaining: Infinity };

  const used = getSubmissionDailyUsage({ submissionId });
  const remaining = submissionDailyBudget - used;
  if (remaining < cost) {
    throw tooManyRequests(
      "Daily submission request budget exceeded. Please try again tomorrow or contact support."
    );
  }
  return { submissionId, used, remaining };
}

// Commit: increment usage AFTER the flow succeeded. Safe to skip when the
// request had no submissionId (shouldn't happen for verified invitations).
function commitSubmissionDailyBudget(invitation, { cost = 1 } = {}) {
  const submissionId = String(invitation?.submissionId || "").trim();
  if (!submissionId) return;
  bumpSubmissionDailyUsage({ submissionId, delta: cost });
}

function resolveInvitationDocument(invitation, rawDocumentId) {
  const documentId = normalizeDocumentId(rawDocumentId);
  if (!documentId) {
    throw badRequest("Missing required field: documentId");
  }

  const allowedDocuments = resolveDocumentList(invitation.documents);
  const document = allowedDocuments.find((entry) => entry.id === documentId);
  if (!document) {
    throw forbidden(`Document type ${documentId} is not allowed by this invitation.`);
  }

  return document;
}

function ensurePathWithinFolder(filePath, folderPath) {
  const normalizedFilePath = normalizeSharePointFolderPath(
    normalizeTextField(filePath, "filePath", { required: true, max: 1000 })
  );
  const normalizedFolderPath = normalizeSharePointFolderPath(folderPath);

  const fileLower = normalizedFilePath.toLowerCase();
  const folderLower = normalizedFolderPath.toLowerCase();

  if (fileLower === folderLower || fileLower.startsWith(`${folderLower}/`)) {
    return normalizedFilePath;
  }

  throw forbidden("filePath is outside the invitation folder.");
}

function normalizeLookupKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function readObjectPathValue(source, path) {
  return String(path || "")
    .split(".")
    .reduce((current, segment) => (current == null ? null : current[segment]), source);
}

function readRecordField(row, candidates) {
  const record = row || {};
  const keys = Object.keys(record);
  const lookup = new Map(keys.map((key) => [normalizeLookupKey(key), key]));

  for (const candidate of candidates) {
    const directValue = candidate.includes(".")
      ? readObjectPathValue(record, candidate)
      : record[candidate];
    if (directValue != null && String(directValue).trim() !== "") {
      return String(directValue).trim();
    }

    if (candidate.includes(".")) continue;

    const mappedKey = lookup.get(normalizeLookupKey(candidate));
    if (!mappedKey) continue;

    const mappedValue = record[mappedKey];
    if (mappedValue != null && String(mappedValue).trim() !== "") {
      return String(mappedValue).trim();
    }
  }

  return "";
}

function normalizeRecordPathFromRow(row) {
  return normalizeSharePointFolderPath(
    readRecordField(row, [
      "ServerRelativeUrl",
      "Path",
      "FileRef",
      "RelativeUrl",
      "DecodedUrl",
      "ServerRelativePath.DecodedUrl",
      "filePath",
    ])
  );
}

function normalizeRecordIdentifierFromRow(row) {
  return readRecordField(row, [
    "Identifier",
    "identifier",
    "UniqueId",
    "FileIdentifier",
    "DriveItemId",
    "FileId",
    "ID",
    "Id",
    "fileIdentifier",
  ]);
}

async function ensureFileReferenceAllowed({
  flowConfig,
  invitation,
  filePath,
  fileIdentifier,
  requirePath = false,
}) {
  const normalizedFilePath = filePath
    ? normalizeSharePointFolderPath(
        normalizeTextField(filePath, "filePath", { required: true, max: 1000 })
      )
    : "";
  const normalizedFileIdentifier = fileIdentifier
    ? normalizeTextField(fileIdentifier, "fileIdentifier", { required: true, max: 1000 })
    : "";

  if (requirePath && !normalizedFilePath) {
    throw badRequest("Missing required field: filePath");
  }

  if (!normalizedFilePath && !normalizedFileIdentifier) {
    throw badRequest("Missing file reference.");
  }

  if (normalizedFilePath) {
    try {
      return ensurePathWithinFolder(normalizedFilePath, invitation.folderPath);
    } catch {
      // Some SharePoint integrations return equivalent paths with different
      // prefixes. Fall back to invitation-scoped record verification.
    }
  }

  ensureFlowUrl(flowConfig.getDocumentsUrl, "GET_DOCUMENTS");
  const rows = await callFlow("GET_DOCUMENTS", flowConfig.getDocumentsUrl, {
    dossierId: invitation.dossierId,
    companyId: invitation.companyId,
    companyName: invitation.companyName,
    submissionId: invitation.submissionId,
  });

  const expectedPath = normalizedFilePath.toLowerCase();
  const expectedIdentifier = normalizedFileIdentifier.toLowerCase();
  const isAllowed = Array.isArray(rows) && rows.some((row) => {
    const rowPath = normalizeRecordPathFromRow(row).toLowerCase();
    const rowIdentifier = normalizeRecordIdentifierFromRow(row).toLowerCase();

    if (expectedIdentifier && rowIdentifier && rowIdentifier === expectedIdentifier) {
      return true;
    }
    if (expectedPath && rowPath && rowPath === expectedPath) {
      return true;
    }
    return false;
  });

  if (!isAllowed) {
    throw forbidden("filePath is outside the invitation folder.");
  }

  return normalizedFilePath;
}

// Combined verification: ensures the reference is allowed for the invitation
// AND that the SharePoint record's document type matches `documentId`. Fetches
// GET_DOCUMENTS at most once (instead of up to twice in the previous split).
async function verifyFileReferenceAndDocumentType({
  flowConfig,
  invitation,
  filePath,
  fileIdentifier,
  documentId,
  requirePath = false,
}) {
  const expected = normalizeDocumentId(documentId);
  if (!expected) {
    throw badRequest("Missing required field: documentId");
  }

  const normalizedFilePath = filePath
    ? normalizeSharePointFolderPath(
        normalizeTextField(filePath, "filePath", { required: true, max: 1000 })
      )
    : "";
  const normalizedFileIdentifier = fileIdentifier
    ? normalizeTextField(fileIdentifier, "fileIdentifier", { required: true, max: 1000 })
    : "";

  if (requirePath && !normalizedFilePath) {
    throw badRequest("Missing required field: filePath");
  }
  if (!normalizedFilePath && !normalizedFileIdentifier) {
    throw badRequest("Missing file reference.");
  }

  ensureFlowUrl(flowConfig.getDocumentsUrl, "GET_DOCUMENTS");
  const rows = await callFlow("GET_DOCUMENTS", flowConfig.getDocumentsUrl, {
    dossierId: invitation.dossierId,
    companyId: invitation.companyId,
    companyName: invitation.companyName,
    submissionId: invitation.submissionId,
  });

  const expectedPath = normalizedFilePath.toLowerCase();
  const expectedIdentifier = normalizedFileIdentifier.toLowerCase();
  const matchedRow = Array.isArray(rows)
    ? rows.find((row) => {
        const rowPath = normalizeRecordPathFromRow(row).toLowerCase();
        const rowIdentifier = normalizeRecordIdentifierFromRow(row).toLowerCase();

        if (expectedIdentifier && rowIdentifier && rowIdentifier === expectedIdentifier) {
          return true;
        }
        if (expectedPath && rowPath && rowPath === expectedPath) {
          return true;
        }
        return false;
      })
    : null;

  if (!matchedRow) {
    throw forbidden("file reference could not be verified.");
  }

  // The row was found in GET_DOCUMENTS, which is already scoped to this
  // invitation's dossierId / companyId / submissionId. An additional
  // ensurePathWithinFolder check here is intentionally omitted: it was
  // causing false rejections when the file's SharePoint server-relative path
  // differs in format from invitation.folderPath (e.g. subfolder created by
  // the UPLOAD flow, or a path prefix mismatch between SharePoint and the
  // signed invitation). The documentType check below provides the second
  // layer of verification.
  const rowPath = normalizeRecordPathFromRow(matchedRow);
  const resolvedPath = rowPath || normalizedFilePath;

  const actualRaw = readRecordField(matchedRow, [
    "DocumentType",
    "Type_piece",
    "type_piece",
    "documentType",
    "documentId",
  ]);
  const actual = normalizeDocumentId(actualRaw);
  if (!actual) {
    throw forbidden("file document type could not be verified.");
  }

  if (actual !== expected) {
    throw forbidden(`documentId mismatch: expected ${expected} but file is ${actual}.`);
  }

  return resolvedPath || normalizedFilePath;
}

function buildAdminSecurityResponse(req) {
  const signing = getSigningConfig(process.env);
  return {
    signingEnabled: Boolean(signing.secret),
    ttlMinutes: signing.ttlMinutes,
    portalUrl: resolvePortalEntryUrl(req),
    flows: getFlowStatus(process.env),
    warnings: startupDiagnostics.warnings,
  };
}

function isWeakSigningSecret(secret) {
  const value = String(secret || "").trim();
  if (!value) return true;
  if (Buffer.byteLength(value, "utf8") < 32) return true;
  return /replace|change|secret|example|password|changeme/i.test(value);
}

function getStartupDiagnostics(bundle) {
  const signing = getSigningConfig(process.env);
  const flows = getFlowStatus(process.env);
  const errors = [];
  const warnings = [];

  if (!bundle) {
    errors.push("Frontend build missing. Run `npm run build:all` before starting the server.");
  }

  if (!signing.secret) {
    errors.push("PORTAL_LINK_SECRET is missing. Signed invitations cannot be verified.");
  } else if (isWeakSigningSecret(signing.secret)) {
    errors.push(
      "PORTAL_LINK_SECRET must be a strong non-placeholder secret of at least 32 bytes."
    );
  }

  if (!flows.documentsEnabled) {
    errors.push("POWER_AUTOMATE_GET_DOCUMENTS_URL is missing.");
  }
  if (!flows.uploadEnabled) {
    errors.push("POWER_AUTOMATE_UPLOAD_FILE_URL is missing.");
  }
  if (!flows.updateEnabled) {
    errors.push("POWER_AUTOMATE_UPDATE_FILE_URL is missing.");
  }
  if (!flows.deleteEnabled) {
    errors.push("POWER_AUTOMATE_DELETE_FILE_URL is missing.");
  }
  if (!flows.downloadEnabled) {
    warnings.push("POWER_AUTOMATE_DOWNLOAD_FILE_URL is missing. Preview/download will be unavailable.");
  }

  const detectedPublicKeys = SENSITIVE_PUBLIC_ENV_KEYS.filter((key) => Boolean(process.env[key]));
  if (detectedPublicKeys.length) {
    errors.push(
      `Sensitive public env keys detected (${detectedPublicKeys.join(", ")}). Use server-only environment variable names.`
    );
  }

  if (!process.env.PORTAL_ADMIN_DB_PATH) {
    warnings.push(
      "PORTAL_ADMIN_DB_PATH is not set. SQLite will default to server/admin.db; set a persistent path outside the repo for production."
    );
  }

  if (signing.publicPortalUrl) {
    try {
      const url = new URL(signing.publicPortalUrl);
      if (isProduction && url.protocol !== "https:") {
        warnings.push(
          "CLIENT_PORTAL_PUBLIC_URL/PORTAL_PUBLIC_URL should use HTTPS in production."
        );
      }
    } catch {
      warnings.push(
        "CLIENT_PORTAL_PUBLIC_URL/PORTAL_PUBLIC_URL is not a valid absolute URL. The server will fallback to the request host."
      );
    }
  } else {
    warnings.push(
      "CLIENT_PORTAL_PUBLIC_URL/PORTAL_PUBLIC_URL is not set. Signed links will fallback to the current request host."
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    signingEnabled: Boolean(signing.secret),
    buildReady: Boolean(bundle),
    flows,
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "portail-entreprise", now: new Date().toISOString() });
});

app.get("/readyz", (_req, res) => {
  res.status(startupDiagnostics.ok ? 200 : 503).json(startupDiagnostics);
});

app.get(
  ["/api/admin/security", "/api/security"],
  requireLocalAdmin,
  wrap((req, res) => {
    res.json(buildAdminSecurityResponse(req));
  })
);

app.post(
  ["/api/admin/invitations/sign", "/api/invitations/sign"],
  requireLocalAdmin,
  wrap((req, res) => {
    const signing = getSigningConfig(process.env);
    if (!signing.secret) {
      throw serviceUnavailable(
        "Signature secret missing on server. Configure PORTAL_LINK_SECRET to sign links."
      );
    }

    const context = sanitizeInvitationContext(req.body?.context || req.body || {});
    const issues = getInvitationPayloadIssues(context);

    if (issues.length) {
      throw badRequest(`Missing required fields: ${issues.join(", ")}`);
    }

    const rawTtl = req.body?.ttlMinutes;
    const ttlSupplied =
      rawTtl !== undefined && rawTtl !== null && String(rawTtl).trim() !== "";
    let ttlMinutes;
    if (ttlSupplied) {
      const parsed = parsePositiveInt(rawTtl, 0);
      // Treat 0 or invalid as "use server default" to be tolerant of UIs
      // that always send a number even when the operator leaves the field empty.
      if (parsed > 0) {
        ttlMinutes = Math.min(parsed, MAX_INVITATION_TTL_MINUTES);
      } else {
        ttlMinutes = signing.ttlMinutes > 0 ? signing.ttlMinutes : MAX_INVITATION_TTL_MINUTES;
      }
    } else {
      ttlMinutes = signing.ttlMinutes > 0 ? signing.ttlMinutes : MAX_INVITATION_TTL_MINUTES;
    }
    const signed = buildSignedInvitationUrl({
      context,
      secret: signing.secret,
      ttlMinutes,
      baseUrl: resolvePortalEntryUrl(req),
    });

    audit(req, "admin.invitation.sign", {
      companyId: context.companyId,
      companyName: context.companyName,
      submissionId: context.submissionId,
      dossierId: context.dossierId,
      ttlMinutes,
      expiresAt: signed.payload.exp || null,
    });

    res.json({
      url: signed.url,
      expiresAt: signed.payload.exp || null,
      issuedAt: signed.payload.iat,
      signatureAlgorithm: "HS256",
    });
  })
);

function buildCompanyInvitationContext(project, company) {
  const customDocs = Array.isArray(project.customDocuments) ? project.customDocuments : [];
  const customById = new Map(
    customDocs
      .filter((doc) => doc && typeof doc === "object" && doc.id)
      .map((doc) => [doc.id, doc])
  );
  const documents = (company.expectedDocuments || []).map(
    (id) => customById.get(id) || id
  );

  return {
    companyId: company.companyId,
    companyName: company.companyName,
    companyEmail: company.companyEmail,
    contactName: company.contactName,
    submissionId: company.submissionId,
    contestName: project.name,
    dossierId: project.dossierId,
    folderPath: project.folderPath,
    deadline: project.deadline,
    documents,
  };
}

function signInvitationForCompany({ project, company, signing, req }) {
  const context = sanitizeInvitationContext(
    buildCompanyInvitationContext(project, company)
  );
  const issues = getInvitationPayloadIssues(context);
  if (issues.length) {
    throw badRequest(
      `Entreprise ${company.companyName || company.id}: champs manquants (${issues.join(", ")}).`
    );
  }
  const ttlMinutes =
    signing.ttlMinutes > 0
      ? Math.min(signing.ttlMinutes, MAX_INVITATION_TTL_MINUTES)
      : MAX_INVITATION_TTL_MINUTES;

  return buildSignedInvitationUrl({
    context,
    secret: signing.secret,
    ttlMinutes,
    baseUrl: resolvePortalEntryUrl(req),
  });
}

function matchCompanyRow(row, company) {
  const rowSubmission = normalizeLookupKey(
    readRecordField(row, [
      "SubmissionId",
      "submissionId",
      "SubmissionToken",
      "JetonDepot",
      "Token",
    ])
  );
  const companySubmission = normalizeLookupKey(company.submissionId);
  if (companySubmission && rowSubmission) {
    return rowSubmission === companySubmission;
  }

  const rowCompanyId = normalizeLookupKey(
    readRecordField(row, [
      "CompanyId",
      "companyId",
      "EntrepriseId",
      "SocieteId",
      "VendorId",
    ])
  );
  const companyCompanyId = normalizeLookupKey(company.companyId);
  if (companyCompanyId && rowCompanyId) {
    return rowCompanyId === companyCompanyId;
  }

  const rowCompanyName = normalizeLookupKey(
    readRecordField(row, [
      "Entreprise_depot",
      "CompanyName",
      "companyName",
      "Entreprise",
      "Societe",
      "VendorName",
    ])
  );
  return normalizeLookupKey(company.companyName) === rowCompanyName;
}

function readRowDocumentType(row) {
  return normalizeDocumentId(
    readRecordField(row, [
      "DocumentType",
      "Type_piece",
      "type_piece",
      "documentType",
      "documentId",
    ])
  );
}

function readRowModifiedAt(row) {
  return readRecordField(row, [
    "Modified",
    "TimeLastModified",
    "LastModified",
    "modifiedAt",
    "date",
  ]);
}

function buildProjectOverviewBase(project) {
  const companies = Array.isArray(project.companies) ? project.companies : [];
  const expectedCount = companies.reduce(
    (sum, company) =>
      sum +
      (Array.isArray(company.expectedDocuments)
        ? company.expectedDocuments.length
        : 0),
    0
  );
  return {
    id: project.id,
    name: project.name || "",
    dossierId: project.dossierId || "",
    folderPath: project.folderPath || "",
    deadline: project.deadline || "",
    companyCount: companies.length,
    expectedCount,
  };
}

function buildProjectOverview(project, rows) {
  const base = buildProjectOverviewBase(project);
  const companies = Array.isArray(project.companies) ? project.companies : [];
  let receivedCount = 0;
  let completeCompanies = 0;
  let incompleteCompanies = 0;
  let lastReceptionAt = "";
  let lastReceptionTime = 0;

  for (const company of companies) {
    const expected = Array.isArray(company.expectedDocuments)
      ? company.expectedDocuments
      : [];
    const companyRows = rows.filter((row) => matchCompanyRow(row, company));
    const presentTypes = new Set(
      companyRows.map(readRowDocumentType).filter(Boolean)
    );
    const received = expected.filter((id) => presentTypes.has(id)).length;
    receivedCount += received;

    if (expected.length > 0 && received >= expected.length) {
      completeCompanies += 1;
    } else if (expected.length > 0) {
      incompleteCompanies += 1;
    }

    for (const row of companyRows) {
      const modified = readRowModifiedAt(row);
      const modifiedTime = Date.parse(modified || "") || 0;
      if (modified && modifiedTime >= lastReceptionTime) {
        lastReceptionAt = modified;
        lastReceptionTime = modifiedTime;
      }
    }
  }

  const completionRate =
    base.expectedCount > 0
      ? Math.round((receivedCount / base.expectedCount) * 100)
      : 0;
  const statusKey =
    base.expectedCount === 0
      ? "empty"
      : completionRate >= 100
      ? "complete"
      : completionRate >= 80
      ? "almost"
      : completionRate > 0
      ? "progress"
      : "todo";

  return {
    ...base,
    receivedCount,
    completionRate,
    statusKey,
    completeCompanies,
    incompleteCompanies,
    lastReceptionAt,
    syncError: "",
  };
}

function resolveCompanyTargets(project, rawIds) {
  const allCompanies = Array.isArray(project.companies) ? project.companies : [];
  const selectedIds = Array.isArray(rawIds)
    ? rawIds.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const targets = selectedIds.length
    ? allCompanies.filter((company) => selectedIds.includes(company.id))
    : allCompanies;

  return { targets, explicitSelection: selectedIds.length > 0 };
}

app.post(
  [
    "/api/admin/projects/:id/send-invitations",
    "/api/projects/:id/send-invitations",
  ],
  requireLocalAdmin,
  wrap(async (req, res) => {
    const flowConfig = getFlowConfig(process.env);
    ensureFlowUrl(flowConfig.sendInvitationsUrl, "SEND_INVITATIONS");
    const signing = getSigningConfig(process.env);
    if (!signing.secret) {
      throw serviceUnavailable(
        "Signature secret missing on server. Configure PORTAL_LINK_SECRET."
      );
    }

    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const { targets } = resolveCompanyTargets(project, req.body?.companyIds);
    if (!targets.length) {
      throw badRequest("Aucune entreprise selectionnee pour l'envoi d'invitations.");
    }

    const invitations = [];
    for (const company of targets) {
      if (!company.companyEmail) {
        throw badRequest(
          `Entreprise ${company.companyName || company.id}: email manquant.`
        );
      }
      const signed = signInvitationForCompany({ project, company, signing, req });
      invitations.push({
        companyId: company.companyId,
        companyName: company.companyName,
        companyEmail: company.companyEmail,
        contactName: company.contactName,
        submissionId: company.submissionId,
        url: signed.url,
        expiresAt: signed.payload.exp || "",
      });
    }

    const payload = {
      type: "invitation",
      projectId: project.id,
      projectName: project.name,
      dossierId: project.dossierId,
      deadline: project.deadline || "",
      portalUrl: resolvePortalEntryUrl(req),
      invitations,
    };

    const result = await callFlow(
      "SEND_INVITATIONS",
      flowConfig.sendInvitationsUrl,
      payload
    );

    audit(req, "admin.invitations.send", {
      projectId: project.id,
      count: invitations.length,
      companyIds: invitations.map((item) => item.companyId),
    });

    res.json({ ok: true, count: invitations.length, result });
  })
);

app.post(
  [
    "/api/admin/projects/:id/send-reminders",
    "/api/projects/:id/send-reminders",
  ],
  requireLocalAdmin,
  wrap(async (req, res) => {
    const flowConfig = getFlowConfig(process.env);
    ensureFlowUrl(flowConfig.sendRemindersUrl, "SEND_REMINDERS");
    ensureFlowUrl(flowConfig.getDocumentsUrl, "GET_DOCUMENTS");
    const signing = getSigningConfig(process.env);
    if (!signing.secret) {
      throw serviceUnavailable(
        "Signature secret missing on server. Configure PORTAL_LINK_SECRET."
      );
    }

    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const { targets, explicitSelection } = resolveCompanyTargets(
      project,
      req.body?.companyIds
    );
    if (!targets.length) {
      throw badRequest("Aucune entreprise a relancer.");
    }

    const rows = await callFlow("GET_DOCUMENTS", flowConfig.getDocumentsUrl, {
      dossierId: project.dossierId,
      companyId: "",
      companyName: "",
      submissionId: "",
    });
    const documentRows = Array.isArray(rows) ? rows : [];

    const customDocs = Array.isArray(project.customDocuments)
      ? project.customDocuments
      : [];
    const customById = new Map(
      customDocs
        .filter((doc) => doc && typeof doc === "object" && doc.id)
        .map((doc) => [doc.id, doc])
    );

    const reminders = [];
    const skipped = [];
    for (const company of targets) {
      if (!company.companyEmail) {
        throw badRequest(
          `Entreprise ${company.companyName || company.id}: email manquant.`
        );
      }

      const expectedIds = Array.isArray(company.expectedDocuments)
        ? company.expectedDocuments
        : [];
      const companyRows = documentRows.filter((row) => matchCompanyRow(row, company));
      const presentIds = new Set(
        companyRows.map(readRowDocumentType).filter(Boolean)
      );
      const missingIds = expectedIds.filter((id) => !presentIds.has(id));

      if (!missingIds.length) {
        skipped.push({ companyId: company.companyId, reason: "complete" });
        if (!explicitSelection) continue;
      }

      const missingDocuments = resolveDocumentList(
        missingIds.map((id) => customById.get(id) || id)
      ).map((doc) => ({ id: doc.id, label: doc.label }));

      const signed = signInvitationForCompany({ project, company, signing, req });
      reminders.push({
        companyId: company.companyId,
        companyName: company.companyName,
        companyEmail: company.companyEmail,
        contactName: company.contactName,
        submissionId: company.submissionId,
        url: signed.url,
        expiresAt: signed.payload.exp || "",
        expectedCount: expectedIds.length,
        receivedCount: expectedIds.length - missingIds.length,
        missingDocuments,
      });
    }

    if (!reminders.length) {
      return res.json({
        ok: true,
        count: 0,
        skipped,
        message: "Aucune entreprise incomplete a relancer.",
      });
    }

    const payload = {
      type: "reminder",
      projectId: project.id,
      projectName: project.name,
      dossierId: project.dossierId,
      deadline: project.deadline || "",
      portalUrl: resolvePortalEntryUrl(req),
      reminders,
    };

    const result = await callFlow(
      "SEND_REMINDERS",
      flowConfig.sendRemindersUrl,
      payload
    );

    audit(req, "admin.invitations.remind", {
      projectId: project.id,
      count: reminders.length,
      skipped: skipped.length,
      companyIds: reminders.map((item) => item.companyId),
    });

    res.json({ ok: true, count: reminders.length, skipped, result });
  })
);

app.post(
  ["/api/admin/invitations/revoke", "/api/invitations/revoke"],
  requireLocalAdmin,
  wrap((req, res) => {
    const signing = getSigningConfig(process.env);
    if (!signing.secret) {
      throw serviceUnavailable(
        "Signature secret missing on server. Configure PORTAL_LINK_SECRET to revoke links."
      );
    }

    const ctx = normalizeTextField(req.body?.ctx, "ctx", { required: true, max: 4000 });
    const sig = normalizeTextField(req.body?.sig, "sig", { required: true, max: 512 });
    const alg = normalizeTextField(req.body?.alg || "HS256", "alg", { max: 20 }) || "HS256";
    const reason = normalizeTextField(req.body?.reason, "reason", { max: 500 });

    const verification = verifySignedContext({
      ctx,
      sig,
      alg,
      secret: signing.secret,
    });
    // N-03: accept revocation of a signature whose ONLY problem is that it
    // has already expired. The signature is still cryptographically valid,
    // so adding it to the deny-list is safe and lets an operator proactively
    // blacklist a leaked-but-just-expired link.
    const expiredButOtherwiseValid = !verification.ok && verification.code === "expired";
    if (!verification.ok && !expiredButOtherwiseValid) {
      throw badRequest(`Cannot revoke: invalid signed invitation (${verification.code}).`);
    }

    const id = hashSignedContextId(ctx);
    revokeInvitation({
      id,
      reason,
      payload: {
        companyId: verification.payload?.companyId || "",
        companyName: verification.payload?.companyName || "",
        submissionId: verification.payload?.submissionId || "",
        dossierId: verification.payload?.dossierId || "",
        exp: verification.payload?.exp || "",
        iat: verification.payload?.iat || "",
        nonce: verification.payload?.nonce || "",
      },
    });

    audit(req, "admin.invitation.revoke", {
      id,
      reason,
      expiredAtRevoke: expiredButOtherwiseValid || false,
      companyId: verification.payload?.companyId || "",
      companyName: verification.payload?.companyName || "",
      submissionId: verification.payload?.submissionId || "",
      dossierId: verification.payload?.dossierId || "",
    });

    res.json({
      ok: true,
      revoked: true,
      id,
      expired: expiredButOtherwiseValid || false,
    });
  })
);

app.get(
  ["/api/admin/invitations/revoked", "/api/invitations/revoked"],
  requireLocalAdmin,
  wrap((req, res) => {
    const limit = parsePositiveInt(req.query?.limit, 50);
    res.json({ items: listRevokedInvitations(limit) });
  })
);

// N-08 / N-09: on-demand maintenance for operators who want to trigger a
// cleanup between scheduled runs.
app.post(
  ["/api/admin/maintenance/cleanup", "/api/maintenance/cleanup"],
  requireLocalAdmin,
  wrap((req, res) => {
    const prune = pruneRevokedInvitations();
    const scrub = scrubOldAuditPayloads();
    audit(req, "admin.maintenance.cleanup", {
      prunedRevoked: prune.removed,
      scrubbedAudit: scrub.scrubbed,
    });
    res.json({ ok: true, prune, scrub });
  })
);

app.get(
  ["/api/admin/projects", "/api/projects"],
  requireLocalAdmin,
  wrap((req, res) => {
    const includeArchived =
      String(req.query?.includeArchived || "").toLowerCase() === "1" ||
      String(req.query?.includeArchived || "").toLowerCase() === "true";
    res.json(getAllProjects({ includeArchived }));
  })
);

app.post(
  [
    "/api/admin/projects/:id/archive",
    "/api/projects/:id/archive",
  ],
  requireLocalAdmin,
  wrap((req, res) => {
    const project = setProjectArchived(req.params.id, true);
    if (!project) return res.status(404).json({ error: "Project not found" });
    audit(req, "admin.project.archive", {
      projectId: project.id,
      name: project.name,
    });
    res.json(project);
  })
);

app.post(
  [
    "/api/admin/projects/:id/unarchive",
    "/api/projects/:id/unarchive",
  ],
  requireLocalAdmin,
  wrap((req, res) => {
    const project = setProjectArchived(req.params.id, false);
    if (!project) return res.status(404).json({ error: "Project not found" });
    audit(req, "admin.project.unarchive", {
      projectId: project.id,
      name: project.name,
    });
    res.json(project);
  })
);

app.get(
  ["/api/admin/overview", "/api/overview"],
  requireLocalAdmin,
  wrap(async (_req, res) => {
    const projects = getAllProjects();
    const flowConfig = getFlowConfig(process.env);

    if (!flowConfig.getDocumentsUrl) {
      return res.json({
        synced: false,
        generatedAt: new Date().toISOString(),
        projects: projects.map((project) => ({
          ...buildProjectOverviewBase(project),
          receivedCount: 0,
          completionRate: 0,
          statusKey: "unknown",
          completeCompanies: 0,
          incompleteCompanies: 0,
          lastReceptionAt: "",
          syncError: "GET_DOCUMENTS flow not configured.",
        })),
      });
    }

    const overviews = await Promise.all(
      projects.map(async (project) => {
        if (!project.dossierId) {
          return {
            ...buildProjectOverviewBase(project),
            receivedCount: 0,
            completionRate: 0,
            statusKey: "unknown",
            completeCompanies: 0,
            incompleteCompanies: 0,
            lastReceptionAt: "",
            syncError: "Aucun dossierId configure pour ce projet.",
          };
        }
        try {
          const rows = await callFlow("GET_DOCUMENTS", flowConfig.getDocumentsUrl, {
            dossierId: project.dossierId,
            companyId: "",
            companyName: "",
            submissionId: "",
          });
          return buildProjectOverview(project, Array.isArray(rows) ? rows : []);
        } catch (error) {
          return {
            ...buildProjectOverviewBase(project),
            receivedCount: 0,
            completionRate: 0,
            statusKey: "unknown",
            completeCompanies: 0,
            incompleteCompanies: 0,
            lastReceptionAt: "",
            syncError: error?.message || String(error),
          };
        }
      })
    );

    res.json({
      synced: true,
      generatedAt: new Date().toISOString(),
      projects: overviews,
    });
  })
);

app.get(
  ["/api/admin/projects/:id", "/api/projects/:id"],
  requireLocalAdmin,
  wrap((req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json(project);
  })
);

app.put(
  ["/api/admin/projects/:id", "/api/projects/:id"],
  requireLocalAdmin,
  wrap((req, res) => {
    const project = upsertProject({
      id: req.params.id,
      ...sanitizeProjectPayload(req.body),
    });
    audit(req, "admin.project.upsert", { projectId: project.id, name: project.name });
    res.json(project);
  })
);

app.delete(
  ["/api/admin/projects/:id", "/api/projects/:id"],
  requireLocalAdmin,
  wrap((req, res) => {
    removeProject(req.params.id);
    audit(req, "admin.project.delete", { projectId: req.params.id });
    res.json({ ok: true });
  })
);

app.put(
  [
    "/api/admin/projects/:projectId/companies/:companyId",
    "/api/projects/:projectId/companies/:companyId",
  ],
  requireLocalAdmin,
  wrap((req, res) => {
    if (!getProject(req.params.projectId)) {
      return res.status(404).json({ error: "Project not found" });
    }

    const company = upsertCompany({
      id: req.params.companyId,
      projectId: req.params.projectId,
      ...sanitizeCompanyPayload(req.body),
    });
    audit(req, "admin.company.upsert", {
      projectId: req.params.projectId,
      companyId: company.id,
      companyName: company.companyName,
      submissionId: company.submissionId,
    });
    res.json(company);
  })
);

app.delete(
  ["/api/admin/companies/:id", "/api/companies/:id"],
  requireLocalAdmin,
  wrap((req, res) => {
    removeCompany(req.params.id);
    audit(req, "admin.company.delete", { companyId: req.params.id });
    res.json({ ok: true });
  })
);

app.post(
  "/api/admin/documents",
  requireLocalAdmin,
  wrap(async (req, res) => {
    const flowConfig = getFlowConfig(process.env);
    ensureFlowUrl(flowConfig.getDocumentsUrl, "GET_DOCUMENTS");

    const payload = {
      dossierId: normalizeTextField(req.body?.dossierId, "dossierId", {
        required: true,
        max: 180,
      }),
      companyId: normalizeTextField(req.body?.companyId, "companyId", { max: 120 }),
      companyName: normalizeTextField(req.body?.companyName, "companyName", {
        max: 180,
      }),
      submissionId: normalizeTextField(req.body?.submissionId, "submissionId", {
        max: 180,
      }),
    };

    const rows = await callFlow("GET_DOCUMENTS", flowConfig.getDocumentsUrl, payload);
    res.json(Array.isArray(rows) ? rows : []);
  })
);

app.post(
  "/api/portal/verify",
  wrap((req, res) => {
    const invitation = getVerifiedInvitationFromBody(req.body);
    res.json({
      ok: true,
      invitation,
      limits: {
        maxFileMb,
      },
    });
  })
);

app.post(
  "/api/portal/documents",
  wrap(async (req, res) => {
    const flowConfig = getFlowConfig(process.env);
    ensureFlowUrl(flowConfig.getDocumentsUrl, "GET_DOCUMENTS");

    const invitation = getVerifiedInvitationFromBody(req.body);
    checkSubmissionDailyBudget(invitation, { cost: 1 });
    const rows = await callFlow("GET_DOCUMENTS", flowConfig.getDocumentsUrl, {
      dossierId: invitation.dossierId,
      companyId: invitation.companyId,
      companyName: invitation.companyName,
      submissionId: invitation.submissionId,
    });
    commitSubmissionDailyBudget(invitation, { cost: 1 });

    res.json(Array.isArray(rows) ? rows : []);
  })
);

app.post(
  "/api/portal/upload",
  wrap(async (req, res) => {
    const flowConfig = getFlowConfig(process.env);
    ensureFlowUrl(flowConfig.uploadUrl, "UPLOAD_FILE");

    const invitation = getVerifiedInvitationFromBody(req.body);
    checkSubmissionDailyBudget(invitation, { cost: 2 });
    const document = resolveInvitationDocument(invitation, req.body?.documentId);
    const fileName = prefixFileNameWithCompany(
      normalizeFileName(req.body?.fileName),
      invitation.companyName
    );
    const fileContent = normalizeTextField(req.body?.fileContent, "fileContent", {
      required: true,
      max: maxFileContentChars,
    });
    const metadata = buildMetadata(invitation, document);

    const result = await callFlow("UPLOAD_FILE", flowConfig.uploadUrl, {
      fileName,
      fileContent,
      folderPath: invitation.folderPath,
      ...metadata,
      metadata,
    });
    commitSubmissionDailyBudget(invitation, { cost: 2 });

    res.json(result);
  })
);

app.post(
  "/api/portal/update",
  wrap(async (req, res) => {
    const flowConfig = getFlowConfig(process.env);
    ensureFlowUrl(flowConfig.updateUrl, "UPDATE_FILE");

    const invitation = getVerifiedInvitationFromBody(req.body);
    checkSubmissionDailyBudget(invitation, { cost: 2 });
    const document = resolveInvitationDocument(invitation, req.body?.documentId);
    const fileIdentifier = normalizeTextField(req.body?.fileIdentifier, "fileIdentifier", {
      required: true,
      max: 1000,
    });
    const filePath = await verifyFileReferenceAndDocumentType({
      flowConfig,
      invitation,
      filePath: req.body?.filePath,
      fileIdentifier,
      documentId: document.id,
      requirePath: true,
    });
    const fileName = prefixFileNameWithCompany(
      normalizeFileName(req.body?.fileName),
      invitation.companyName
    );
    const fileContent = normalizeTextField(req.body?.fileContent, "fileContent", {
      required: true,
      max: maxFileContentChars,
    });
    const metadata = buildMetadata(invitation, document);

    const result = await callFlow("UPDATE_FILE", flowConfig.updateUrl, {
      fileIdentifier,
      filePath,
      fileName,
      fileContent,
      ...metadata,
      metadata,
    });
    commitSubmissionDailyBudget(invitation, { cost: 2 });

    res.json(result);
  })
);

app.post(
  "/api/portal/delete",
  wrap(async (req, res) => {
    const flowConfig = getFlowConfig(process.env);
    ensureFlowUrl(flowConfig.deleteUrl, "DELETE_FILE");

    const invitation = getVerifiedInvitationFromBody(req.body);
    checkSubmissionDailyBudget(invitation, { cost: 1 });
    const document = resolveInvitationDocument(invitation, req.body?.documentId);
    const fileIdentifier = normalizeTextField(req.body?.fileIdentifier, "fileIdentifier", {
      required: true,
      max: 1000,
    });
    await verifyFileReferenceAndDocumentType({
      flowConfig,
      invitation,
      filePath: req.body?.filePath,
      fileIdentifier,
      documentId: document.id,
      requirePath: false,
    });

    const metadata = buildMetadata(invitation, document);
    const result = await callFlow("DELETE_FILE", flowConfig.deleteUrl, {
      fileIdentifier,
      ...metadata,
      metadata,
    });
    commitSubmissionDailyBudget(invitation, { cost: 1 });

    res.json(result);
  })
);

app.post(
  "/api/portal/download",
  wrap(async (req, res) => {
    const flowConfig = getFlowConfig(process.env);
    ensureFlowUrl(flowConfig.downloadUrl, "DOWNLOAD_FILE");

    const invitation = getVerifiedInvitationFromBody(req.body);
    checkSubmissionDailyBudget(invitation, { cost: 1 });
    const filePath = await ensureFileReferenceAllowed({
      flowConfig,
      invitation,
      filePath: req.body?.filePath,
      fileIdentifier: req.body?.fileIdentifier,
      requirePath: true,
    });
    const result = await callDownloadFlow(flowConfig.downloadUrl, {
      filePath,
    });
    commitSubmissionDailyBudget(invitation, { cost: 1 });

    res.json(result);
  })
);

if (staticBundle) {
  for (const assetsDir of staticBundle.assetsDirs) {
    if (!existsSync(assetsDir)) continue;
    app.use(
      "/assets",
      express.static(assetsDir, {
        index: false,
        maxAge: "365d",
        immutable: true,
      })
    );
  }

  app.get(["/admin", "/admin/", "/admin.html"], requireLocalAdmin, (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.sendFile(staticBundle.adminHtmlPath);
  });

  app.get(["/", "/depot", "/depot/", "/index.html"], requireSignedDepotLink, (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.sendFile(staticBundle.portalHtmlPath);
  });
} else {
  app.get(["/admin", "/admin/", "/admin.html"], requireLocalAdmin, (_req, res) => {
    res.status(503).json({
      error: "Frontend build missing. Run `npm run build:all` before production start.",
    });
  });

  app.get(["/", "/depot", "/depot/", "/index.html"], (_req, res) => {
    res.status(503).json({
      error: "Portal build missing. Run `npm run build:all` before production start.",
    });
  });
}

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// N-08 / N-09: scheduled maintenance. Runs once at startup (after a small
// delay so it doesn't compete with cold-start traffic) and then every 24h.
// A single-instance deployment is assumed; for multi-instance, move this
// to an external cron and call /api/admin/maintenance/cleanup.
const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;
function runScheduledCleanup() {
  try {
    const prune = pruneRevokedInvitations();
    const scrub = scrubOldAuditPayloads();
    if (prune.removed || scrub.scrubbed) {
      console.log(
        `[maintenance] pruned ${prune.removed} revoked invitations, scrubbed ${scrub.scrubbed} audit payloads (cutoff ${prune.cutoff})`
      );
    }
  } catch (error) {
    console.warn("[maintenance] cleanup failed:", error?.message || error);
  }
}
const maintenanceStartTimer = setTimeout(runScheduledCleanup, 30 * 1000);
maintenanceStartTimer.unref();
const maintenanceInterval = setInterval(runScheduledCleanup, MAINTENANCE_INTERVAL_MS);
maintenanceInterval.unref();

function shutdown(signal) {
  console.log(`${signal} received, shutting down.`);
  clearTimeout(maintenanceStartTimer);
  clearInterval(maintenanceInterval);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
