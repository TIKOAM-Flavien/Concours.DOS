export function activityToneClassName(tone) {
  const value = String(tone || "neutral").trim();
  if (value === "success") return "activity-pill activity-pill--success";
  if (value === "warning") return "activity-pill activity-pill--warning";
  if (value === "info") return "activity-pill activity-pill--info";
  return "activity-pill activity-pill--neutral";
}

export function activityKindLabel(kind) {
  const value = String(kind || "").trim();
  if (value === "deposit") return "Depot";
  if (value === "review") return "Validation";
  if (value === "email") return "Courriel";
  if (value === "portal") return "Portail";
  if (value === "admin") return "Admin";
  return "Evenement";
}
