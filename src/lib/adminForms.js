import { DEFAULT_EXPECTED_DOCUMENTS } from "./adminConstants.js";

export function createEmptyProjectForm(defaultFolderPath = "") {
  return {
    id: "",
    name: "",
    dossierId: "",
    folderPath: defaultFolderPath,
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
    folderPath: project.folderPath || "",
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
