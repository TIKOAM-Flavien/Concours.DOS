import { getPool } from "../pool.js";
import {
  addRetentionDate,
  cleanScope,
  normalizeRecordScope,
  serializeDocumentRecord,
  serializeDocumentUploadJob,
  stableJson,
} from "../serialize.js";

const LIST_PROJECT_RECORDS_SQL = `
  SELECT *
  FROM document_records
  WHERE status NOT IN ('deleted', 'superseded')
    AND (
      ($1 <> '' AND ("projectId" = $1 OR ("projectId" = '' AND "dossierId" = $2)))
      OR ($1 = '' AND "dossierId" = $2)
    )
    AND ($3 = '' OR "companyId" = $3)
    AND ($4 = '' OR lower("companyName") = lower($4))
    AND ($5 = '' OR "submissionId" = $5)
  ORDER BY "updatedAt" DESC
`;

const LIST_PROJECT_RECORDS_WITH_HISTORY_SQL = `
  SELECT *
  FROM document_records
  WHERE (
      ($1 <> '' AND ("projectId" = $1 OR ("projectId" = '' AND "dossierId" = $2)))
      OR ($1 = '' AND "dossierId" = $2)
    )
    AND ($3 = '' OR "companyId" = $3)
    AND ($4 = '' OR lower("companyName") = lower($4))
    AND ($5 = '' OR "submissionId" = $5)
  ORDER BY "updatedAt" DESC
`;

const LIST_INVITATION_RECORDS_SQL = `
  SELECT *
  FROM document_records
  WHERE status NOT IN ('deleted', 'superseded')
    AND "dossierId" = $1
    AND ($2 = '' OR "projectId" = $2 OR "projectId" = '')
    AND (
      ($3 <> '' AND "submissionId" = $3)
      OR ($4 <> '' AND "companyId" = $4)
      OR ($5 <> '' AND lower("companyName") = lower($5))
    )
  ORDER BY "updatedAt" DESC
`;

export async function listDocumentRecordsForProject(scope = {}) {
  const normalized = normalizeRecordScope(scope);
  const pool = getPool();
  const result = await pool.query(LIST_PROJECT_RECORDS_SQL, [
    normalized.projectId,
    normalized.dossierId,
    normalized.companyId,
    normalized.companyName,
    normalized.submissionId,
  ]);
  return result.rows.map(serializeDocumentRecord);
}

export async function listDocumentRecordsForProjectWithHistory(scope = {}) {
  const normalized = normalizeRecordScope(scope);
  const pool = getPool();
  const result = await pool.query(LIST_PROJECT_RECORDS_WITH_HISTORY_SQL, [
    normalized.projectId,
    normalized.dossierId,
    normalized.companyId,
    normalized.companyName,
    normalized.submissionId,
  ]);
  return result.rows.map(serializeDocumentRecord);
}

export async function listDocumentRecordsForInvitation(scope = {}) {
  const normalized = normalizeRecordScope(scope);
  if (!normalized.dossierId) return [];
  if (!normalized.submissionId && !normalized.companyId && !normalized.companyName) {
    return [];
  }
  const pool = getPool();
  const result = await pool.query(LIST_INVITATION_RECORDS_SQL, [
    normalized.dossierId,
    normalized.projectId,
    normalized.submissionId,
    normalized.companyId,
    normalized.companyName,
  ]);
  return result.rows.map(serializeDocumentRecord);
}

export async function sumStoredDocumentBytes() {
  const pool = getPool();
  const result = await pool.query(
    `SELECT COALESCE(SUM("sizeBytes"), 0) AS bytes
     FROM document_records
     WHERE status NOT IN ('deleted', 'superseded')
       AND "storagePath" IS NOT NULL
       AND "storagePath" <> ''`
  );
  return Number(result.rows[0]?.bytes) || 0;
}

export async function getDocumentRecordById(id) {
  const pool = getPool();
  const result = await pool.query("SELECT * FROM document_records WHERE id = $1", [id]);
  return serializeDocumentRecord(result.rows[0]);
}

