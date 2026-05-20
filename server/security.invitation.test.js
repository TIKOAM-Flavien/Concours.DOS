import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import {
  isOpaqueInvitationId,
  persistAndSignInvitation,
  verifySignedInvitation,
} from "./security.js";

const secret = "test-secret-for-opaque-invitations";
const baseContext = {
  projectId: "proj-1",
  companyId: "co-1",
  companyName: "Test Co",
  companyEmail: "a@example.com",
  contactName: "Alice",
  submissionId: "sub-1",
  contestName: "Concours",
  dossierId: "dossier-1",
  folderPath: "/sites/test",
  documents: ["KBIS"],
  deadline: "2030-12-31T23:59:59.000Z",
};

describe("opaque signed invitations", () => {
  it("persistAndSignInvitation stores payload and returns inv URL", async () => {
    const store = new Map();
    const signed = await persistAndSignInvitation({
      context: baseContext,
      secret,
      ttlMinutes: 60,
      baseUrl: "https://portal.example/depot",
      insertSignedInvitation: async (row) => {
        store.set(row.id, row);
      },
    });

    assert.ok(isOpaqueInvitationId(signed.inv));
    assert.match(signed.url, /inv=/);
    assert.doesNotMatch(signed.url, /ctx=/);
    assert.equal(store.size, 1);
    assert.equal(store.get(signed.inv).payload.companyId, "co-1");
  });

  it("verifySignedInvitation accepts valid inv+sig", async () => {
    const store = new Map();
    const signed = await persistAndSignInvitation({
      context: baseContext,
      secret,
      ttlMinutes: 60,
      baseUrl: "https://portal.example/depot",
      insertSignedInvitation: async (row) => {
        store.set(row.id, {
          id: row.id,
          payload: row.payload,
          exp: row.exp,
        });
      },
    });

    const verification = await verifySignedInvitation({
      inv: signed.inv,
      sig: signed.sig,
      secret,
      loadInvitation: async (id) => store.get(id) || null,
    });

    assert.equal(verification.ok, true);
    assert.equal(verification.payload.companyId, "co-1");
  });

  it("verifySignedInvitation rejects invalid signature", async () => {
    const inv = randomUUID();
    const verification = await verifySignedInvitation({
      inv,
      sig: "bad-signature",
      secret,
      loadInvitation: async () => ({
        id: inv,
        payload: baseContext,
        exp: "2099-01-01T00:00:00.000Z",
      }),
    });

    assert.equal(verification.ok, false);
    assert.equal(verification.code, "invalid_sig");
  });

  it("verifySignedInvitation rejects expired invitations", async () => {
    const inv = randomUUID();
    const { createHmac } = await import("node:crypto");
    const sig = createHmac("sha256", secret).update(inv).digest("base64url");

    const verification = await verifySignedInvitation({
      inv,
      sig,
      secret,
      loadInvitation: async () => ({
        id: inv,
        payload: { ...baseContext, exp: "2000-01-01T00:00:00.000Z" },
        exp: "2000-01-01T00:00:00.000Z",
      }),
    });

    assert.equal(verification.ok, false);
    assert.equal(verification.code, "expired");
  });

  it("insertSignedInvitation reissues prior active invitations", async () => {
    const store = new Map();
    const insertSignedInvitation = async (row) => {
      store.set(row.id, {
        id: row.id,
        payload: row.payload,
        projectId: row.projectId,
        companyId: row.companyId,
        status: "generated",
        exp: row.exp,
      });
      for (const [existingId, existing] of store.entries()) {
        if (
          existingId !== row.id &&
          existing.projectId === row.projectId &&
          existing.companyId === row.companyId &&
          ["generated", "sent"].includes(existing.status)
        ) {
          existing.status = "reissued";
        }
      }
    };

    const first = await persistAndSignInvitation({
      context: { ...baseContext, projectId: "proj-1" },
      secret,
      ttlMinutes: 60,
      baseUrl: "https://portal.example/depot",
      insertSignedInvitation,
    });
    const second = await persistAndSignInvitation({
      context: { ...baseContext, projectId: "proj-1" },
      secret,
      ttlMinutes: 60,
      baseUrl: "https://portal.example/depot",
      insertSignedInvitation,
    });

    assert.equal(store.get(first.inv).status, "reissued");
    assert.equal(store.get(second.inv).status, "generated");
  });

  it("persistAndSignInvitation reuses active company invitation while refreshing payload", async () => {
    const store = new Map();
    const inserted = await persistAndSignInvitation({
      context: {
        ...baseContext,
        projectId: "proj-stable",
        companyDbId: "company-db-1",
        documents: ["EXTRAIT_KBIS"],
      },
      secret,
      ttlMinutes: 60,
      baseUrl: "https://portal.example/depot",
      insertSignedInvitation: async (row) => {
        store.set(row.id, {
          id: row.id,
          payload: row.payload,
          projectId: row.projectId,
          companyId: row.companyId,
          submissionId: row.submissionId,
          status: "generated",
          iat: row.iat,
          exp: row.exp,
        });
      },
    });

    const reused = await persistAndSignInvitation({
      context: {
        ...baseContext,
        projectId: "proj-stable",
        companyDbId: "company-db-1",
        documents: ["EXTRAIT_KBIS", "ATTESTATION_ASSURANCES"],
      },
      secret,
      ttlMinutes: 60,
      baseUrl: "https://portal.example/depot",
      insertSignedInvitation: async () => {
        throw new Error("must reuse existing invitation");
      },
      findReusableSignedInvitation: async () => store.get(inserted.inv),
      updateSignedInvitationPayload: async ({ id, payload }) => {
        const current = store.get(id);
        store.set(id, { ...current, payload });
      },
    });

    assert.equal(reused.inv, inserted.inv);
    assert.equal(reused.url, inserted.url);
    assert.equal(reused.reused, true);
    assert.deepEqual(store.get(inserted.inv).payload.documents, [
      "EXTRAIT_KBIS",
      "ATTESTATION_ASSURANCES",
    ]);
  });

  it("verifySignedInvitation can allow expired for revoke", async () => {
    const inv = randomUUID();
    const { createHmac } = await import("node:crypto");
    const sig = createHmac("sha256", secret).update(inv).digest("base64url");

    const verification = await verifySignedInvitation({
      inv,
      sig,
      secret,
      allowExpired: true,
      loadInvitation: async () => ({
        id: inv,
        payload: { ...baseContext, exp: "2000-01-01T00:00:00.000Z" },
        exp: "2000-01-01T00:00:00.000Z",
      }),
    });

    assert.equal(verification.ok, true);
  });
});
