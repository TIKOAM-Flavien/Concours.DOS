import { DEFAULT_EXPECTED_DOCUMENTS } from "./adminConstants.js";

export function createEmptyProjectForm() {
  return {
    id: "",
    name: "",
    dossierId: "",
    deadline: "",
    customDocumentsText: "",
  };
}

export function createEmptyCompanyForm() {
  return {
    id: "",
    companyName: "",
    companyId: "",
    contactName: "",
    companyEmail: "",
    submissionId: "",
    expectedDocuments: [...DEFAULT_EXPECTED_DOCUMENTS],
  };
}

export function toProjectForm(project) {
  return {
    id: project.id,
    name: project.name || "",
    dossierId: project.dossierId || "",
    deadline: project.deadline || "",
    customDocumentsText: Array.isArray(project.customDocuments)
      ? project.customDocuments
          .map((doc) => String(doc?.label || "").trim())
          .filter(Boolean)
          .join("\n")
      : "",
  };
}

export function toCompanyForm(company) {
  return {
    id: company.id,
    companyName: company.companyName || "",
    companyId: company.companyId || "",
    contactName: company.contactName || "",
    companyEmail: company.companyEmail || "",
    submissionId: company.submissionId || "",
    expectedDocuments: [...(company.expectedDocuments || [])],
  };
}
