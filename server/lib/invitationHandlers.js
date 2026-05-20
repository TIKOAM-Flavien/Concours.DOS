import { normalizeDocumentId, resolveDocumentList } from "../../src/config/documentCatalog.js";
import {
  findProjectForInvitationScope,
  getSignedInvitationById,
  isInvitationRevoked,
  recordInvitationEvent,
} from "../db.js";
import {
  getInvitationPayloadIssues,
  getSigningConfig,
  isInvitationDeadlinePast,
  sanitizeInvitationContext,
  verifySignedInvitation,
} from "../security.js";

export function createInvitationHandlers({
  env,
  badRequest,
  forbidden,
  normalizeTextField,
  getActorIp,
  hashActorIp,
}) {
  function renderDepotAccessError(res, code) {
    const messages = {
      missing_inv: "Le lien ne contient pas d'identifiant d'invitation (inv).",
      missing_sig: "Le lien ne contient pas de signature (sig).",
      invalid_alg: "L'algorithme de signature n'est pas supporte.",
      invalid_sig: "La signature du lien est invalide.",
      invalid_inv: "L'identifiant d'invitation est invalide ou inconnu.",
      invalid_exp: "La date d'expiration du lien est invalide.",
      invalid_payload: "Le lien signe ne contient pas toutes les informations requises.",
      expired: "Le lien est expire.",
      deadline_passed:
        "La date limite de depot est passee. Le portail n'est plus accessible pour cette invitation.",
      revoked: "Le lien a ete revoque.",
      missing_secret: "La signature serveur n'est pas configuree.",
    };

    const message = messages[code] || "Lien de depot invalide.";
    res.status(403).type("html").send(
      `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Acces refuse</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; background: #f6f7fb; color: #182033; }
      main { max-width: 680px; margin: 8vh auto; padding: 2rem; background: #fff; border-radius: 14px; box-shadow: 0 14px 30px rgba(16, 24, 40, 0.1); }
      h1 { margin: 0 0 0.75rem; font-size: 1.4rem; }
      p { margin: 0; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <h1>Acces depot refuse</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`
    );
  }

  function verifyInvitationFields(payload) {
    const issues = getInvitationPayloadIssues(payload);
    if (issues.length) {
      return { ok: false, code: "invalid_payload", issues };
    }

    return { ok: true, code: "ok", issues: [] };
  }

  function normalizeLookupKey(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function findCompanyForInvitation(project, invitation) {
    const companies = Array.isArray(project?.companies) ? project.companies : [];
    const companyDbId = String(invitation.companyDbId || "").trim();
    if (companyDbId) {
      const match = companies.find((company) => company.id === companyDbId);
      if (match) return match;
    }

    const submissionKey = normalizeLookupKey(invitation.submissionId);
    if (submissionKey) {
      const match = companies.find(
        (company) => normalizeLookupKey(company.submissionId) === submissionKey
      );
      if (match) return match;
    }

    const companyIdKey = normalizeLookupKey(invitation.companyId);
    if (companyIdKey) {
      const match = companies.find(
        (company) => normalizeLookupKey(company.companyId) === companyIdKey
      );
      if (match) return match;
    }

    const companyNameKey = normalizeLookupKey(invitation.companyName);
    if (companyNameKey) {
      return companies.find(
        (company) => normalizeLookupKey(company.companyName) === companyNameKey
      );
    }

    return null;
  }

  function resolveCurrentExpectedDocuments(project, company) {
    const customDocs = Array.isArray(project?.customDocuments)
      ? project.customDocuments
      : [];
    const customById = new Map(
      customDocs
        .filter((doc) => doc && typeof doc === "object" && doc.id)
        .map((doc) => [doc.id, doc])
    );
    return (company.expectedDocuments || []).map(
      (documentId) => customById.get(documentId) || documentId
    );
  }

  async function resolveLiveInvitationContext(payload) {
    const stored = sanitizeInvitationContext(payload);
    const project = await resolveInvitationProject(stored);
    if (!project) return null;

    const company = findCompanyForInvitation(project, stored);
    if (!company) return null;

    return sanitizeInvitationContext({
      ...stored,
      projectId: project.id,
      companyDbId: company.id,
      companyId: company.companyId,
      companyName: company.companyName,
      companyEmail: company.companyEmail,
      contactName: company.contactName,
      submissionId: company.submissionId,
      contestName: project.name,
      dossierId: project.dossierId,
      folderPath: project.folderPath,
      deadline: project.deadline,
      documents: resolveCurrentExpectedDocuments(project, company),
    });
  }

  async function ensureInvitationNotRevoked(invitationId) {
    const id = String(invitationId || "").trim();
    if (await isInvitationRevoked(id)) {
      throw forbidden("Signed invitation revoked.");
    }
  }

  async function resolveInvitationProject(invitation) {
    return findProjectForInvitationScope({
      projectId: invitation.projectId,
      dossierId: invitation.dossierId,
      companyId: invitation.companyId,
      companyName: invitation.companyName,
      submissionId: invitation.submissionId,
    });
  }

  async function ensureProjectAllowsDeposits(invitation) {
    const project = await resolveInvitationProject(invitation);
    if (project?.archivedAt) {
      throw forbidden("Project is archived; new deposits are blocked.");
    }
    return project;
  }

  async function requireSignedDepotLink(req, res, next) {
    const { secret } = getSigningConfig(env);
    const inv = String(req.query.inv || "");
    const sig = String(req.query.sig || "");
    const alg = String(req.query.alg || "HS256");

    const verification = await verifySignedInvitation({
      inv,
      sig,
      alg,
      secret,
      loadInvitation: getSignedInvitationById,
    });

    if (!verification.ok) {
      return renderDepotAccessError(res, verification.code);
    }

    const liveInvitation = await resolveLiveInvitationContext(verification.payload);
    if (!liveInvitation) {
      return renderDepotAccessError(res, "invalid_payload");
    }

    const payloadCheck = verifyInvitationFields(liveInvitation);
    if (!payloadCheck.ok) {
      return renderDepotAccessError(res, payloadCheck.code);
    }

    if (isInvitationDeadlinePast(liveInvitation)) {
      return renderDepotAccessError(res, "deadline_passed");
    }

    try {
      await ensureInvitationNotRevoked(verification.invitationId);
    } catch {
      return renderDepotAccessError(res, "revoked");
    }

    await trackInvitationEvent(req, verification.invitationId, "opened");
    return next();
  }

  function resolveEventSource(req) {
    const rawSource = String(req.query?.source || req.body?.source || "").trim();
    return rawSource === "admin_test" ? "admin_test" : "recipient";
  }

  async function trackInvitationEvent(req, invitationId, eventType, metadata = {}) {
    try {
      const source = resolveEventSource(req);
      await recordInvitationEvent({
        invitationId,
        eventType: source === "admin_test" ? "admin_test_open" : eventType,
        source,
        actorIpHash: hashActorIp?.(getActorIp?.(req) || "") || "",
        userAgent: req.get?.("user-agent") || "",
        metadata: {
          path: req.originalUrl || req.url || "",
          method: req.method || "",
          ...metadata,
        },
      });
    } catch (error) {
      console.warn("[invitation-event] failed:", error?.message || error);
    }
  }

  async function getVerifiedInvitationFromBody(body = {}) {
    const signing = getSigningConfig(env);
    const inv = normalizeTextField(body.inv, "inv", { required: true, max: 64 });
    const sig = normalizeTextField(body.sig, "sig", { required: true, max: 512 });
    const alg = normalizeTextField(body.alg || "HS256", "alg", { max: 20 }) || "HS256";

    const verification = await verifySignedInvitation({
      inv,
      sig,
      alg,
      secret: signing.secret,
      loadInvitation: getSignedInvitationById,
    });

    if (!verification.ok) {
      throw forbidden(`Signed invitation rejected (${verification.code}).`);
    }

    const liveInvitation = await resolveLiveInvitationContext(verification.payload);
    if (!liveInvitation) {
      throw forbidden("Signed invitation is no longer attached to an active company.");
    }

    const payloadCheck = verifyInvitationFields(liveInvitation);
    if (!payloadCheck.ok) {
      throw forbidden(
        `Signed invitation is incomplete: ${payloadCheck.issues.join(", ")}.`
      );
    }

    if (isInvitationDeadlinePast(liveInvitation)) {
      throw forbidden("Signed invitation rejected (deadline_passed).");
    }

    await ensureInvitationNotRevoked(verification.invitationId);

    const record = await getSignedInvitationById(verification.invitationId);
    return {
      ...liveInvitation,
      invitationId: verification.invitationId,
      status: record?.status || "generated",
      sentAt: record?.sentAt || "",
      iat: verification.payload?.iat || "",
      exp: verification.payload?.exp || "",
      nonce: verification.payload?.nonce || "",
    };
  }

  function resolveInvitationDocument(invitation, rawDocumentId) {
    const documentId = normalizeDocumentId(rawDocumentId);
    if (!documentId) {
      throw badRequest("Missing required field: documentId");
    }

    const allowedDocuments = resolveDocumentList(invitation.documents);
    const document = allowedDocuments.find((entry) => entry.id === documentId);
    if (!document) {
      throw forbidden(`Document type ${documentId} is not allowed by this invitation.`);
    }

    return document;
  }

  return {
    renderDepotAccessError,
    verifyInvitationFields,
    ensureInvitationNotRevoked,
    resolveInvitationProject,
    ensureProjectAllowsDeposits,
    requireSignedDepotLink,
    getVerifiedInvitationFromBody,
    trackInvitationEvent,
    resolveInvitationDocument,
  };
}
