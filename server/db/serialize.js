import { createHash } from "node:crypto";

export function parseJsonArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return fallback;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function parseJsonObject(value, fallback = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (Array.isArray(value)) return fallback;
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : fallback;
  } catch {
    return fallback;
  }
}

export function stableJson(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

export function sha256Hex(input) {
  return createHash("sha256").update(String(input || ""), "utf8").digest("hex");
}

export function cleanScope(value) {
  return String(value || "").trim();
}

export function normalizeRecordScope(scope = {}) {
  return {
    projectId: cleanScope(scope.projectId),
    dossierId: cleanScope(scope.dossierId),
    companyId: cleanScope(scope.companyId),
    companyName: cleanScope(scope.companyName),
    submissionId: cleanScope(scope.submissionId),
  };
}

export function toBudgetDay(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

export function rowToIso(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function serializeCompany(row) {
  if (!row) return null;
  return {
    ...row,
    createdAt: rowToIso(row.createdAt),
    updatedAt: rowToIso(row.updatedAt),
    expectedDocuments: parseJsonArray(row.expectedDocuments, []),
  };
}

export function serializeProject(row) {
  if (!row) return null;
  return {
    ...row,
    archivedAt: row.archivedAt || "",
    createdAt: rowToIso(row.createdAt),
    updatedAt: rowToIso(row.updatedAt),
    customDocuments: parseJsonArray(row.customDocuments, []),
  };
}

export function serializeDocumentRecord(row) {
  if (!row) return null;
  return {
    ...row,
    sizeBytes: Number(row.sizeBytes) || 0,
    createdAt: rowToIso(row.createdAt),
    updatedAt: rowToIso(row.updatedAt),
    flowResult: parseJsonObject(row.flowResult, {}),
  };
}

export function serializeDocumentUploadJob(row) {
  if (!row) return null;
  return {
    ...row,
    attempts: Number(row.attempts) || 0,
    maxAttempts: Number(row.maxAttempts) || 0,
    sizeBytes: Number(row.sizeBytes) || 0,
    createdAt: rowToIso(row.createdAt),
    updatedAt: rowToIso(row.updatedAt),
    payload: parseJsonObject(row.payload, {}),
    flowResult: parseJsonObject(row.flowResult, {}),
  };
}

export function addRetentionDate({ now = new Date(), retentionDays = 14 } = {}) {
  const days = Math.max(0, Number(retentionDays) || 0);
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}
