/**
 * CSS class and label mappers for admin UI status displays.
 */

import { documentReviewLabel } from "../../shared/documentReview.js";

export function invitationStatusClass(status) {
  switch (status) {
    case "sent":
      return "status-pill status-pill--success";
    case "expired":
      return "status-pill status-pill--danger";
    case "reissued":
      return "status-pill status-pill--warning";
    case "generated":
    default:
      return "status-pill status-pill--neutral";
  }
}

export function trackingStatusClassName(statusKey) {
  if (statusKey === "complete") return "status-pill status-pill--success";
  if (statusKey === "progress") return "status-pill status-pill--warning";
  return "status-pill";
}

export function documentSyncClassName(record) {
  if (!record) return "admin-doc-pill admin-doc-pill--missing";
  if (record.syncStatus === "sync_failed") return "admin-doc-pill admin-doc-pill--error";

  const reviewStatus = record.reviewStatus || "pending";
  if (reviewStatus === "rejected") return "admin-doc-pill admin-doc-pill--review-rejected";
  if (reviewStatus === "accepted") return "admin-doc-pill admin-doc-pill--review-accepted";
  if (record.filePath || record.localRecordId) {
    return "admin-doc-pill admin-doc-pill--review-pending";
  }
  return "admin-doc-pill admin-doc-pill--missing";
}

export function documentSyncLabel(record) {
  if (!record) return " - non recu";
  if (record.syncStatus === "sync_failed") return " - erreur depot";

  const reviewStatus = record.reviewStatus || "pending";
  if (reviewStatus === "accepted") return " - validee";
  if (reviewStatus === "rejected") return " - refusee";
  if (record.filePath || record.localRecordId) return " - a valider";
  return " - non recu";
}

export function documentReviewStatusLabel(record) {
  if (!record?.filePath && !record?.localRecordId) return "";
  return documentReviewLabel(record.reviewStatus || "pending");
}

export function overviewStatusClassName(statusKey) {
  if (statusKey === "complete") return "status-pill status-pill--success";
  if (statusKey === "almost") return "status-pill status-pill--info";
  if (statusKey === "progress") return "status-pill status-pill--warning";
  if (statusKey === "todo") return "status-pill status-pill--neutral";
  return "status-pill";
}

export function overviewUrgencyMeta(urgencyKey, daysUntilDeadline) {
  if (urgencyKey === "overdue") {
    const overdueBy = Math.abs(daysUntilDeadline ?? 0);
    return {
      label: overdueBy ? `Echeance depassee (${overdueBy} j)` : "Echeance depassee",
      className: "overview-urgency overview-urgency--overdue",
    };
  }
  if (urgencyKey === "urgent") {
    return {
      label: `Urgent : ${daysUntilDeadline} j`,
      className: "overview-urgency overview-urgency--urgent",
    };
  }
  if (urgencyKey === "soon") {
    return {
      label: `Bientot : ${daysUntilDeadline} j`,
      className: "overview-urgency overview-urgency--soon",
    };
  }
  if (urgencyKey === "done") {
    return {
      label: "Echeance respectee",
      className: "overview-urgency overview-urgency--done",
    };
  }
  if (urgencyKey === "normal") {
    return {
      label: `${daysUntilDeadline} j restants`,
      className: "overview-urgency",
    };
  }
  return {
    label: "Sans echeance",
    className: "overview-urgency overview-urgency--muted",
  };
}

export function recordStatusClassName(syncStatus) {
  if (syncStatus === "deleted") return "status-pill status-pill--danger";
  if (syncStatus === "superseded") return "status-pill status-pill--warning";
  if (
    syncStatus === "synced" ||
    syncStatus === "sync_pending" ||
    syncStatus === "syncing"
  ) {
    return "status-pill status-pill--success";
  }
  if (syncStatus === "sync_failed") return "status-pill status-pill--danger";
  return "status-pill status-pill--info";
}

export function recordStatusLabel(syncStatus) {
  if (syncStatus === "deleted") return "Supprime";
  if (syncStatus === "superseded") return "Remplace";
  if (
    syncStatus === "synced" ||
    syncStatus === "sync_pending" ||
    syncStatus === "syncing"
  ) {
    return "Depose";
  }
  if (syncStatus === "sync_failed") return "Erreur";
  return syncStatus || "n.c.";
}
