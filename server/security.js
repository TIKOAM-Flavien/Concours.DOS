import crypto from "node:crypto";
import { normalizeFolderPath as sharedNormalizeFolderPath } from "../shared/folderPath.js";
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

// Re-export the shared implementation so there is exactly one canonical
// normalizer across the codebase. The frontend imports the same module
// directly from `shared/folderPath.js`.
export const normalizeFolderPath = sharedNormalizeFolderPath;

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
    companyDbId: cleanString(rawContext.companyDbId || rawContext.companyDatabaseId),
    companyId: cleanString(rawContext.companyId),
    companyName: cleanString(rawContext.companyName),
    companyEmail: cleanString(rawContext.companyEmail),
    contactName: cleanString(rawContext.contactName),
    submissionId: cleanString(rawContext.submissionId),
    contestName: cleanString(rawContext.contestName),
    dossierId: cleanString(rawContext.dossierId),
    folderPath: normalizeFolderPath(rawContext.folderPath),
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

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isOpaqueInvitationId(value) {
  return UUID_V4_PATTERN.test(String(value || "").trim());
}

function buildInvitationPayload({ context, ttlMinutes = 0, now = new Date() }) {
  const payload = {
    ...sanitizeInvitationContext(context),
    nonce: crypto.randomBytes(18).toString("base64url"),
    iat: now.toISOString(),
  };

  if (ttlMinutes > 0) {
    payload.exp = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();
  }

  return payload;
}

function buildSignedInvitationResult({ id, payload, secret, baseUrl }) {
  const sig = hmacSha256Base64Url(id, secret);
  const url = new URL(baseUrl);
  url.searchParams.set("inv", id);
  url.searchParams.set("sig", sig);
  url.searchParams.set("alg", "HS256");

  return {
    url: url.toString(),
    inv: id,
    sig,
    payload,
    invitationId: id,
  };
}

function mergeReusableInvitationPayload(existingInvitation, nextPayload) {
  const existingPayload =
    existingInvitation?.payload && typeof existingInvitation.payload === "object"
      ? existingInvitation.payload
      : {};
  const exp = existingPayload.exp || existingInvitation?.exp || nextPayload.exp || "";

  return {
    ...nextPayload,
    nonce:
      existingPayload.nonce ||
      nextPayload.nonce ||
      crypto.randomBytes(18).toString("base64url"),
    iat: existingPayload.iat || existingInvitation?.iat || nextPayload.iat,
    ...(exp ? { exp } : {}),
  };
}

export async function persistAndSignInvitation({
  context,
  secret,
  ttlMinutes = 0,
  baseUrl,
  now = new Date(),
  insertSignedInvitation,
  findReusableSignedInvitation,
  updateSignedInvitationPayload,
}) {
  if (!secret) throw new Error("Missing signature secret.");
  if (typeof insertSignedInvitation !== "function") {
    throw new Error("insertSignedInvitation is required.");
  }

  const payload = buildInvitationPayload({ context, ttlMinutes, now });

  if (
    typeof findReusableSignedInvitation === "function" &&
    typeof updateSignedInvitationPayload === "function" &&
    payload.projectId &&
    (payload.companyDbId || payload.companyId)
  ) {
    const reusable = await findReusableSignedInvitation({
      projectId: payload.projectId,
      companyDbId: payload.companyDbId,
      companyId: payload.companyId,
      now,
    });

    if (reusable?.id) {
      const reusablePayload = mergeReusableInvitationPayload(reusable, payload);
      await updateSignedInvitationPayload({
        id: reusable.id,
        payload: reusablePayload,
        projectId: reusablePayload.projectId,
        companyId: reusablePayload.companyId,
        submissionId: reusablePayload.submissionId,
        now,
      });

      return {
        ...buildSignedInvitationResult({
          id: reusable.id,
          payload: reusablePayload,
          secret,
          baseUrl,
        }),
        reused: true,
      };
    }
  }

  const id = crypto.randomUUID();

  await insertSignedInvitation({
    id,
    payload,
    projectId: payload.projectId,
    companyId: payload.companyId,
    submissionId: payload.submissionId,
    iat: payload.iat,
    exp: payload.exp || null,
  });

  return {
    ...buildSignedInvitationResult({ id, payload, secret, baseUrl }),
    reused: false,
  };
}

export async function buildSignedInvitationUrl({
  context,
  secret,
  baseUrl,
  ttlMinutes = 0,
  now = new Date(),
  insertSignedInvitation,
  findReusableSignedInvitation,
  updateSignedInvitationPayload,
}) {
  return persistAndSignInvitation({
    context,
    secret,
    ttlMinutes,
    baseUrl,
    now,
    insertSignedInvitation,
    findReusableSignedInvitation,
    updateSignedInvitationPayload,
  });
}

export async function verifySignedInvitation({
  inv,
  sig,
  alg = "HS256",
  secret,
  now = new Date(),
  loadInvitation,
  allowExpired = false,
}) {
  if (!inv) return { ok: false, code: "missing_inv" };
  if (!sig) return { ok: false, code: "missing_sig" };
  if (!secret) return { ok: false, code: "missing_secret" };

  const normalizedAlg = String(alg || "").trim().toUpperCase();
  if (normalizedAlg && normalizedAlg !== "HS256") {
    return { ok: false, code: "invalid_alg" };
  }

  const invitationId = String(inv).trim();
  if (!isOpaqueInvitationId(invitationId)) {
    return { ok: false, code: "invalid_inv" };
  }

  const expected = hmacSha256Base64Url(invitationId, secret);
  if (!timingSafeEqual(expected, sig)) return { ok: false, code: "invalid_sig" };

  if (typeof loadInvitation !== "function") {
    throw new Error("loadInvitation is required.");
  }

  const record = await loadInvitation(invitationId);
  if (!record) return { ok: false, code: "invalid_inv" };

  const payload =
    record.payload && typeof record.payload === "object" ? record.payload : null;
  if (!payload) return { ok: false, code: "invalid_inv" };

  const expRaw = record.exp || payload.exp || null;
  if (expRaw) {
    const expDate = new Date(expRaw);
    if (Number.isNaN(expDate.getTime())) {
      return { ok: false, code: "invalid_exp" };
    }
    if (!allowExpired && now.getTime() > expDate.getTime()) {
      return { ok: false, code: "expired", payload, invitationId };
    }
  }

  return { ok: true, code: "ok", payload, invitationId };
}
