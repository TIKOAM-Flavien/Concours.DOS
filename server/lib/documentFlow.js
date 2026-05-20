import { normalizeDocumentId } from "../../src/config/documentCatalog.js";

export function createDocumentFlowHelpers() {
  function buildMetadata(context, document) {
    return {
      projectId: context.projectId,
      dossierId: context.dossierId,
      companyId: context.companyId,
      companyName: context.companyName,
      companyEmail: context.companyEmail,
      contactName: context.contactName,
      contestName: context.contestName,
      deadline: context.deadline,
      submissionId: context.submissionId,
      documentType: document.id,
      documentLabel: document.label,
      source: "client-portal",
    };
  }

  function documentRecordToFlowRow(record) {
    const filePath = `local:${record.id}`;
    const fileIdentifier = record.id;
    const modifiedAt =
      record.uploadedAt || record.receivedAt || record.updatedAt || record.createdAt || "";
    const hasLocalFile = Boolean(record.storagePath);
    const rawStatus = record.status;
    const syncStatus =
      hasLocalFile && ["sync_pending", "syncing", "sync_failed"].includes(rawStatus)
        ? "synced"
        : rawStatus;

    return {
      localRecordId: record.id,
      localJobId: record.jobId || "",
      isLocalRecord: true,
      syncStatus,
      SyncStatus: syncStatus,
      syncError: syncStatus === "synced" ? "" : record.errorMessage || "",
      errorMessage: syncStatus === "synced" ? "" : record.errorMessage || "",
      fileName: record.fileName,
      Name_extension: record.fileName,
      FileLeafRef: record.fileName,
      Name: record.fileName,
      filePath,
      ServerRelativeUrl: filePath,
      FileRef: filePath,
      fileIdentifier,
      Identifier: fileIdentifier,
      Link: "",
      webUrl: "",
      Modified: modifiedAt,
      LastModified: modifiedAt,
      Size: record.sizeBytes || 0,
      Length: record.sizeBytes || 0,
      Type_piece: record.documentType,
      DocumentType: record.documentType,
      documentType: record.documentType,
      documentLabel: record.documentLabel,
      reviewStatus: record.reviewStatus || "pending",
      reviewedAt: record.reviewedAt || "",
      reviewComment: record.reviewComment || "",
      reviewedBy: record.reviewedBy || "",
      CompanyId: record.companyId,
      companyId: record.companyId,
      Entreprise_depot: record.companyName,
      CompanyName: record.companyName,
      companyName: record.companyName,
      SubmissionId: record.submissionId,
      submissionId: record.submissionId,
      Projet: record.dossierId,
      dossierId: record.dossierId,
    };
  }

  function recordsToFlowRows(records) {
    return (records || []).map(documentRecordToFlowRow);
  }

  function normalizeLookupKey(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function readObjectPathValue(source, path) {
    return String(path || "")
      .split(".")
      .reduce((current, segment) => (current == null ? null : current[segment]), source);
  }

  function readRecordField(row, candidates) {
    const record = row || {};
    const keys = Object.keys(record);
    const lookup = new Map(keys.map((key) => [normalizeLookupKey(key), key]));

    for (const candidate of candidates) {
      const directValue = candidate.includes(".")
        ? readObjectPathValue(record, candidate)
        : record[candidate];
      if (directValue != null && String(directValue).trim() !== "") {
        return String(directValue).trim();
      }

      if (candidate.includes(".")) continue;

      const mappedKey = lookup.get(normalizeLookupKey(candidate));
      if (!mappedKey) continue;

      const mappedValue = record[mappedKey];
      if (mappedValue != null && String(mappedValue).trim() !== "") {
        return String(mappedValue).trim();
      }
    }

    return "";
  }

  function localRecordMatchesInvitation(record, invitation) {
    if (!record || record.status === "deleted" || record.status === "superseded") {
      return false;
    }
    if (record.dossierId !== invitation.dossierId) return false;
    if (invitation.projectId && record.projectId && record.projectId !== invitation.projectId) {
      return false;
    }
    if (invitation.submissionId && record.submissionId) {
      return record.submissionId === invitation.submissionId;
    }
    if (invitation.companyId && record.companyId) {
      return record.companyId === invitation.companyId;
    }
    return normalizeLookupKey(record.companyName) === normalizeLookupKey(invitation.companyName);
  }

  function matchCompanyRow(row, company) {
    const rowSubmission = normalizeLookupKey(
      readRecordField(row, [
        "SubmissionId",
        "submissionId",
        "SubmissionToken",
        "JetonDepot",
        "Token",
      ])
    );
    const companySubmission = normalizeLookupKey(company.submissionId);
    if (companySubmission && rowSubmission) {
      return rowSubmission === companySubmission;
    }

    const rowCompanyId = normalizeLookupKey(
      readRecordField(row, [
        "CompanyId",
        "companyId",
        "EntrepriseId",
        "SocieteId",
        "VendorId",
      ])
    );
    const companyCompanyId = normalizeLookupKey(company.companyId);
    if (companyCompanyId && rowCompanyId) {
      return rowCompanyId === companyCompanyId;
    }

    const rowCompanyName = normalizeLookupKey(
      readRecordField(row, [
        "Entreprise_depot",
        "CompanyName",
        "companyName",
        "Entreprise",
        "Societe",
        "VendorName",
      ])
    );
    return normalizeLookupKey(company.companyName) === rowCompanyName;
  }

  function readRowDocumentType(row) {
    return normalizeDocumentId(
      readRecordField(row, [
        "DocumentType",
        "Type_piece",
        "type_piece",
        "documentType",
        "documentId",
      ])
    );
  }

  function readRowModifiedAt(row) {
    return readRecordField(row, [
      "Modified",
      "TimeLastModified",
      "LastModified",
      "modifiedAt",
      "date",
    ]);
  }

  function buildProjectOverviewBase(project) {
    const companies = Array.isArray(project.companies) ? project.companies : [];
    const expectedCount = companies.reduce(
      (sum, company) =>
        sum +
        (Array.isArray(company.expectedDocuments) ? company.expectedDocuments.length : 0),
      0
    );
    return {
      id: project.id,
      name: project.name || "",
      dossierId: project.dossierId || "",
      folderPath: project.folderPath || "",
      deadline: project.deadline || "",
      companyCount: companies.length,
      expectedCount,
    };
  }

  function buildProjectOverview(project, rows) {
    const base = buildProjectOverviewBase(project);
    const companies = Array.isArray(project.companies) ? project.companies : [];
    let receivedCount = 0;
    let completeCompanies = 0;
    let incompleteCompanies = 0;
    let lastReceptionAt = "";
    let lastReceptionTime = 0;

    for (const company of companies) {
      const expected = Array.isArray(company.expectedDocuments)
        ? company.expectedDocuments
        : [];
      const companyRows = rows.filter((row) => matchCompanyRow(row, company));
      const presentTypes = new Set(companyRows.map(readRowDocumentType).filter(Boolean));
      const received = expected.filter((id) => presentTypes.has(id)).length;
      receivedCount += received;

      if (expected.length > 0 && received >= expected.length) {
        completeCompanies += 1;
      } else if (expected.length > 0) {
        incompleteCompanies += 1;
      }

      for (const row of companyRows) {
        const modified = readRowModifiedAt(row);
        const modifiedTime = Date.parse(modified || "") || 0;
        if (modified && modifiedTime >= lastReceptionTime) {
          lastReceptionAt = modified;
          lastReceptionTime = modifiedTime;
        }
      }
    }

    const completionRate =
      base.expectedCount > 0 ? Math.round((receivedCount / base.expectedCount) * 100) : 0;
    const statusKey =
      base.expectedCount === 0
        ? "empty"
        : completionRate >= 100
        ? "complete"
        : completionRate >= 80
        ? "almost"
        : completionRate > 0
        ? "progress"
        : "todo";

    return {
      ...base,
      receivedCount,
      completionRate,
      statusKey,
      completeCompanies,
      incompleteCompanies,
      lastReceptionAt,
      syncError: "",
    };
  }

  return {
    buildMetadata,
    documentRecordToFlowRow,
    recordsToFlowRows,
    normalizeLookupKey,
    readRecordField,
    localRecordMatchesInvitation,
    matchCompanyRow,
    readRowDocumentType,
    readRowModifiedAt,
    buildProjectOverviewBase,
    buildProjectOverview,
  };
}
