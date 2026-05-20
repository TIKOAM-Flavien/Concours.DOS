import crypto from "node:crypto";

import { cleanString, parseStrictPositiveInt as parsePositiveInt } from "./lib/coercions.js";
import { fromBase64Url, timingSafeEqual, toBase64Url } from "./lib/encoding.js";

const SESSION_COOKIE = "portal_admin_session";
const DEFAULT_SESSION_TTL_HOURS = 12;

function resolveSessionSecret(env = process.env) {
  return cleanString(env.PORTAL_ADMIN_SESSION_SECRET) || cleanString(env.PORTAL_LINK_SECRET);
}

export function getAdminAuthConfig(env = process.env) {
  const password = cleanString(env.PORTAL_ADMIN_PASSWORD);
  const username = cleanString(env.PORTAL_ADMIN_USERNAME) || "admin";
  const sessionSecret = resolveSessionSecret(env);
  const sessionTtlHours = parsePositiveInt(env.PORTAL_ADMIN_SESSION_TTL_HOURS, DEFAULT_SESSION_TTL_HOURS);

  return {
    username,
    password,
    passwordConfigured: password.length > 0,
    sessionSecret,
    sessionTtlHours,
    cookieName: SESSION_COOKIE,
  };
}

function signSessionPayload(payload, secret) {
  const body = toBase64Url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifySessionToken(token, config) {
  if (!config.passwordConfigured || !config.sessionSecret) return null;
  const raw = cleanString(token);
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;

  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto.createHmac("sha256", config.sessionSecret).update(body).digest("base64url");
  if (!timingSafeEqual(sig, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(fromBase64Url(body).toString("utf8"));
  } catch {
    return null;
  }

  const exp = Number(payload?.exp);
  const username = cleanString(payload?.u);
  if (!username || !Number.isFinite(exp) || exp <= Date.now()) return null;
  if (username !== config.username) return null;
  return { username, exp };
}

export function readAdminSession(req, env = process.env) {
  const config = getAdminAuthConfig(env);
  const token = req.cookies?.[config.cookieName] || parseCookieHeader(req.headers?.cookie, config.cookieName);
  if (!token) return null;
  return verifySessionToken(token, config);
}

function parseCookieHeader(header, name) {
  const parts = String(header || "").split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== name) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return "";
}

export function createAdminSessionToken(config, now = Date.now()) {
  const payload = {
    u: config.username,
    iat: now,
    exp: now + config.sessionTtlHours * 60 * 60 * 1000,
  };
  return signSessionPayload(payload, config.sessionSecret);
}

export function verifyAdminPassword(inputPassword, config) {
  if (!config.passwordConfigured) return false;
  return timingSafeEqual(inputPassword, config.password);
}

export function verifyAdminUsername(inputUsername, config) {
  return timingSafeEqual(inputUsername, config.username);
}

export function buildAdminSessionCookie(token, config, { secure = false } = {}) {
  const maxAgeSec = config.sessionTtlHours * 60 * 60;
  const chunks = [
    `${config.cookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) chunks.push("Secure");
  return chunks.join("; ");
}

export function buildAdminSessionClearCookie(config, { secure = false } = {}) {
  const chunks = [`${config.cookieName}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) chunks.push("Secure");
  return chunks.join("; ");
}

export function isWeakAdminPassword(password) {
  const value = cleanString(password);
  if (!value || value.length < 12) return true;
  if (/^(replace|changeme|admin123|password123|secret123)/i.test(value)) return true;
  if (/replace-with|example\.com|your-.*-here/i.test(value)) return true;
  return false;
}
