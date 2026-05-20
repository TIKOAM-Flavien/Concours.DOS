import { documentReviewLabel } from "../../shared/documentReview.js";

const INVITATION_EVENT_LABELS = {
  email_sent: "Invitation envoyee",
  email_reminder_sent: "Relance envoyee",
  opened: "Lien ouvert",
  verified: "Lien verifie",
  submitted: "Depot confirme via lien",
  admin_test_open: "Test admin du lien",
};

function companyLabel(company) {
  if (!company) return "";
  const name = String(company.companyName || company.name || "").trim();
  const email = String(company.companyEmail || company.email || "").trim();
  if (name && email) return `${name} (${email})`;
  return name || email || String(company.companyId || company.id || "").trim();
}

function resolveCompany(companyById, companyId) {
  const id = String(companyId || "").trim();
  if (!id) return null;
  return companyById.get(id) || { companyId: id, companyName: id };
}

function formatRecipients(companyIds, companyById) {
  const labels = (companyIds || [])
    .map((id) => companyLabel(resolveCompany(companyById, id)))
    .filter(Boolean);
  if (!labels.length) return "";
  if (labels.length <= 3) return labels.join(", ");
  return `${labels.slice(0, 3).join(", ")} (+${labels.length - 3})`;
}

function formatRecipientList(recipients = []) {
  const labels = recipients
    .map((item) => {
      const name = String(item?.companyName || "").trim();
      const email = String(item?.companyEmail || "").trim();
      if (name && email) return `${name} (${email})`;
      return name || email || String(item?.companyId || "").trim();
    })
    .filter(Boolean);
  if (!labels.length) return "";
  if (labels.length <= 3) return labels.join(", ");
  return `${labels.slice(0, 3).join(", ")} (+${labels.length - 3})`;
}

function findDocument(documents, recordId) {
  return documents.find((doc) => String(doc.id) === String(recordId || ""));
}

function mapAuditEntry(row, { companyById, documents }) {
  const payload = row.payload || {};
  const action = String(row.action || "");
  const at = row.createdAt || "";
  const base = {
    at,
    source: "audit",
    actorIp: row.actorIp || "",
  };

  if (action === "admin.document.review") {
    const doc = findDocument(documents, payload.recordId);
    const status = payload.reviewStatus || doc?.reviewStatus || "pending";
    return {
      ...base,
      id: `audit:${row.id}`,
      kind: "review",
      tone: status === "accepted" ? "success" : status === "rejected" ? "warning" : "neutral",
      label:
        status === "accepted"
          ? "Piece acceptee"
          : status === "rejected"
            ? "Piece refusee"
            : "Piece en validation",
      detail: documentReviewLabel(status),
      companyName: doc?.companyName || resolveCompany(companyById, payload.companyId)?.companyName || "",
      documentType: payload.documentType || doc?.documentType || "",
      fileName: doc?.fileName || doc?.originalFileName || "",
      actor: payload.reviewedBy || "",
    };
  }

  if (action === "admin.invitations.send") {
    const recipients = formatRecipientList(payload.recipients);
    const fallback = formatRecipients(payload.companyIds, companyById);
    return {
      ...base,
      id: `audit:${row.id}`,
      kind: "email",
      tone: "info",
      label: "Invitations envoyees",
      detail: recipients || fallback || `${payload.count || 0} entreprise(s)`,
      companyName: "",
      documentType: "",
      fileName: "",
    };
  }

  if (action === "admin.invitations.remind") {
    const recipients = formatRecipientList(payload.recipients);
    const fallback = formatRecipients(payload.companyIds, companyById);
    return {
      ...base,
      id: `audit:${row.id}`,
      kind: "email",
      tone: "info",
      label: "Relances envoyees",
      detail: recipients || fallback || `${payload.count || 0} entreprise(s)`,
      companyName: "",
      documentType: "",
      fileName: "",
    };
  }

  if (action === "admin.invitation.sign") {
    const company = resolveCompany(companyById, payload.companyId);
    return {
      ...base,
      id: `audit:${row.id}`,
      kind: "admin",
      tone: "neutral",
      label: "Lien d'invitation genere",
      detail: companyLabel(company) || payload.companyName || payload.submissionId || "",
      companyName: payload.companyName || company?.companyName || "",
      documentType: "",
      fileName: "",
    };
  }

  if (action === "admin.invitation.revoke") {
    return {
      ...base,
      id: `audit:${row.id}`,
      kind: "admin",
      tone: "warning",
      label: "Lien revoque",
      detail: payload.reason || payload.invitationId || "",
      companyName: "",
      documentType: "",
      fileName: "",
    };
  }

  if (action === "admin.document.download") {
    const doc = findDocument(documents, payload.recordId);
    return {
      ...base,
      id: `audit:${row.id}`,
      kind: "admin",
      tone: "neutral",
      label: "Fichier consulte",
      detail: doc?.fileName || payload.recordId || "",
      companyName: doc?.companyName || "",
      documentType: payload.documentType || doc?.documentType || "",
      fileName: doc?.fileName || "",
    };
  }

  if (action === "admin.company.upsert") {
    return {
      ...base,
      id: `audit:${row.id}`,
      kind: "admin",
      tone: "neutral",
      label: "Entreprise enregistree",
      detail: payload.companyName || payload.submissionId || payload.companyId || "",
      companyName: payload.companyName || "",
      documentType: "",
      fileName: "",
    };
  }

  if (action === "admin.company.delete") {
    const company = resolveCompany(companyById, payload.companyId);
    return {
      ...base,
      id: `audit:${row.id}`,
      kind: "admin",
      tone: "warning",
      label: "Entreprise supprimee",
      detail: companyLabel(company) || payload.companyId || "",
      companyName: company?.companyName || "",
      documentType: "",
      fileName: "",
    };
  }

  if (action === "admin.project.archive") {
    return {
      ...base,
      id: `audit:${row.id}`,
      kind: "admin",
      tone: "neutral",
      label: "Projet archive",
      detail: "",
      companyName: "",
      documentType: "",
      fileName: "",
    };
  }

  if (action === "admin.project.unarchive") {
    return {
      ...base,
      id: `audit:${row.id}`,
      kind: "admin",
      tone: "neutral",
      label: "Projet reactive",
      detail: "",
      companyName: "",
      documentType: "",
      fileName: "",
    };
  }

  if (action === "admin.project.upsert") {
    return {
      ...base,
      id: `audit:${row.id}`,
      kind: "admin",
      tone: "neutral",
      label: "Projet mis a jour",
      detail: payload.name || "",
      companyName: "",
      documentType: "",
      fileName: "",
    };
  }

  if (action === "admin.project.delete") {
    return {
      ...base,
      id: `audit:${row.id}`,
      kind: "admin",
      tone: "warning",
      label: "Projet supprime",
      detail: "",
      companyName: "",
      documentType: "",
      fileName: "",
    };
  }

  if (action === "admin.maintenance.cleanup") {
    return {
      ...base,
      id: `audit:${row.id}`,
      kind: "admin",
      tone: "neutral",
      label: "Maintenance",
      detail: "Nettoyage effectue",
      companyName: "",
      documentType: "",
      fileName: "",
    };
  }

  return {
    ...base,
    id: `audit:${row.id}`,
    kind: "admin",
    tone: "neutral",
    label: action.replace(/^admin\./, "Action admin: ").replace(/\./g, " "),
    detail: "",
    companyName: "",
    documentType: "",
    fileName: "",
  };
}