export async function getActiveDocumentRecordByScope(scope = {}) {
  const normalized = normalizeRecordScope(scope);
  if (!normalized.dossierId || !scope.documentType) return null;
  const pool = getPool();
  const result = await pool.query(
    `SELECT *
     FROM document_records
     WHERE status NOT IN ('deleted', 'superseded')
       AND "dossierId" = $1
       AND ($2 = '' OR "projectId" = $2 OR "projectId" = '')
       AND "documentType" = $3
       AND (
         ($4 <> '' AND "submissionId" = $4)
         OR ($5 <> '' AND "companyId" = $5)
         OR ($6 <> '' AND lower("companyName") = lower($6))
       )
     ORDER BY "updatedAt" DESC
     LIMIT 1`,
    [
      normalized.dossierId,
      normalized.projectId,
      cleanScope(scope.documentType),
      normalized.submissionId,
      normalized.companyId,
      normalized.companyName,
    ]
  );
  return serializeDocumentRecord(result.rows[0]);
}

export async function markDocumentRecordDeleted(id, deletedAt = new Date().toISOString()) {
  const pool = getPool();
  await pool.query(
    `UPDATE document_records
     SET status = 'deleted',
         "deletedAt" = $2::text,
         "updatedAt" = $3::timestamptz
     WHERE id = $1`,
    [cleanScope(id), String(deletedAt || ""), String(deletedAt || "")]
  );
  return getDocumentRecordById(id);
}

export async function updateDocumentRecordReview(
  id,
  { reviewStatus, reviewComment = "", reviewedBy = "" } = {}
) {
  const normalizedStatus = String(reviewStatus || "").trim();
  if (!["pending", "accepted", "rejected"].includes(normalizedStatus)) {
    throw new Error("Invalid review status.");
  }

  const record = await getDocumentRecordById(id);
  if (!record || ["deleted", "superseded"].includes(record.status)) {
    return null;
  }

  const now = new Date().toISOString();
  const pool = getPool();
  await pool.query(
    `UPDATE document_records
     SET "reviewStatus" = $2,
         "reviewComment" = $3,
         "reviewedBy" = $4,
         "reviewedAt" = $5,
         "updatedAt" = $6::timestamptz
     WHERE id = $1`,
    [
      cleanScope(id),
      normalizedStatus,
      cleanScope(reviewComment).slice(0, 2000),
      cleanScope(reviewedBy).slice(0, 180),
      normalizedStatus === "pending" ? "" : now,
      now,
    ]
  );
  return getDocumentRecordById(id);
}

