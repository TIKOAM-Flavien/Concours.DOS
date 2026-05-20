export const INVITATION_STATUSES = Object.freeze([
  "generated",
  "sent",
  "expired",
  "reissued",
]);

export const INVITATION_STATUS_LABELS = Object.freeze({
  generated: "Generee",
  sent: "Envoyee",
  expired: "Expiree",
  reissued: "Reemise",
});

export function isInvitationStatus(value) {
  return INVITATION_STATUSES.includes(String(value || "").trim());
}

export function invitationStatusLabel(status) {
  return INVITATION_STATUS_LABELS[status] || status || "-";
}
