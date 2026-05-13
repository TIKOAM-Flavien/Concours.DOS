import crypto from "node:crypto";

function encodeBase64Url(value) {
  const buf = Buffer.from(String(value || ""), "utf8");
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (!value || typeof value !== "object") return value;
  const out = {};
  Object.keys(value)
    .sort((a, b) => a.localeCompare(b))
    .forEach((key) => {
      out[key] = sortKeysDeep(value[key]);
    });
  return out;
}

function canonicalJson(value) {
  return JSON.stringify(sortKeysDeep(value));
}

function randomNonce(size = 18) {
  return crypto.randomBytes(size).toString("base64url");
}

function hmacSha256Base64Url(message, secret) {
  return crypto.createHmac("sha256", secret).update(message).digest("base64url");
}

function buildPayload({ ttlMinutes = 0 } = {}) {
  const now = new Date();
  const payload = {
    companyId: "ENT-042",
    companyName: "Soconer",
    companyEmail: "contact@soconer.example",
    contactName: "Mme Martin",
    submissionId: `inv-${now.toISOString().slice(0, 10).replace(/-/g, "")}-042`,
    contestName: "Concours Mediatheque Bordeaux",
    dossierId: "concours-mediatheque-bordeaux",
    folderPath: "/sites/DEPOTS/BDD_reception_piece",
    documents: ["KBIS", "URSSAF", "RIB", "ASSURANCE_RC"],
    nonce: randomNonce(),
    iat: now.toISOString(),
  };

  if (ttlMinutes > 0) {
    payload.exp = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  }

  return payload;
}

function buildUrl({ origin, ctx, sig }) {
  const url = new URL(origin);
  url.searchParams.set("ctx", ctx);
  url.searchParams.set("sig", sig);
  url.searchParams.set("alg", "HS256");
  return url.toString();
}

function main() {
  const secret = process.env.PORTAL_LINK_SECRET || process.env.CLIENT_PORTAL_LINK_SECRET || "";
  if (!secret) {
    console.error("Missing PORTAL_LINK_SECRET in environment.");
    process.exit(1);
  }

  const origin =
    process.env.CLIENT_PORTAL_PUBLIC_URL ||
    process.env.PORTAL_ORIGIN ||
    "http://127.0.0.1:3001/depot";
  const ttlMinutes =
    Number(process.env.PORTAL_LINK_TTL_MINUTES || process.env.CLIENT_PORTAL_LINK_TTL_MINUTES || 0) ||
    0;
  const payload = buildPayload({ ttlMinutes });
  const ctx = encodeBase64Url(canonicalJson(payload));
  const sig = hmacSha256Base64Url(ctx, secret);

  const goodUrl = buildUrl({ origin, ctx, sig });
  const tamperedCtx = ctx.slice(0, -1) + (ctx.endsWith("A") ? "B" : "A");
  const badUrl = buildUrl({ origin, ctx: tamperedCtx, sig });

  const expected = hmacSha256Base64Url(ctx, secret);
  const ok = expected === sig;
  const okTampered = hmacSha256Base64Url(tamperedCtx, secret) === sig;

  console.log("Signature check (good):", ok ? "OK" : "INVALID");
  console.log("Signature check (tampered):", okTampered ? "OK (unexpected)" : "INVALID (expected)");
  console.log("");
  console.log("Shareable URL:");
  console.log(goodUrl);
  console.log("");
  console.log("Tampered URL (should warn):");
  console.log(badUrl);
}

main();
