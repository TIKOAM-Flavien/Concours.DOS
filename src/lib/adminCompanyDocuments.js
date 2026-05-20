import { CUSTOM_DOC_CATEGORY } from "./adminConstants.js";
import { directoryKey, normalizeKey } from "./adminUtils.js";

export function buildCompanyDocumentOptions(catalogOptions, customDocuments) {
  const merged = [...catalogOptions, ...(customDocuments || [])];
  const seen = new Set();
  return merged.filter((doc) => {
    const id = String(doc?.id || "").trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function buildCompanyDocumentGroups(documentOptions, search) {
  const needle = String(search || "").toLowerCase().trim();
  const filtered = needle
    ? documentOptions.filter((doc) => {
        const haystack = `${doc.label || ""} ${doc.category || ""} ${doc.summary || ""}`.toLowerCase();
        return haystack.includes(needle);
      })
    : documentOptions;

  const map = new Map();
  for (const doc of filtered) {
    const category = String(doc.category || "Autres").trim() || "Autres";
    if (!map.has(category)) map.set(category, []);
    map.get(category).push(doc);
  }
  const groups = Array.from(map.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([category, items]) => ({ category, items }));

  if (!needle && !groups.some((group) => group.category === CUSTOM_DOC_CATEGORY)) {
    groups.push({ category: CUSTOM_DOC_CATEGORY, items: [] });
  }
  return groups;
}

export function buildCompanyDirectory(projects) {
  const map = new Map();
  for (const project of projects || []) {
    for (const company of project.companies || []) {
      const key = directoryKey(company);
      if (!key) continue;
      const existing = map.get(key);
      if (existing) {
        existing.usageCount += 1;
        continue;
      }
      map.set(key, {
        key,
        companyId: company.companyId || "",
        companyName: company.companyName || "",
        contactName: company.contactName || "",
        companyEmail: company.companyEmail || "",
        expectedDocuments: Array.isArray(company.expectedDocuments)
          ? company.expectedDocuments
          : [],
        lastProjectId: project.id,
        lastProjectName: project.name || "",
        usageCount: 1,
      });
    }
  }
  return Array.from(map.values()).sort((left, right) =>
    left.companyName.localeCompare(right.companyName, "fr", { sensitivity: "base" })
  );
}

export function filterDirectoryResults(companyDirectory, selectedProject, search) {
  const attachedKeys = new Set((selectedProject?.companies || []).map(directoryKey));
  const decorated = companyDirectory.map((entry) => ({
    ...entry,
    alreadyAttached: attachedKeys.has(entry.key),
  }));
  const needle = normalizeKey(search);
  if (!needle) return decorated;
  return decorated.filter((entry) =>
    [
      entry.companyName,
      entry.companyId,
      entry.contactName,
      entry.companyEmail,
      entry.lastProjectName,
    ].some((value) => normalizeKey(value).includes(needle))
  );
}

export function sumExpectedPieces(projects) {
  return (projects || []).reduce(
    (sum, project) =>
      sum +
      (project.companies || []).reduce(
        (companySum, company) => companySum + (company.expectedDocuments || []).length,
        0
      ),
    0
  );
}

export function countTotalCompanies(projects) {
  return (projects || []).reduce((sum, project) => sum + (project.companies || []).length, 0);
}
