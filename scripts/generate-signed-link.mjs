#!/usr/bin/env node
/**
 * Dev helper: persist an opaque invitation in PostgreSQL and print a signed URL.
 *
 * Requires DATABASE_URL and PORTAL_LINK_SECRET.
 */

import { initDatabase, closeDatabase, insertSignedInvitation } from "../server/db/index.js";
import { persistAndSignInvitation } from "../server/security.js";

async function main() {
  const secret = process.env.PORTAL_LINK_SECRET || process.env.CLIENT_PORTAL_LINK_SECRET || "";
  if (!secret) {
    console.error("Missing PORTAL_LINK_SECRET in environment.");
    process.exit(1);
  }

  await initDatabase();

  const origin =
    process.env.CLIENT_PORTAL_PUBLIC_URL ||
    process.env.PORTAL_ORIGIN ||
    "http://127.0.0.1:5173/depot";
  const ttlMinutes =
    Number(process.env.PORTAL_LINK_TTL_MINUTES || process.env.CLIENT_PORTAL_LINK_TTL_MINUTES || 0) ||
    0;

  const context = {
    companyId: "ENT-042",
    companyName: "Soconer",
    companyEmail: "contact@soconer.example",
    contactName: "Mme Martin",
    submissionId: `inv-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-042`,
    contestName: "Concours Mediatheque Bordeaux",
    dossierId: "concours-mediatheque-bordeaux",
    folderPath: "/sites/DEPOTS/BDD_reception_piece",
    documents: ["KBIS", "URSSAF", "RIB", "ASSURANCE_RC"],
    deadline: "2030-12-31T23:59:59.000Z",
  };

  const signed = await persistAndSignInvitation({
    context,
    secret,
    ttlMinutes: ttlMinutes > 0 ? ttlMinutes : 60,
    baseUrl: origin,
    insertSignedInvitation,
  });

  console.log("Invitation ID (opaque):", signed.inv);
  console.log("");
  console.log("Shareable URL:");
  console.log(signed.url);

  await closeDatabase();
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
