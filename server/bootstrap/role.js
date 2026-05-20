const VALID_ROLES = new Set(["all", "admin", "portal"]);

export function getAppRole(env = process.env) {
  const raw = String(env.PORTAL_APP_ROLE || "all").trim().toLowerCase();
  if (!VALID_ROLES.has(raw)) {
    console.warn(`[bootstrap] unknown PORTAL_APP_ROLE="${raw}", falling back to "all"`);
    return "all";
  }
  return raw;
}

export function roleIncludesAdmin(role) {
  return role === "all" || role === "admin";
}

export function roleIncludesPortal(role) {
  return role === "all" || role === "portal";
}

export function roleIsMonolith(role) {
  return role === "all";
}
