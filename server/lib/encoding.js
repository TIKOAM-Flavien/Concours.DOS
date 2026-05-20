// @ts-check
import crypto from "node:crypto";

// Shared base64url + constant-time helpers. Centralized so callers don't
// reimplement the (subtle) padding logic and so a security fix only needs
// to be made in one place.

/** @param {Buffer | Uint8Array | string} buffer */
export function toBase64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/** @param {string} value */
export function fromBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(`${normalized}${padding}`, "base64");
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
export function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