function mapInvitationEventEntry(event) {
  const label = INVITATION_EVENT_LABELS[event.eventType] || event.eventType;
  const email = String(event.companyEmail || "").trim();
  const name = String(event.companyName || "").trim();
  const recipient = name && email ? `${name} (${email})` : name || email || event.submissionId || "";

  return {
    id: `invitation-event:${event.id}`,
    at: event.createdAt || "",
    source: "invitation",
    kind: event.eventType?.startsWith("email") ? "email" : "portal",
    tone: event.eventType === "email_reminder_sent" ? "info" : "info",
    label,
    detail: recipient,
    companyName: name,
    companyEmail: email,
    documentType: "",
    fileName: "",
    actor: event.source === "admin" ? "admin" : "",
  };
}

function mapDepositEntry(doc) {
  const at = doc.receivedAt || doc.updatedAt || doc.createdAt || "";
  if (!at) return null;
  return {
    id: `deposit:${doc.id}`,
    at,
    source: "document",
    kind: "deposit",
    tone: "info",
    label: "Depot de piece",
    detail: doc.fileName || doc.originalFileName || "",
    companyName: doc.companyName || "",
    documentType: doc.documentType || "",
    fileName: doc.fileName || doc.originalFileName || "",
    actor: "",
  };
}

export function buildProjectActivityFeed({
  companies = [],
  auditRows = [],
  invitationEvents = [],
  documents = [],
  limit = 80,
} = {}) {
  const companyById = new Map();
  for (const company of companies) {
    const businessId = String(company.companyId || "").trim();
    const dbId = String(company.id || "").trim();
    if (businessId) companyById.set(businessId, company);
    if (dbId) companyById.set(dbId, company);
  }

  const items = [];
  const reviewAuditRecordIds = new Set();

  for (const row of auditRows) {
    const entry = mapAuditEntry(row, { companyById, documents });
    if (!entry?.at) continue;
    if (row.action === "admin.document.review" && row.payload?.recordId) {
      reviewAuditRecordIds.add(String(row.payload.recordId));
    }
    items.push(entry);
  }

  for (const event of invitationEvents) {
    const entry = mapInvitationEventEntry(event);
    if (!entry?.at) continue;
    items.push(entry);
  }

  for (const doc of documents) {
    const deposit = mapDepositEntry(doc);
    if (deposit) items.push(deposit);

    const reviewedAt = String(doc.reviewedAt || "").trim();
    const reviewStatus = String(doc.reviewStatus || "pending").trim();
    if (
      reviewedAt &&
      reviewStatus !== "pending" &&
      !reviewAuditRecordIds.has(String(doc.id))
    ) {
      items.push({
        id: `review-record:${doc.id}`,
        at: reviewedAt,
        source: "document",
        kind: "review",
        tone: reviewStatus === "accepted" ? "success" : "warning",
        label: reviewStatus === "accepted" ? "Piece acceptee" : "Piece refusee",
        detail: documentReviewLabel(reviewStatus),
        companyName: doc.companyName || "",
        documentType: doc.documentType || "",
        fileName: doc.fileName || doc.originalFileName || "",
        actor: doc.reviewedBy || "",
      });
    }
  }

  const seen = new Set();
  const merged = [];
  for (const item of items.sort((a, b) => String(b.at).localeCompare(String(a.at)))) {
    const key = `${item.id}:${item.at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
    if (merged.length >= limit) break;
  }

  return merged;
}
