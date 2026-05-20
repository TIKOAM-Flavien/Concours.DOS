import { resolveDocumentList } from "../config/documentCatalog.js";
import { hydrateExpectedDocuments, matchCompanyRecords, normalizeKey } from "./adminUtils.js";
import { buildDocumentState } from "./documentRecords.js";

export function buildCompanyTracking({
  selectedProject,
  selectedProjectCustomDocs = [],
  records = [],
}) {
  if (!selectedProject) return [];

  return (selectedProject.companies || [])
    .map((company) => {
      const expectedDocuments = resolveDocumentList(
        hydrateExpectedDocuments(company.expectedDocuments, selectedProjectCustomDocs)
      );
      const companyRecords = matchCompanyRecords(company, records);
      const documentState = buildDocumentState(expectedDocuments, companyRecords);
      const receivedCount = documentState.filter((item) => item.latest).length;
      const expectedCount = expectedDocuments.length;
      const missingLabels = documentState
        .filter((item) => !item.latest)
        .map((item) => item.document.label);
      const lastRecord = companyRecords[0] || null;
      let status = "A demarrer";
      let statusKey = "todo";

      if (expectedCount > 0 && receivedCount === expectedCount) {
        status = "Complet";
        statusKey = "complete";
      } else if (receivedCount > 0) {
        status = "En cours";
        statusKey = "progress";
      }

      return {
        ...company,
        expectedCount,
        receivedCount,
        status,
        statusKey,
        completionRate: expectedCount ? Math.round((receivedCount / expectedCount) * 100) : 0,
        documentState,
        missingSummary: missingLabels.length ? missingLabels.join(", ") : "Aucune",
        lastReceptionAt: lastRecord?.modifiedAt || "",
      };
    })
    .sort((left, right) => left.companyName.localeCompare(right.companyName));
}

export function filterCompanyTracking(companyTracking, filters = {}) {
  const {
    trackingSearch = "",
    trackingStatusFilter = "all",
    trackingDocumentFilter = "all",
    trackingDocumentStateFilter = "all",
    trackingOnlyMissing = false,
  } = filters;
  const searchNeedle = normalizeKey(trackingSearch);

  return (companyTracking || []).filter((company) => {
    const searchableFields = [
      company.companyName,
      company.companyId,
      company.contactName,
      company.companyEmail,
      company.submissionId,
      company.missingSummary,
    ];
    const matchesSearch =
      !searchNeedle ||
      searchableFields.some((value) => normalizeKey(value).includes(searchNeedle));
    const matchesStatus =
      trackingStatusFilter === "all" || company.statusKey === trackingStatusFilter;
    const matchesMissing =
      !trackingOnlyMissing || company.receivedCount < company.expectedCount;

    if (trackingDocumentFilter === "all") {
      return matchesSearch && matchesStatus && matchesMissing;
    }

    const trackedDocument = company.documentState.find(
      (item) => item.document.id === trackingDocumentFilter
    );
    if (!trackedDocument) return false;

    const matchesDocumentState =
      trackingDocumentStateFilter === "all" ||
      (trackingDocumentStateFilter === "received" && Boolean(trackedDocument.latest)) ||
      (trackingDocumentStateFilter === "missing" && !trackedDocument.latest);

    return matchesSearch && matchesStatus && matchesMissing && matchesDocumentState;
  });
}

export function buildFilteredTrackingSummary(filteredCompanyTracking) {
  return {
    total: filteredCompanyTracking.length,
    complete: filteredCompanyTracking.filter((company) => company.statusKey === "complete")
      .length,
    progress: filteredCompanyTracking.filter((company) => company.statusKey === "progress")
      .length,
    todo: filteredCompanyTracking.filter((company) => company.statusKey === "todo").length,
  };
}

export function hasActiveTrackingFilters(filters = {}) {
  const {
    trackingSearch = "",
    trackingStatusFilter = "all",
    trackingDocumentFilter = "all",
    trackingDocumentStateFilter = "all",
    trackingOnlyMissing = false,
  } = filters;
  return (
    Boolean(String(trackingSearch).trim()) ||
    trackingStatusFilter !== "all" ||
    trackingDocumentFilter !== "all" ||
    trackingDocumentStateFilter !== "all" ||
    trackingOnlyMissing
  );
}
