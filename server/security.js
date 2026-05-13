import crypto from "node:crypto";
import { normalizeSharePointFolderPath as sharedNormalizeSharePointFolderPath } from "../shared/sharepointPath.js";
import { normalizeDocumentId } from "../src/config/documentCatalog.js";

const DEFAULT_INVITATION_TTL_MINUTES = 43200; // 30 days

function toBase64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (!value || typeof value !== "object") return value;

  const out = {};
  Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .forEach((key) => {
      out[key] = sortKeysDeep(value[key]);
    });
  return out;
}

function hmacSha256Base64Url(message, secret) {
  return crypto.createHmac("sha256", secret).update(message).digest("base64url");
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function cleanString(value) {
  return String(value || "").trim();
}

// B-05: re-export the shared implementation so there is exactly one
// canonical normalizer across the codebase. The frontend imports the same
// module directly from `shared/sharepointPath.js`.
export const normalizeSharePointFolderPath = sharedNormalizeSharePointFolderPath;

function normalizeDocumentEntry(entry) {
  if (entry && typeof entry === "object") {
    const id = normalizeDocumentId(entry.id || entry.value || entry.code || "");
    if (!id) return null;

    const out = { id };
    if (entry.label != null) out.label = cleanString(entry.label);
    if (entry.category != null) out.category = cleanString(entry.category);
    if (entry.summary != null) out.summary = cleanString(entry.summary);
    if (entry.accent != null) out.accent = cleanString(entry.accent);
    if (entry.acceptedFormats != null) out.acceptedFormats = entry.acceptedFormats;
    return out;
  }

  const id = normalizeDocumentId(entry);
  if (!id) return null;
  return id;
}

function normalizeDocumentList(documents) {
  if (!Array.isArray(documents)) return [];

  const seen = new Set();
  const out = [];

  for (const raw of documents) {
    const normalized = normalizeDocumentEntry(raw);
    if (!normalized) continue;
    const id = typeof normalized === "string" ? normalized : normalized.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(normalized);
  }

  return out;
}

export function parsePositiveInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function encodeBase64Url(value) {
  return toBase64Url(Buffer.from(String(value || ""), "utf8"));
}

export function decodeBase64Url(value) {
  return fromBase64Url(value).toString("utf8");
}

export function canonicalJson(value) {
  return JSON.stringify(sortKeysDeep(value));
}

export function sanitizeInvitationContext(rawContext = {}) {
  return {
    projectId: cleanString(rawContext.projectId),
    companyId: cleanString(rawContext.companyId),
    companyName: cleanString(rawContext.companyName),
    companyEmail: cleanString(rawContext.companyEmail),
    contactName: cleanString(rawContext.contactName),
    submissionId: cleanString(rawContext.submissionId),
    contestName: cleanString(rawContext.contestName),
    dossierId: cleanString(rawContext.dossierId),
    folderPath: normalizeSharePointFolderPath(rawContext.folderPath),
    supportEmail: cleanString(rawContext.supportEmail),
    supportPhone: cleanString(rawContext.supportPhone),
    websiteUrl: cleanString(rawContext.websiteUrl),
    deadline: cleanString(rawContext.deadline),
    documents: normalizeDocumentList(rawContext.documents),
  };
}

export function getSigningConfig(env = process.env) {
  const resolveTtlMinutes = () => {
    const candidates = [
      "PORTAL_LINK_TTL_MINUTES",
      "CLIENT_PORTAL_LINK_TTL_MINUTES",
      "VITE_CLIENT_PORTAL_LINK_TTL_MINUTES",
    ];

    for (const key of candidates) {
      if (Object.prototype.hasOwnProperty.call(env, key)) {
        const raw = String(env[key] ?? "").trim();
        if (raw === "") continue;
        return parsePositiveInt(raw, DEFAULT_INVITATION_TTL_MINUTES);
      }
    }

    return DEFAULT_INVITATION_TTL_MINUTES;
  };

  return {
    secret: cleanString(
      env.PORTAL_LINK_SECRET || env.CLIENT_PORTAL_LINK_SECRET
    ),
    ttlMinutes: resolveTtlMinutes(),
    publicPortalUrl: cleanString(
      env.CLIENT_PORTAL_PUBLIC_URL ||
        env.PORTAL_PUBLIC_URL ||
        env.VITE_CLIENT_PORTAL_PUBLIC_URL ||
        env.VITE_CLIENT_PORTAL_URL
    ),
  };
}

export function getInvitationPayloadIssues(payload = {}) {
  const context = sanitizeInvitationContext(payload);
  const issues = [];

  if (!context.companyId) issues.push("companyId");
  if (!context.companyName) issues.push("companyName");
  if (!context.submissionId) issues.push("submissionId");
  if (!context.dossierId) issues.push("dossierId");
  if (!context.folderPath) issues.push("folderPath");
  if (!context.documents.length) issues.push("documents");

  return issues;
}

// Second time gate, independent from the cryptographic `exp` baked into the
// signature. `deadline` is the project's submission cut-off carried inside the
// signed payload (so an attacker cannot tamper with it). When `now > deadline`,
// the invitation is considered closed even if `exp` is still in the future.
// Returns false when no deadline is present or it cannot be parsed; the
// signature `exp` then remains the only time check.
export function isInvitationDeadlinePast(payload = {}, now = new Date()) {
  const raw = payload?.deadline;
  if (!raw) return false;

  const deadlineDate = new Date(String(raw));
  if (Number.isNaN(deadlineDate.getTime())) return false;

  const reference = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(reference.getTime())) return false;

  return reference.getTime() > deadlineDate.getTime();
}

