import { randomUUID } from "node:crypto";

import { normalizeDocumentId } from "../../src/config/documentCatalog.js";
import {
  bumpSubmissionDailyUsage,
  createDocumentRecordWithJob,
  completeDocumentUploadJob,
  getActiveDocumentRecordByScope,
  getDocumentRecordById,
  getSubmissionDailyUsage,
  listPurgeableDocumentRecords,
  markDocumentRecordStoragePurged,
} from "../db.js";
import {
  parseMultipartFileUpload,
  removeStoredUploadDir,
} from "../documentFiles.js";
import { publishAdminEvent } from "./realtimeBus.js";

export function createUploadHandlers({
  env,
  maxFileMb,
  submissionDailyBudget,
  uploadStorageConfig,
  forbidden,
  tooManyRequests,
  normalizeTextField,
  normalizeFileName,
  prefixFileNameWithCompany,
  getVerifiedInvitationFromBody,
  ensureProjectAllowsDeposits,
  resolveInvitationDocument,
  buildMetadata,
  documentRecordToFlowRow,
  localRecordMatchesInvitation,
}) {
  async function checkSubmissionDailyBudget(invitation, { cost = 1 } = {}) {
    const submissionId = String(invitation?.submissionId || "").trim();
    if (!submissionId) return { submissionId: "", used: 0, remaining: Infinity };

    const used = await getSubmissionDailyUsage({ submissionId });
    const remaining = submissionDailyBudget - used;
    if (remaining < cost) {
      throw tooManyRequests(
        "Daily submission request budget exceeded. Please try again tomorrow or contact support."
      );
    }
    return { submissionId, used, remaining };
  }

  async function commitSubmissionDailyBudget(invitation, { cost = 1 } = {}) {
    const submissionId = String(invitation?.submissionId || "").trim();
    if (!submissionId) return;
    await bumpSubmissionDailyUsage({ submissionId, delta: cost });
  }

  async function resolveLocalRecordReference({
    invitation,
    fileIdentifier,
    filePath,
    documentId = "",
    requireDocumentType = false,
  }) {
    const normalizedIdentifier = normalizeTextField(fileIdentifier, "fileIdentifier", {
      max: 1000,
    });
    const normalizedPath = normalizeTextField(filePath, "filePath", { max: 1000 });

    let record = normalizedIdentifier ? await getDocumentRecordById(normalizedIdentifier) : null;
    if (!record && normalizedPath.startsWith("local:")) {
      record = await getDocumentRecordById(normalizedPath.slice("local:".length));
    }
    if (!record && documentId) {
      record = await getActiveDocumentRecordByScope({
        projectId: invitation.projectId,
        dossierId: invitation.dossierId,
        companyId: invitation.companyId,
        companyName: invitation.companyName,
        submissionId: invitation.submissionId,
        documentType: documentId,
      });
    }

    if (!record || !localRecordMatchesInvitation(record, invitation)) {
      throw forbidden("local document reference could not be verified.");
    }

    if (requireDocumentType) {
      const expected = normalizeDocumentId(documentId);
      const actual = normalizeDocumentId(record.documentType);
      if (!expected || actual !== expected) {
        throw forbidden(`documentId mismatch: expected ${expected} but file is ${actual}.`);
      }
    }

    return record;
  }

  async function queueDocumentUploadFromMultipart(req, operation) {
    const recordId = randomUUID();
    const jobId = randomUUID();
    let parsed = null;

    try {
      parsed = await parseMultipartFileUpload(req, {
        uploadId: recordId,
        maxFileBytes: maxFileMb * 1024 * 1024,
        env,
      });

      const invitation = await getVerifiedInvitationFromBody(parsed.fields);
      const project = await ensureProjectAllowsDeposits(invitation);
      await checkSubmissionDailyBudget(invitation, { cost: 2 });

      const document = resolveInvitationDocument(invitation, parsed.fields?.documentId);
      const previousRecord =
        operation === "update"
          ? await resolveLocalRecordReference({
              invitation,
              fileIdentifier: parsed.fields?.fileIdentifier,
              filePath: parsed.fields?.filePath,
              documentId: document.id,
              requireDocumentType: true,
            })
          : null;
      const effectiveOperation =
        operation === "update" && previousRecord ? "update" : "upload";
      const fileName = prefixFileNameWithCompany(
        normalizeFileName(parsed.file.originalFileName),
        invitation.companyName
      );
      const metadata = buildMetadata(
        {
          ...invitation,
          projectId: invitation.projectId || project?.id || "",
        },
        document
      );
      const payload = {
        ...metadata,
        metadata,
        localRecordId: recordId,
      };

      if (effectiveOperation === "update" && previousRecord) {
        payload.previousRecordId = previousRecord.id;
      }

      await createDocumentRecordWithJob({
        retentionDays: uploadStorageConfig.retentionDays,
        record: {
          id: recordId,
          projectId: invitation.projectId || project?.id || "",
          dossierId: invitation.dossierId,
          folderPath: invitation.folderPath,
          companyId: invitation.companyId,
          companyName: invitation.companyName,
          companyEmail: invitation.companyEmail,
          contactName: invitation.contactName,
          submissionId: invitation.submissionId,
          contestName: invitation.contestName,
          documentType: document.id,
          documentLabel: document.label,
          operation: effectiveOperation,
          originalFileName: parsed.file.originalFileName,
          fileName,
          mimeType: parsed.file.mimeType,
          storagePath: parsed.file.storagePath,
          sizeBytes: parsed.file.sizeBytes,
          sha256: parsed.file.sha256,
        },
        job: {
          id: jobId,
          operation: effectiveOperation,
          maxAttempts: uploadStorageConfig.jobMaxAttempts,
          payload,
        },
      });
      await completeDocumentUploadJob({
        jobId,
        flowResult: { ok: true, localOnly: true },
      });
      await commitSubmissionDailyBudget(invitation, { cost: 2 });

      const record = await getDocumentRecordById(recordId);

      // Notify all live admin tabs that this project's documents changed.
      // Cross-process via PG NOTIFY — the admin container picks it up even
      // though this code runs in the portal container.
      publishAdminEvent({
        type: "admin.invalidate",
        scope: "documents",
        projectId: record?.projectId || invitation.projectId || project?.id || "",
        companyId: record?.companyId || invitation.companyId || "",
        operation: effectiveOperation,
      });

      return {
        ok: true,
        record: documentRecordToFlowRow(record),
        job: {
          id: jobId,
          operation: effectiveOperation,
          status: "uploaded",
          documentId: document.id,
          fileName,
          sizeBytes: parsed.file.sizeBytes,
          sha256: parsed.file.sha256,
          createdAt: record?.createdAt || "",
        },
      };
    } catch (error) {
      if (parsed) {
        await removeStoredUploadDir(recordId, env).catch(() => {});
      }
      throw error;
    }
  }

  async function purgeExpiredLocalDocumentFiles() {
    const records = await listPurgeableDocumentRecords();
    let removed = 0;
    const errors = [];

    for (const record of records) {
      try {
        await removeStoredUploadDir(record.id, env);
        await markDocumentRecordStoragePurged(record.id);
        removed += 1;
      } catch (error) {
        errors.push({
          id: record.id,
          error: error?.message || String(error),
        });
      }
    }

    return { ok: errors.length === 0, removed, errors };
  }

  return {
    checkSubmissionDailyBudget,
    commitSubmissionDailyBudget,
    resolveLocalRecordReference,
    queueDocumentUploadFromMultipart,
    purgeExpiredLocalDocumentFiles,
  };
}
