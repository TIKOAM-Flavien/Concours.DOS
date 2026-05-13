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

function decodeBase64Url(value) {
  const source = String(value || "").trim();
  if (!source) return "";
  const padded = source.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  const binary = atob(`${padded}${"=".repeat(padLength)}`);
  const bytes = Uint8Array.from(binary, (character) =>
    character.charCodeAt(0)
  );
  return new TextDecoder().decode(bytes);
}

function parseStructuredContext(params) {
  const encoded = firstValue(params.get("ctx"), params.get("context"));
  if (!encoded) return {};

  try {
    return JSON.parse(decodeBase64Url(encoded));
  } catch {
    return {};
  }
}

function normalizeDocumentSource(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return splitCsv(value);
  return [];
}

export function resolveLinkContext() {
  const params = new URLSearchParams(window.location.search);
  const rawCtx = firstValue(params.get("ctx"), params.get("context"));
  const structured = parseStructuredContext(params);
  const sig = firstValue(params.get("sig"), params.get("signature"));
  const alg = firstValue(params.get("alg"), params.get("algorithm"), "HS256");
  const preferStructuredContext = Boolean(rawCtx);
  const pickField = (structuredValue, queryAliases = [], fallback = "") =>
    firstValue(
      structuredValue,
      preferStructuredContext ? "" : readQuery(params, queryAliases),
      fallback
    );
  const requestedDocuments = normalizeDocumentSource(
    structured.documents ||
      structured.documentTypes ||
      (preferStructuredContext
        ? []
        : readQuery(params, ["documents", "documentTypes", "pieces"]))
  );

  const documents = resolveDocumentList(
    requestedDocuments.length
      ? requestedDocuments
      : preferStructuredContext
      ? []
      : portalEnv.requiredDocuments
  );

  const context = {
    brandName: portalEnv.brandName,
    portalTitle: portalEnv.portalTitle,
    portalSubtitle: portalEnv.portalSubtitle,
    contestName: firstValue(
      structured.contestName,
      structured.consultationName,
      preferStructuredContext
        ? ""
        : readQuery(params, ["contestName", "consultation", "competition"]),
      portalEnv.defaultContestName,
      "Consultation architecture"
    ),
    dossierId: pickField(
      structured.dossierId,
      ["dossierId", "folderKey"],
      portalEnv.defaultDossierId
    ),
    folderPath: pickField(
      structured.folderPath,
      ["folderPath", "sharepointFolder"],
      portalEnv.defaultFolderPath
    ),
    companyId: pickField(
      firstValue(structured.companyId, structured.enterpriseId, structured.societeId),
      preferStructuredContext ? [] : ["companyId", "entrepriseId", "societeId"]
    ),
    companyName: pickField(
      firstValue(structured.companyName, structured.enterpriseName, structured.societe),
      preferStructuredContext ? [] : ["companyName", "entreprise", "societe"],
      "Entreprise invitee"
    ),
    companyEmail: pickField(
      structured.companyEmail,
      preferStructuredContext ? [] : ["companyEmail", "email"]
    ),
    contactName: pickField(
      structured.contactName,
      preferStructuredContext ? [] : ["contactName", "contact"]
    ),
    submissionId: pickField(
      firstValue(structured.submissionId, structured.invitationId, structured.token),
      preferStructuredContext ? [] : ["submissionId", "invitationId", "token", "accessKey"]
    ),
    supportEmail: pickField(
      structured.supportEmail,
      ["supportEmail"],
      portalEnv.supportEmail
    ),
    supportPhone: pickField(
      structured.supportPhone,
      ["supportPhone"],
      portalEnv.supportPhone
    ),
    websiteUrl: pickField(
      structured.websiteUrl,
      ["websiteUrl"],
      portalEnv.websiteUrl
    ),
    deadline: pickField(
      firstValue(structured.deadline, structured.dateLimite),
      preferStructuredContext ? [] : ["deadline", "dateLimite", "echeance"]
    ),
    documents,
    warnings: [],
    link: {
      rawCtx,
      sig,
      alg,
      signatureStatus: "unchecked",
      decoded: structured,
    },
  };

  if (structured?.exp) {
    const expDate = new Date(structured.exp);
    if (!Number.isNaN(expDate.getTime()) && Date.now() > expDate.getTime()) {
      context.warnings.push(
        "Lien expire: la date de validite (exp) est depassee."
      );
    }
  }

  if (context.link.alg && context.link.alg !== "HS256") {
    context.warnings.push(
      `Algorithme de signature non supporte (${context.link.alg}). Attendu: HS256.`
    );
  }

  if (context.link.rawCtx && !context.link.sig) {
    context.warnings.push(
      "Le lien ctx est present mais non signe (sig manquant)."
    );
  }

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
      "Aucun folderPath n'est defini. Les depots seront bloques tant que le dossier SharePoint cible n'est pas connu."
    );
  }

  if (!context.dossierId) {
    context.warnings.push(
      "Aucun dossierId n'est defini. Ajoutez-le si le flow l'utilise pour filtrer ou tagger les documents."
    );
  }

  return context;
}
