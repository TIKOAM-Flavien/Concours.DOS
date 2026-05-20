export const DOCUMENT_REVIEW_STATUSES = Object.freeze(["pending", "accepted", "rejected"]);

export const DOCUMENT_REVIEW_LABELS = Object.freeze({
  pending: "A valider",
  accepted: "Acceptee",
  rejected: "Refusee",
});

export function isDocumentReviewStatus(value) {
  return DOCUMENT_REVIEW_STATUSES.includes(String(value || "").trim());
}

export function documentReviewLabel(status) {
  return DOCUMENT_REVIEW_LABELS[status] || status || DOCUMENT_REVIEW_LABELS.pending;
}