export async function createDocumentRecordWithJob({ record, job, retentionDays = 14 }) {
  const pool = getPool();
  const client = await pool.connect();
  const now = new Date();
  const nowIso = now.toISOString();

  try {
    await client.query("BEGIN");

    const recordParams = {
      id: cleanScope(record.id),
      projectId: cleanScope(record.projectId),
      dossierId: cleanScope(record.dossierId),
      folderPath: cleanScope(record.folderPath),
      companyId: cleanScope(record.companyId),
      companyName: cleanScope(record.companyName),
      companyEmail: cleanScope(record.companyEmail),
      contactName: cleanScope(record.contactName),
      submissionId: cleanScope(record.submissionId),
      contestName: cleanScope(record.contestName),
      documentType: cleanScope(record.documentType),
      documentLabel: cleanScope(record.documentLabel),
      operation: cleanScope(record.operation || "upload"),
      originalFileName: cleanScope(record.originalFileName),
      fileName: cleanScope(record.fileName),
      mimeType: cleanScope(record.mimeType),
      storagePath: cleanScope(record.storagePath),
      sizeBytes: Number(record.sizeBytes) || 0,
      sha256: cleanScope(record.sha256),
      jobId: cleanScope(job.id),
      receivedAt: nowIso,
      retainedUntil: addRetentionDate({ now, retentionDays }),
    };

    await client.query(
      `UPDATE document_records
       SET status = 'superseded', "errorMessage" = '', "updatedAt" = $8
       WHERE id <> $1
         AND status NOT IN ('deleted', 'superseded')
         AND "documentType" = $2
         AND "dossierId" = $3
         AND (
           ($4 <> '' AND "projectId" = $4)
           OR ($4 = '' AND "projectId" = '')
           OR "projectId" = ''
         )
         AND (
           ($5 <> '' AND "submissionId" = $5)
           OR ($6 <> '' AND "companyId" = $6)
           OR ($7 <> '' AND lower("companyName") = lower($7))
         )`,
      [
        recordParams.id,
        recordParams.documentType,
        recordParams.dossierId,
        recordParams.projectId,
        recordParams.submissionId,
        recordParams.companyId,
        recordParams.companyName,
        nowIso,
      ]
    );

    await client.query(
      `UPDATE document_upload_jobs
       SET status = 'superseded', "updatedAt" = $8
       WHERE status IN ('pending', 'failed')
         AND "recordId" IN (
           SELECT id FROM document_records
           WHERE id <> $1 AND status = 'superseded'
             AND "documentType" = $2 AND "dossierId" = $3
             AND (
               ($4 <> '' AND "projectId" = $4)
               OR ($4 = '' AND "projectId" = '')
               OR "projectId" = ''
             )
             AND (
               ($5 <> '' AND "submissionId" = $5)
               OR ($6 <> '' AND "companyId" = $6)
               OR ($7 <> '' AND lower("companyName") = lower($7))
             )
         )`,
      [
        recordParams.id,
        recordParams.documentType,
        recordParams.dossierId,
        recordParams.projectId,
        recordParams.submissionId,
        recordParams.companyId,
        recordParams.companyName,
        nowIso,
      ]
    );

    await client.query(
      `INSERT INTO document_records (
        id, "projectId", "dossierId", "folderPath", "companyId", "companyName",
        "companyEmail", "contactName", "submissionId", "contestName", "documentType",
        "documentLabel", status, operation, "originalFileName", "fileName", "mimeType",
        "storagePath", "sizeBytes", sha256, "jobId", "receivedAt", "retainedUntil", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'sync_pending', $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23::timestamptz, $23::timestamptz
      )`,
      [
        recordParams.id,
        recordParams.projectId,
        recordParams.dossierId,
        recordParams.folderPath,
        recordParams.companyId,
        recordParams.companyName,
        recordParams.companyEmail,
        recordParams.contactName,
        recordParams.submissionId,
        recordParams.contestName,
        recordParams.documentType,
        recordParams.documentLabel,
        recordParams.operation,
        recordParams.originalFileName,
        recordParams.fileName,
        recordParams.mimeType,
        recordParams.storagePath,
        recordParams.sizeBytes,
        recordParams.sha256,
        recordParams.jobId,
        recordParams.receivedAt,
        recordParams.retainedUntil,
        nowIso,
      ]
    );

    await client.query(
      `INSERT INTO document_upload_jobs (
        id, "recordId", operation, status, attempts, "maxAttempts", "nextAttemptAt",
        "fileName", "storagePath", "sizeBytes", sha256, payload, "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, 'pending', 0, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $11::timestamptz
      )`,
      [
        cleanScope(job.id),
        recordParams.id,
        recordParams.operation,
        Math.max(1, Number(job.maxAttempts) || 5),
        nowIso,
        recordParams.fileName,
        recordParams.storagePath,
        recordParams.sizeBytes,
        recordParams.sha256,
        stableJson(job.payload || {}),
        nowIso,
      ]
    );

    await client.query("COMMIT");
    return getDocumentRecordById(recordParams.id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function claimNextDocumentUploadJob({ now = new Date() } = {}) {
  const pool = getPool();
  const client = await pool.connect();
  const nowIso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();

  try {
    await client.query("BEGIN");

    const selected = await client.query(
      `SELECT *
       FROM document_upload_jobs
       WHERE status = 'pending'
         AND ("nextAttemptAt" = '' OR "nextAttemptAt" <= $1)
       ORDER BY
         CASE WHEN "nextAttemptAt" = '' THEN 0 ELSE 1 END,
         "nextAttemptAt" ASC,
         "createdAt" ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [nowIso]
    );

    const job = selected.rows[0];
    if (!job) {
      await client.query("COMMIT");
      return null;
    }

    const updated = await client.query(
      `UPDATE document_upload_jobs
       SET status = 'uploading', attempts = attempts + 1, "startedAt" = $2,
           "updatedAt" = $2::timestamptz
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [job.id, nowIso]
    );

    if (!updated.rowCount) {
      await client.query("COMMIT");
      return null;
    }

    await client.query(
      `UPDATE document_records SET status = 'syncing', "updatedAt" = $2::timestamptz
       WHERE id = $1 AND status NOT IN ('deleted', 'superseded')`,
      [job.recordId, nowIso]
    );

    await client.query("COMMIT");
    return serializeDocumentUploadJob(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recoverStuckUploadingJobs({ now = new Date() } = {}) {
  const pool = getPool();
  const nowIso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const jobs = await pool.query(
    `UPDATE document_upload_jobs
     SET status = 'pending', "nextAttemptAt" = $1, "errorMessage" = 'Recovered from interrupted run.',
         "updatedAt" = $2::timestamptz
     WHERE status = 'uploading'`,
    [nowIso, nowIso]
  );
  const records = await pool.query(
    `UPDATE document_records SET status = 'sync_pending', "updatedAt" = $1::timestamptz
     WHERE status = 'syncing'`,
    [nowIso]
  );
  return { jobs: jobs.rowCount || 0, records: records.rowCount || 0 };
}

export async function completeDocumentUploadJob({ jobId, flowResult = {} }) {
  const pool = getPool();
  const uploadedAt = new Date().toISOString();
  const flowResultJson = stableJson(flowResult);
  const jobResult = await pool.query(
    'SELECT * FROM document_upload_jobs WHERE id = $1',
    [jobId]
  );
  const job = serializeDocumentUploadJob(jobResult.rows[0]);
  if (!job) return null;

  await pool.query(
    `UPDATE document_upload_jobs
     SET status = CASE WHEN status = 'superseded' THEN 'superseded' ELSE 'uploaded' END,
         "flowResult" = $2, "errorMessage" = '', "finishedAt" = $3, "updatedAt" = $4::timestamptz
     WHERE id = $1 AND status IN ('pending', 'uploading', 'superseded')`,
    [job.id, flowResultJson, uploadedAt, uploadedAt]
  );

  await pool.query(
    `UPDATE document_records
     SET "flowResult" = $2,
         status = CASE WHEN status IN ('deleted', 'superseded') THEN status ELSE 'synced' END,
         "errorMessage" = '', "uploadedAt" = $3, "updatedAt" = $4::timestamptz
     WHERE id = $1`,
    [job.recordId, flowResultJson, uploadedAt, uploadedAt]
  );

  const updated = await pool.query(
    'SELECT * FROM document_upload_jobs WHERE id = $1',
    [job.id]
  );
  return serializeDocumentUploadJob(updated.rows[0]);
}

export async function failDocumentUploadJob({
  jobId,
  errorMessage,
  retryDelayMs = 0,
  preserveAttempts = false,
  permanent = false,
}) {
  const pool = getPool();
  const now = new Date();
  const nowIso = now.toISOString();
  const jobResult = await pool.query(
    'SELECT * FROM document_upload_jobs WHERE id = $1',
    [jobId]
  );
  const job = serializeDocumentUploadJob(jobResult.rows[0]);
  if (!job) return null;

  if (preserveAttempts && job.attempts > 0) {
    await pool.query(
      `UPDATE document_upload_jobs
       SET attempts = CASE WHEN attempts > 0 THEN attempts - 1 ELSE 0 END,
           "updatedAt" = $2::timestamptz
       WHERE id = $1`,
      [job.id, nowIso]
    );
  }

  const effectiveAttempts = preserveAttempts ? Math.max(0, job.attempts - 1) : job.attempts;
  const finalFailure = permanent || effectiveAttempts >= job.maxAttempts;
  const nextAttemptAt = finalFailure
    ? ""
    : new Date(now.getTime() + Math.max(0, Number(retryDelayMs) || 0)).toISOString();

  await pool.query(
    `UPDATE document_upload_jobs
     SET status = $2, "errorMessage" = $3, "nextAttemptAt" = $4,
         "finishedAt" = $5, "updatedAt" = $6::timestamptz
     WHERE id = $1`,
    [
      job.id,
      finalFailure ? "failed" : "pending",
      cleanScope(errorMessage).slice(0, 2000),
      nextAttemptAt,
      finalFailure ? nowIso : "",
      nowIso,
    ]
  );

  if (finalFailure) {
    await pool.query(
      `UPDATE document_records SET status = 'sync_failed', "errorMessage" = $2, "updatedAt" = $3::timestamptz
       WHERE id = $1 AND status NOT IN ('deleted', 'superseded')`,
      [job.recordId, cleanScope(errorMessage).slice(0, 2000), nowIso]
    );
  } else {
    await pool.query(
      `UPDATE document_records SET status = 'sync_pending', "errorMessage" = $2, "updatedAt" = $3::timestamptz
       WHERE id = $1 AND status NOT IN ('deleted', 'superseded')`,
      [job.recordId, cleanScope(errorMessage).slice(0, 2000), nowIso]
    );
  }

  const updated = await pool.query(
    'SELECT * FROM document_upload_jobs WHERE id = $1',
    [job.id]
  );
  return serializeDocumentUploadJob(updated.rows[0]);
}

export async function retryDocumentUploadJob(jobId) {
  const pool = getPool();
  const now = new Date().toISOString();
  const jobResult = await pool.query(
    'SELECT * FROM document_upload_jobs WHERE id = $1',
    [jobId]
  );
  const job = serializeDocumentUploadJob(jobResult.rows[0]);
  if (!job) return null;

  await pool.query(
    `UPDATE document_upload_jobs
     SET status = 'pending', "errorMessage" = '', "nextAttemptAt" = $2, "updatedAt" = $3::timestamptz
     WHERE id = $1 AND status IN ('failed', 'pending')`,
    [job.id, now, now]
  );
  await pool.query(
    `UPDATE document_records SET status = 'sync_pending', "errorMessage" = '', "updatedAt" = $2::timestamptz
     WHERE id = $1 AND status = 'sync_failed'`,
    [job.recordId, now]
  );

  const updated = await pool.query(
    'SELECT * FROM document_upload_jobs WHERE id = $1',
    [job.id]
  );
  return serializeDocumentUploadJob(updated.rows[0]);
}

export async function retryDocumentRecordSync(recordId) {
  const record = await getDocumentRecordById(recordId);
  if (!record?.jobId) return null;
  return retryDocumentUploadJob(record.jobId);
}

export async function listDocumentUploadJobsForProject(scope = {}, limit = 100) {
  const normalized = normalizeRecordScope(scope);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const pool = getPool();
  const result = await pool.query(
    `SELECT j.*, r.status AS "recordStatus", r."projectId", r."dossierId", r."companyId",
            r."companyName", r."submissionId", r."documentType", r."documentLabel"
     FROM document_upload_jobs j
     JOIN document_records r ON r.id = j."recordId"
     WHERE (
       ($1 <> '' AND (r."projectId" = $1 OR (r."projectId" = '' AND r."dossierId" = $2)))
       OR ($1 = '' AND r."dossierId" = $2)
     )
     ORDER BY j."updatedAt" DESC
     LIMIT $3`,
    [normalized.projectId, normalized.dossierId, safeLimit]
  );
  return result.rows.map(serializeDocumentUploadJob);
}

export async function listPurgeableDocumentRecords({ now = new Date(), limit = 100 } = {}) {
  const nowIso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
  const pool = getPool();
  const result = await pool.query(
    `SELECT *
     FROM document_records
     WHERE "storagePath" <> ''
       AND "retainedUntil" <> ''
       AND "retainedUntil" <= $1
       AND status IN ('synced', 'deleted', 'superseded')
     ORDER BY "retainedUntil" ASC
     LIMIT $2`,
    [nowIso, safeLimit]
  );
  return result.rows.map(serializeDocumentRecord);
}

export async function markDocumentRecordStoragePurged(id) {
  const pool = getPool();
  const now = new Date().toISOString();
  await pool.query(
    `UPDATE document_records SET "storagePath" = '', "updatedAt" = $2::timestamptz WHERE id = $1`,
    [cleanScope(id), now]
  );
  return getDocumentRecordById(id);
}
