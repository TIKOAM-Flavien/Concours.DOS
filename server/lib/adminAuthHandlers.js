import {
  buildAdminSessionClearCookie,
  buildAdminSessionCookie,
  createAdminSessionToken,
  getAdminAuthConfig,
  readAdminSession,
  verifyAdminPassword,
  verifyAdminUsername,
} from "../adminAuth.js";
import { ipv4ToInt } from "./requestHelpers.js";

export function createAdminAuthHandlers({
  env,
  adminAllowedIps,
  adminAllowedCidrs,
  getActorIp,
  audit,
  normalizeTextField,
}) {
  function isLoopbackActorIp(ip) {
    return ip === "127.0.0.1" || ip === "::1";
  }

  function isAdminClientAllowed(req) {
    const ip = getActorIp(req);
    if (isLoopbackActorIp(ip)) return true;
    if (adminAllowedIps.size > 0 && adminAllowedIps.has(ip)) return true;
    if (adminAllowedCidrs.length > 0) {
      const numeric = ipv4ToInt(ip);
      if (numeric !== null) {
        for (const { network, mask } of adminAllowedCidrs) {
          if (((numeric & mask) >>> 0) === network) return true;
        }
      }
    }
    return false;
  }

  function requireLocalAdmin(req, res, next) {
    if (isAdminClientAllowed(req)) return next();
    const hasAllowList = adminAllowedIps.size > 0 || adminAllowedCidrs.length > 0;
    const hint = hasAllowList
      ? " If you use a reverse proxy, set TRUST_PROXY correctly so the client IP is visible, or add your IP/CIDR to PORTAL_ADMIN_ALLOWED_IPS."
      : " Use SSH port forwarding to localhost, open /admin from the server itself, or set PORTAL_ADMIN_ALLOWED_IPS (comma-separated, IPs or CIDR ranges; pair with TRUST_PROXY when behind a proxy).";
    return res.status(403).json({
      error: `Admin access is restricted to localhost.${hint}`,
    });
  }

  function getAdminAuthMode() {
    return getAdminAuthConfig(env).passwordConfigured ? "password" : "network";
  }

  function isAdminAuthenticated(req) {
    const config = getAdminAuthConfig(env);
    if (config.passwordConfigured) {
      return Boolean(readAdminSession(req, env));
    }
    return isAdminClientAllowed(req);
  }

  function requireAdminAuth(req, res, next) {
    if (isAdminAuthenticated(req)) return next();
    const config = getAdminAuthConfig(env);
    if (config.passwordConfigured) {
      return res.status(401).json({ error: "Authentication required." });
    }
    return requireLocalAdmin(req, res, next);
  }

  function requireAdminPageAccess(req, res, next) {
    const config = getAdminAuthConfig(env);
    if (config.passwordConfigured) return next();
    return requireLocalAdmin(req, res, next);
  }

  function buildAdminAuthSessionResponse(req) {
    const config = getAdminAuthConfig(env);
    const authMode = getAdminAuthMode();
    const session = readAdminSession(req, env);
    const authenticated = isAdminAuthenticated(req);
    return {
      authenticated,
      authMode,
      username: authenticated ? session?.username || config.username : null,
    };
  }

  function loginAdmin(req, res) {
    const config = getAdminAuthConfig(env);
    if (!config.passwordConfigured) {
      return res.status(503).json({
        error: "Admin password login is not configured on this server.",
      });
    }

    const username = normalizeTextField(req.body?.username);
    const password = String(req.body?.password ?? "");
    if (!verifyAdminUsername(username, config)) {
      return res.status(401).json({ error: "Identifiants invalides." });
    }
    if (!verifyAdminPassword(password, config)) {
      return res.status(401).json({ error: "Identifiants invalides." });
    }

    const token = createAdminSessionToken(config);
    const secureCookie = Boolean(req.secure || req.get("x-forwarded-proto") === "https");
    res.setHeader("Set-Cookie", buildAdminSessionCookie(token, config, { secure: secureCookie }));
    audit(req, "admin.login", { username: config.username }).catch(() => {});
    return res.json({
      authenticated: true,
      authMode: "password",
      username: config.username,
    });
  }

  function logoutAdmin(req, res) {
    const config = getAdminAuthConfig(env);
    const secureCookie = Boolean(req.secure || req.get("x-forwarded-proto") === "https");
    res.setHeader("Set-Cookie", buildAdminSessionClearCookie(config, { secure: secureCookie }));
    audit(req, "admin.logout", {}).catch(() => {});
    return res.json({ ok: true });
  }

  return {
    isAdminClientAllowed,
    requireLocalAdmin,
    requireAdminAuth,
    requireAdminPageAccess,
    buildAdminAuthSessionResponse,
    loginAdmin,
    logoutAdmin,
    getAdminAuthMode,
    isAdminAuthenticated,
  };
}
