/**
 * Pure helpers shared by the admin dashboard (no React dependencies).
 */

export function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * @param {{ title?: string, expectedText?: string, confirmLabel?: string }} options
 * @returns {boolean}
 */
export function confirmByTyping({ title, expectedText, confirmLabel = "SUPPRIMER" } = {}) {
  const expected = String(expectedText || "").trim();
  if (!expected) return false;

  const message = [
    title || "Action destructive",
    "",
    "Pour confirmer, saisissez exactement :",
    expected,
    "",
    `Ou tapez "${confirmLabel}" pour annuler.`,
  ].join("\n");

  const input = window.prompt(message, "");
  if (input == null) return false;
  const typed = String(input).trim();
  if (typed.toUpperCase() === String(confirmLabel || "").toUpperCase()) return false;
  return typed === expected;
}

export function uniqueSuffix() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().slice(0, 8);
  }
  return Date.now().toString(36);
}

export function dedupe(values) {
  return Array.from(
    new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))
  );
}

export function hydrateExpectedDocuments(expectedDocumentIds, customDocuments) {
  const customById = new Map(
    (customDocuments || [])
      .filter((doc) => doc && typeof doc === "object" && doc.id)
      .map((doc) => [doc.id, doc])
  );
  return (expectedDocumentIds || []).map((id) => customById.get(id) || id);
}

export function buildProjectId(projectForm) {
  const base = slugify(projectForm.dossierId || projectForm.name);
  return base ? `project-${base}` : `project-${uniqueSuffix()}`;
}

export function buildCompanyId(companyForm) {
  const base = slugify(companyForm.companyId || companyForm.companyName).toUpperCase();
  return base ? `ENT-${base}` : `ENT-${uniqueSuffix().toUpperCase()}`;
}

export function buildSubmissionId(project, company) {
  const projectToken = slugify(project.dossierId || project.name).slice(0, 20) || "projet";
  const companyToken =
    slugify(company.companyId || company.companyName).slice(0, 20) || "entreprise";
  return `inv-${projectToken}-${companyToken}`;
}

export function directoryKey(company) {
  return String(
    company?.companyId || company?.companyEmail || company?.companyName || ""
  )
    .trim()
    .toLowerCase();
}

export function matchCompanyRecords(company, records) {
  return records.filter((record) => {
    if (company.submissionId && record.submissionId) {
      return normalizeKey(record.submissionId) === normalizeKey(company.submissionId);
    }
    if (company.companyId && record.companyId) {
      return normalizeKey(record.companyId) === normalizeKey(company.companyId);
    }
    return normalizeKey(record.companyName) === normalizeKey(company.companyName);
  });
}
