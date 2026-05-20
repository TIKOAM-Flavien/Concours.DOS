import { resolveDocumentList } from "../config/documentCatalog";
import { portalEnv } from "../config/env";

function splitCsv(value) {
  return String(value || "")
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstValue(...values) {
  for (const value of values) {
    if (value == null) continue;
    const trimmed = String(value).trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function readQuery(params, aliases) {
  for (const alias of aliases) {
    const value = params.get(alias);
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function normalizeDocumentSource(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return splitCsv(value);
  return [];
}

export function applyVerifiedInvitation(context, invitation = {}) {
  if (!invitation || typeof invitation !== "object") return context;

  const documents = resolveDocumentList(
    invitation.documents?.length ? invitation.documents : context.documents
  );

  return {
    ...context,
    projectId: firstValue(invitation.projectId, context.projectId),
    contestName: firstValue(
      invitation.contestName,
      context.contestName,
      portalEnv.defaultContestName
    ),
    dossierId: firstValue(invitation.dossierId, context.dossierId),
    folderPath: firstValue(invitation.folderPath, context.folderPath),
    companyId: firstValue(invitation.companyId, context.companyId),
    companyName: firstValue(invitation.companyName, context.companyName, "Entreprise invitee"),
    companyEmail: firstValue(invitation.companyEmail, context.companyEmail),
    contactName: firstValue(invitation.contactName, context.contactName),
    submissionId: firstValue(invitation.submissionId, context.submissionId),
    supportEmail: firstValue(invitation.supportEmail, context.supportEmail),
    supportPhone: firstValue(invitation.supportPhone, context.supportPhone),
    websiteUrl: firstValue(invitation.websiteUrl, context.websiteUrl),
    deadline: firstValue(invitation.deadline, context.deadline),
    documents,
    verified: {
      exp: invitation.exp || "",
      iat: invitation.iat || "",
      nonce: invitation.nonce || "",
    },
    link: {
      ...context.link,
      signatureStatus: "ok",
    },
  };
}

export function resolveLinkContext() {
  const params = new URLSearchParams(window.location.search);
  const inv = firstValue(params.get("inv"), params.get("invitationId"));
  const sig = firstValue(params.get("sig"), params.get("signature"));
  const alg = firstValue(params.get("alg"), params.get("algorithm"), "HS256");
  const source = firstValue(params.get("source"));
  const signedLink = Boolean(inv);

  const requestedDocuments = normalizeDocumentSource(
    signedLink ? [] : readQuery(params, ["documents", "documentTypes", "pieces"])
  );

  const documents = resolveDocumentList(
    requestedDocuments.length ? requestedDocuments : portalEnv.requiredDocuments
  );

  const context = {
    brandName: portalEnv.brandName,
    portalTitle: portalEnv.portalTitle,
    portalSubtitle: portalEnv.portalSubtitle,
    projectId: signedLink ? "" : readQuery(params, ["projectId", "projetId"]),
    contestName: signedLink
      ? portalEnv.defaultContestName
      : firstValue(
          readQuery(params, ["contestName", "consultation", "competition"]),
          portalEnv.defaultContestName,
          "Consultation architecture"
        ),
    dossierId: signedLink
      ? ""
      : firstValue(readQuery(params, ["dossierId", "folderKey"]), portalEnv.defaultDossierId),
    folderPath: signedLink
      ? ""
      : firstValue(
          readQuery(params, ["folderPath"]),
          portalEnv.defaultFolderPath
        ),
    companyId: signedLink
      ? ""
      : firstValue(readQuery(params, ["companyId", "entrepriseId", "societeId"])),
    companyName: signedLink
      ? "Entreprise invitee"
      : firstValue(readQuery(params, ["companyName", "entreprise", "societe"]), "Entreprise invitee"),
    companyEmail: signedLink ? "" : readQuery(params, ["companyEmail", "email"]),
    contactName: signedLink ? "" : readQuery(params, ["contactName", "contact"]),
    submissionId: signedLink
      ? ""
      : firstValue(
          readQuery(params, ["submissionId", "invitationId", "token", "accessKey"])
        ),
    supportEmail: signedLink
      ? portalEnv.supportEmail
      : firstValue(readQuery(params, ["supportEmail"]), portalEnv.supportEmail),
    supportPhone: signedLink
      ? portalEnv.supportPhone
      : firstValue(readQuery(params, ["supportPhone"]), portalEnv.supportPhone),
    websiteUrl: signedLink
      ? portalEnv.websiteUrl
      : firstValue(readQuery(params, ["websiteUrl"]), portalEnv.websiteUrl),
    deadline: signedLink
      ? ""
      : firstValue(readQuery(params, ["deadline", "dateLimite", "echeance"])),
    documents,
    verified: null,
    warnings: [],
    link: {
      inv,
      sig,
      alg,
      source,
      signatureStatus: "unchecked",
    },
  };

  if (context.link.alg && context.link.alg !== "HS256") {
    context.warnings.push(
      `Algorithme de signature non supporte (${context.link.alg}). Attendu: HS256.`
    );
  }

  if (context.link.inv && !context.link.sig) {
    context.warnings.push(
      "L'identifiant d'invitation est present mais la signature (sig) est manquante."
    );
  }

  if (!signedLink) {
    if (!context.companyId) {
      context.warnings.push(
        "Le lien ne porte pas d'identifiant entreprise. Ajoutez companyId ou entrepriseId."
      );
    }

    if (!context.submissionId) {
      context.warnings.push(
        "Le lien ne porte pas d'identifiant de soumission. Ajoutez submissionId ou token."
      );
    }

    if (!context.folderPath) {
      context.warnings.push(
        "Aucun chemin de dossier n'est defini sur le projet (optionnel, metadata uniquement)."
      );
    }

    if (!context.dossierId) {
      context.warnings.push(
        "Aucun dossierId n'est defini. Ajoutez-le si le flow l'utilise pour filtrer ou tagger les documents."
      );
    }
  }

  return context;
}
