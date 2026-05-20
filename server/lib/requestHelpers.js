import { createHash } from "node:crypto";

import { normalizeDocumentId } from "../../src/config/documentCatalog.js";
import { writeAuditLog } from "../db.js";
import {
  getSigningConfig,
  normalizeFolderPath,
} from "../security.js";

export function normalizeIp(rawIp) {
  const value = String(rawIp || "").trim().toLowerCase();
  if (value.startsWith("::ffff:")) return value.slice(7);
  return value;
}

export function ipv4ToInt(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out = out * 256 + n;
  }
  return out >>> 0;
}

export function parseAdminAllowedEntries(env) {
  const raw = String(env.PORTAL_ADMIN_ALLOWED_IPS || "").trim();
  if (!raw) return { ips: new Set(), cidrs: [] };

  const ips = new Set();
  const cidrs = [];

  for (const part of raw.split(",")) {
    const entry = part.trim();
    if (!entry) continue;

    if (entry.includes("/")) {
      const [addr, prefixRaw] = entry.split("/");
      const base = ipv4ToInt(normalizeIp(addr));
      const prefix = Number(prefixRaw);
      if (base === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
        console.warn(`[admin-allow] ignoring invalid CIDR entry: ${entry}`);
        continue;
      }
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      cidrs.push({ network: (base & mask) >>> 0, mask });
      continue;
    }

    ips.add(normalizeIp(entry));
  }

  return { ips, cidrs };
}

export function createRequestHelpers({ env, isProduction, port }) {
  function wrap(fn) {
    return (req, res, next) => {
      Promise.resolve(fn(req, res, next)).catch((err) => {
        const status = err.statusCode || 500;
        // pino-http attaches req.log per-request; fall back to console for
        // contexts where the middleware did not run (tests, healthchecks).
        const logger = req?.log || console;
        if (status >= 500) {
          logger.error({ err, status }, "request failed");
        } else {
          logger.warn({ err, status }, "request rejected");
        }
        const message =
          status >= 500 && isProduction
            ? "Internal server error"
            : err.message;
        res.status(status).json({ error: message });
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

  function getActorIp(req) {
    return normalizeIp(req.ip || req.socket?.remoteAddress || "");
  }

  function hashActorIp(rawIp) {
    const ip = normalizeIp(rawIp);
    if (!ip) return "";
    // Prefer a dedicated pepper so rotating the invitation-signing secret
    // does not invalidate (or correlate to) historical IP hashes. Falls back
    // to PORTAL_LINK_SECRET for backwards compatibility with existing logs.
    const salt = String(
      env.PORTAL_IP_HASH_PEPPER || env.PORTAL_LINK_SECRET || env.PORTAL_ADMIN_PASSWORD || ""
    );
    return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
  }

  async function audit(req, action, payload) {
    try {
      await writeAuditLog({ actorIp: getActorIp(req), action, payload });
    } catch (error) {
      console.warn("[audit] failed:", error?.message || error);
    }
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

    const { publicPortalUrl } = getSigningConfig(env);
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

    return Array.from(
      new Set(
        rawDocumentIds
          .map((value) => normalizeDocumentId(value))
          .filter(Boolean)
      )
    );
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
      folderPath: normalizeFolderPath(
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

  function resolvePortalEntryUrl(req) {
    const { publicPortalUrl } = getSigningConfig(env);
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
    const host = req.get("host") || `localhost:${port}`;
    return new URL("/depot", `${protocol}://${host}`).toString();
  }

  return {
    wrap,
    badRequest,
    forbidden,
    tooManyRequests,
    serviceUnavailable,
    getActorIp,
    hashActorIp,
    audit,
    requireTrustedBrowserOrigin,
    normalizeTextField,
    normalizeEmailField,
    normalizeDocumentIds,
    normalizeDeadline,
    normalizeCustomProjectDocuments,
    normalizeFileName,
    prefixFileNameWithCompany,
    ensureFlowUrl,
    sanitizeProjectPayload,
    sanitizeCompanyPayload,
    resolvePortalEntryUrl,
  };
}