export function buildSignedContext({ context, secret, ttlMinutes = 0, now = new Date() }) {
  if (!secret) throw new Error("Missing signature secret.");

  const payload = {
    ...sanitizeInvitationContext(context),
    nonce: crypto.randomBytes(18).toString("base64url"),
    iat: now.toISOString(),
  };

  if (ttlMinutes > 0) {
    payload.exp = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();
  }

  const ctx = encodeBase64Url(canonicalJson(payload));
  const sig = hmacSha256Base64Url(ctx, secret);

  return { ctx, sig, payload };
}

export function buildSignedInvitationUrl({
  context,
  secret,
  baseUrl,
  ttlMinutes = 0,
  now = new Date(),
}) {
  const { ctx, sig, payload } = buildSignedContext({
    context,
    secret,
    ttlMinutes,
    now,
  });

  const url = new URL(baseUrl);
  url.searchParams.set("ctx", ctx);
  url.searchParams.set("sig", sig);
  url.searchParams.set("alg", "HS256");

  return {
    url: url.toString(),
    ctx,
    sig,
    payload,
  };
}

function parsePayload(ctx) {
  try {
    const decoded = decodeBase64Url(ctx);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export function verifySignedContext({
  ctx,
  sig,
  alg = "HS256",
  secret,
  now = new Date(),
}) {
  if (!ctx) return { ok: false, code: "missing_ctx" };
  if (!sig) return { ok: false, code: "missing_sig" };
  if (!secret) return { ok: false, code: "missing_secret" };
  const normalizedAlg = String(alg || "").trim().toUpperCase();
  if (normalizedAlg && normalizedAlg !== "HS256") {
    return { ok: false, code: "invalid_alg" };
  }

  const expected = hmacSha256Base64Url(String(ctx), secret);
  if (!timingSafeEqual(expected, sig)) return { ok: false, code: "invalid_sig" };

  const payload = parsePayload(ctx);
  if (!payload || typeof payload !== "object") {
    return { ok: false, code: "invalid_ctx" };
  }

  if (payload.exp) {
    const expDate = new Date(payload.exp);
    if (Number.isNaN(expDate.getTime())) {
      return { ok: false, code: "invalid_exp" };
    }
    if (now.getTime() > expDate.getTime()) {
      return { ok: false, code: "expired", payload };
    }
  }

  return { ok: true, code: "ok", payload };
}

export function hashSignedContextId(ctx) {
  return crypto.createHash("sha256").update(String(ctx || ""), "utf8").digest("hex");
}
