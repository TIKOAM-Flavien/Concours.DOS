import { normalizeDocumentId } from "../config/documentCatalog";

const FIELD_CANDIDATES = {
  name: [
    "Name_extension",
    "FilenameWithExtension",
    "FileLeafRef",
    "LeafRef",
    "Name",
    "fileName",
    "Title",
  ],
  path: [
    "ServerRelativeUrl",
    "Path",
    "FileRef",
    "RelativeUrl",
    "DecodedUrl",
    "ServerRelativePath.DecodedUrl",
    "filePath",
  ],
  identifier: [
    "Identifier",
    "identifier",
    "UniqueId",
    "FileIdentifier",
    "DriveItemId",
    "FileId",
    "ID",
    "Id",
  ],
  link: [
    "Link",
    "sharePointUrl",
    "SharePointUrl",
    "webUrl",
    "EncodedAbsUrl",
    "AbsoluteUri",
  ],
  modifiedAt: ["Modified", "TimeLastModified", "LastModified", "date"],
  sizeBytes: ["Length", "Size", "size", "File_x0020_Size"],
  documentType: [
    "Type_piece",
    "DocumentType",
    "documentType",
    "DocumentLabel",
    "documentLabel",
    "TypePiece",
    "TypeDePiece",
    "PieceTag",
    "PieceCode",
    "DocumentCode",
    "Category",
  ],
  companyId: [
    "CompanyId",
    "companyId",
    "EntrepriseId",
    "SocieteId",
    "VendorId",
  ],
  companyName: [
    "Entreprise_depot",
    "CompanyName",
    "companyName",
    "Entreprise",
    "Societe",
    "VendorName",
  ],
  submissionId: [
    "SubmissionId",
    "submissionId",
    "SubmissionToken",
    "JetonDepot",
    "Token",
  ],
  dossierId: [
    "Projet",
    "DossierId",
    "dossierId",
    "ProjectId",
    "Dossier",
  ],
  localRecordId: ["localRecordId", "recordId"],
  localJobId: ["localJobId", "jobId"],
  syncStatus: ["SyncStatus", "syncStatus", "status"],
  syncError: ["syncError", "errorMessage", "ErrorMessage"],
};

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function readValue(row, candidate) {
  if (!candidate) return null;

  if (candidate.includes(".")) {
    return candidate
      .split(".")
      .reduce((current, part) => (current == null ? null : current[part]), row);
  }

  return row[candidate];
}

function readFirstMatch(row, candidates) {
  const keys = Object.keys(row || {});
  const keyMap = new Map(keys.map((key) => [normalizeKey(key), key]));

  for (const candidate of candidates) {
    const direct = readValue(row, candidate);
    if (direct != null && String(direct).trim() !== "") return direct;

    const mappedKey = keyMap.get(normalizeKey(candidate));
    if (mappedKey) {
      const value = row[mappedKey];
      if (value != null && String(value).trim() !== "") return value;
    }
  }

  return null;
}

function matchesContext(record, context) {
  const normalizedSubmission = normalizeKey(context.submissionId);
  if (normalizedSubmission && record.submissionId) {
    return normalizeKey(record.submissionId) === normalizedSubmission;
  }

  const normalizedCompanyId = normalizeKey(context.companyId);
  if (normalizedCompanyId && record.companyId) {
    return normalizeKey(record.companyId) === normalizedCompanyId;
  }

  const normalizedCompanyName = normalizeKey(context.companyName);
  if (normalizedCompanyName && record.companyName) {
    return normalizeKey(record.companyName) === normalizedCompanyName;
  }

  return true;
}

function resolveDocumentType(rawValue, documents) {
  const candidate = normalizeDocumentId(rawValue);
  if (!candidate) return "";

  const directMatch = documents.find((document) => document.id === candidate);
  if (directMatch) return directMatch.id;

  const labelMatch = documents.find(
    (document) => normalizeDocumentId(document.label) === candidate
  );
  if (labelMatch) return labelMatch.id;

  return candidate;
}

