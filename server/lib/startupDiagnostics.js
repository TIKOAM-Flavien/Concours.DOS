import { roleIncludesAdmin, roleIncludesPortal } from "../bootstrap/role.js";
import { getFlowStatus } from "../flows.js";
import {
  getAdminAuthConfig,
  isWeakAdminPassword,
} from "../adminAuth.js";
import { getSigningConfig } from "../security.js";

const SENSITIVE_PUBLIC_ENV_KEYS = [
  "VITE_CLIENT_PORTAL_LINK_SECRET",
  "VITE_POWER_AUTOMATE_SEND_INVITATIONS_URL",
  "VITE_POWER_AUTOMATE_SEND_REMINDERS_URL",
];

function isWeakSigningSecret(secret) {
  const value = String(secret || "").trim();
  if (!value) return true;
  if (Buffer.byteLength(value, "utf8") < 32) return true;
  return /replace|change|secret|example|password|changeme/i.test(value);
}

export function getStartupDiagnostics(bundle, { env = process.env, role = "all" } = {}) {
  const signing = getSigningConfig(env);
  const flows = getFlowStatus(env);
  const isProduction = env.NODE_ENV === "production";
  const errors = [];
  const warnings = [];

  if (roleIncludesAdmin(role) && !bundle?.adminHtmlPath) {
    errors.push(
      "Admin frontend build missing. Run `npm run build:admin` (or `build:all`) before starting the admin server."
    );
  }
  if (roleIncludesPortal(role) && !bundle?.portalHtmlPath) {
    errors.push(
      "Portal frontend build missing. Run `npm run build:portal` (or `build:all`) before starting the portal server."
    );
  }

  if (!String(env.DATABASE_URL || "").trim()) {
    errors.push("DATABASE_URL is missing. PostgreSQL is required at runtime.");
  }

  if (!signing.secret) {
    errors.push("PORTAL_LINK_SECRET is missing. Signed invitations cannot be verified.");
  } else if (isWeakSigningSecret(signing.secret)) {
    errors.push(
      "PORTAL_LINK_SECRET must be a strong non-placeholder secret of at least 32 bytes."
    );
  }

  if (roleIncludesAdmin(role)) {
    if (!flows.sendInvitationsEnabled) {
      warnings.push("POWER_AUTOMATE_SEND_INVITATIONS_URL is missing. Bulk invitation send will fail.");
    }
    if (!flows.sendRemindersEnabled) {
      warnings.push("POWER_AUTOMATE_SEND_REMINDERS_URL is missing. Reminder send will fail.");
    }
    const adminAuth = getAdminAuthConfig(env);
    if (isProduction && !adminAuth.passwordConfigured) {
      errors.push(
        "PORTAL_ADMIN_PASSWORD is missing. Admin login is required in production."
      );
    } else if (adminAuth.passwordConfigured && isWeakAdminPassword(adminAuth.password)) {
      errors.push(
        "PORTAL_ADMIN_PASSWORD must be at least 12 characters and not a placeholder value."
      );
    } else if (adminAuth.passwordConfigured && !adminAuth.sessionSecret) {
      errors.push(
        "PORTAL_LINK_SECRET (or PORTAL_ADMIN_SESSION_SECRET) is required to sign admin sessions."
      );
    }
  }

  const detectedPublicKeys = SENSITIVE_PUBLIC_ENV_KEYS.filter((key) => Boolean(env[key]));
  if (detectedPublicKeys.length) {
    errors.push(
      `Sensitive public env keys detected (${detectedPublicKeys.join(", ")}). Use server-only environment variable names.`
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
    buildReady: roleIncludesAdmin(role)
      ? Boolean(bundle?.adminHtmlPath)
      : roleIncludesPortal(role)
      ? Boolean(bundle?.portalHtmlPath)
      : Boolean(bundle?.adminHtmlPath && bundle?.portalHtmlPath),
    flows,
    role,
  };
}
