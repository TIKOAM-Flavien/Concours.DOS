// @ts-check
// Tiny coercion helpers used across the server. They previously lived as
// private copies inside adminAuth.js / documentFiles.js / flows.js / security.js
// — this module is the single source of truth.

/** @param {unknown} value */
export function cleanString(value) {
  return String(value ?? "").trim();
}

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function parsePositiveInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  return parsed;
}

// Reject 0 too — for counters where 0 would mean "disabled" by accident
// (session TTL hours, retention days, max attempts, ...).
/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function parseStrictPositiveInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
}