function resolveDocumentTypeFromFileName(fileName, documents) {
  const normalizedName = normalizeDocumentId(fileName);
  if (!normalizedName) return "";

  const idMatch = documents.find((document) => normalizedName.includes(document.id));
  if (idMatch) return idMatch.id;

  const labelMatch = documents.find((document) =>
    normalizedName.includes(normalizeDocumentId(document.label))
  );
  return labelMatch ? labelMatch.id : "";
}

function fallbackFileName(filePath) {
  const segments = String(filePath || "")
    .split("/")
    .filter(Boolean);
  if (!segments.length) return "";

  try {
    return decodeURIComponent(segments[segments.length - 1]);
  } catch {
    return segments[segments.length - 1];
  }
}

function buildRecord(row, index, documents) {
  const filePath = String(readFirstMatch(row, FIELD_CANDIDATES.path) || "").trim();
  const fileName = String(readFirstMatch(row, FIELD_CANDIDATES.name) || "").trim();
  const displayFileName = fileName || fallbackFileName(filePath);
  const documentType =
    resolveDocumentType(readFirstMatch(row, FIELD_CANDIDATES.documentType), documents) ||
    resolveDocumentTypeFromFileName(displayFileName, documents);

  return {
    key:
      String(readFirstMatch(row, FIELD_CANDIDATES.identifier) || "").trim() ||
      filePath ||
      `${index}`,
    raw: row,
    fileName: displayFileName,
    filePath,
    fileIdentifier: String(
      readFirstMatch(row, FIELD_CANDIDATES.identifier) || ""
    ).trim(),
    link: String(readFirstMatch(row, FIELD_CANDIDATES.link) || "").trim(),
    modifiedAt: String(
      readFirstMatch(row, FIELD_CANDIDATES.modifiedAt) || ""
    ).trim(),
    sizeBytes: Number(readFirstMatch(row, FIELD_CANDIDATES.sizeBytes) || 0),
    documentType,
    companyId: String(readFirstMatch(row, FIELD_CANDIDATES.companyId) || "").trim(),
    companyName: String(
      readFirstMatch(row, FIELD_CANDIDATES.companyName) || ""
    ).trim(),
    submissionId: String(
      readFirstMatch(row, FIELD_CANDIDATES.submissionId) || ""
    ).trim(),
    dossierId: String(
      readFirstMatch(row, FIELD_CANDIDATES.dossierId) || ""
    ).trim(),
    localRecordId: String(
      readFirstMatch(row, FIELD_CANDIDATES.localRecordId) || ""
    ).trim(),
    localJobId: String(
      readFirstMatch(row, FIELD_CANDIDATES.localJobId) || ""
    ).trim(),
    syncStatus: String(
      readFirstMatch(row, FIELD_CANDIDATES.syncStatus) || ""
    ).trim(),
    syncError: String(
      readFirstMatch(row, FIELD_CANDIDATES.syncError) || ""
    ).trim(),
  };
}

function sortByModifiedDescending(left, right) {
  const leftDate = Date.parse(left.modifiedAt || "") || 0;
  const rightDate = Date.parse(right.modifiedAt || "") || 0;
  return rightDate - leftDate;
}

export function normalizeSharePointRecords(rows, context) {
  return (rows || [])
    .map((row, index) => buildRecord(row, index, context.documents))
    .filter((record) => matchesContext(record, context))
    .sort(sortByModifiedDescending);
}

export function buildDocumentState(documents, records) {
  return documents.map((document) => {
    const matches = records.filter((record) => record.documentType === document.id);
    return {
      document,
      matches,
      latest: matches[0] || null,
    };
  });
}

export function inspectMetadataCoverage(records) {
  return {
    hasDocumentType: records.some((record) => Boolean(record.documentType)),
    hasCompanyScope: records.some(
      (record) => Boolean(record.companyId || record.companyName)
    ),
    hasSubmissionScope: records.some((record) => Boolean(record.submissionId)),
  };
}
