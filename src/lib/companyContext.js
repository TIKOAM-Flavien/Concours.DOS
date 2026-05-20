// @ts-check
// Helpers around the company/contact data that the portal renders in its
// header. Pulled out of App.jsx so the main component file stays focused on
// orchestration.

/** @param {unknown} value */
export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

export function getMailtoHref(value) {
  const email = String(value || "").trim();
  return isValidEmail(email) ? `mailto:${email}` : "";
}

export function getSecureWebsiteUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function buildCompanyFacts(context, trustedContext) {
  if (!trustedContext) {
    return [
      { label: "Mode d'acces", value: "Invitation signee requise" },
      context.supportEmail ? { label: "Support", value: context.supportEmail } : null,
    ].filter(Boolean);
  }

  return [
    context.companyId ? { label: "Reference entreprise", value: context.companyId } : null,
    context.contactName ? { label: "Contact", value: context.contactName } : null,
    context.companyEmail ? { label: "Email", value: context.companyEmail } : null,
    context.contestName ? { label: "Consultation", value: context.contestName } : null,
  ].filter(Boolean);
}
