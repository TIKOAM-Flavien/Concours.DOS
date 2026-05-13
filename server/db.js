import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(
  __dirname,
  process.env.PORTAL_ADMIN_DB_PATH || "admin.db"
);

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    dossierId   TEXT NOT NULL DEFAULT '',
    folderPath  TEXT NOT NULL DEFAULT '',
    deadline    TEXT NOT NULL DEFAULT '',
    customDocuments TEXT NOT NULL DEFAULT '[]',
    createdAt   TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS companies (
    id                 TEXT PRIMARY KEY,
    projectId          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    companyName        TEXT NOT NULL,
    companyId          TEXT NOT NULL DEFAULT '',
    contactName        TEXT NOT NULL DEFAULT '',
    companyEmail       TEXT NOT NULL DEFAULT '',
    submissionId       TEXT NOT NULL DEFAULT '',
    expectedDocuments  TEXT NOT NULL DEFAULT '[]',
    createdAt          TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_companies_projectId ON companies(projectId);

  CREATE TABLE IF NOT EXISTS revoked_invitations (
    id        TEXT PRIMARY KEY,
    revokedAt TEXT NOT NULL DEFAULT (datetime('now')),
    reason    TEXT NOT NULL DEFAULT '',
    payload   TEXT NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS idx_revoked_invitations_revokedAt ON revoked_invitations(revokedAt);

  CREATE TABLE IF NOT EXISTS submission_daily_budget (
    submissionId TEXT NOT NULL,
    day          TEXT NOT NULL,
    count        INTEGER NOT NULL DEFAULT 0,
    updatedAt    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (submissionId, day)
  );

  CREATE INDEX IF NOT EXISTS idx_submission_daily_budget_day ON submission_daily_budget(day);

  CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    actorIp     TEXT NOT NULL DEFAULT '',
    action      TEXT NOT NULL,
    payloadHash TEXT NOT NULL DEFAULT '',
    payload     TEXT NOT NULL DEFAULT '{}',
    createdAt   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_audit_log_createdAt ON audit_log(createdAt);

  CREATE TABLE IF NOT EXISTS document_records (
    id                         TEXT PRIMARY KEY,
    projectId                  TEXT NOT NULL DEFAULT '',
    dossierId                  TEXT NOT NULL DEFAULT '',
    folderPath                 TEXT NOT NULL DEFAULT '',
    companyId                  TEXT NOT NULL DEFAULT '',
    companyName                TEXT NOT NULL DEFAULT '',
    companyEmail               TEXT NOT NULL DEFAULT '',
    contactName                TEXT NOT NULL DEFAULT '',
    submissionId               TEXT NOT NULL DEFAULT '',
    contestName                TEXT NOT NULL DEFAULT '',
    documentType               TEXT NOT NULL,
    documentLabel              TEXT NOT NULL DEFAULT '',
    status                     TEXT NOT NULL DEFAULT 'sync_pending',
    operation                  TEXT NOT NULL DEFAULT 'upload',
    originalFileName           TEXT NOT NULL DEFAULT '',
    fileName                   TEXT NOT NULL DEFAULT '',
    mimeType                   TEXT NOT NULL DEFAULT '',
    storagePath                TEXT NOT NULL DEFAULT '',
    sizeBytes                  INTEGER NOT NULL DEFAULT 0,
    sha256                     TEXT NOT NULL DEFAULT '',
    jobId                      TEXT NOT NULL DEFAULT '',
    sharePointFilePath         TEXT NOT NULL DEFAULT '',
    sharePointFileIdentifier   TEXT NOT NULL DEFAULT '',
    sharePointLink             TEXT NOT NULL DEFAULT '',
    flowResult                 TEXT NOT NULL DEFAULT '{}',
    errorMessage               TEXT NOT NULL DEFAULT '',
    receivedAt                 TEXT NOT NULL DEFAULT '',
    uploadedAt                 TEXT NOT NULL DEFAULT '',
    deletedAt                  TEXT NOT NULL DEFAULT '',
    retainedUntil              TEXT NOT NULL DEFAULT '',
    createdAt                  TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt                  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_document_records_project ON document_records(projectId, dossierId);
  CREATE INDEX IF NOT EXISTS idx_document_records_scope ON document_records(dossierId, submissionId, companyId, documentType);
  CREATE INDEX IF NOT EXISTS idx_document_records_status ON document_records(status, updatedAt);

  CREATE TABLE IF NOT EXISTS document_upload_jobs (
    id              TEXT PRIMARY KEY,
    recordId        TEXT NOT NULL REFERENCES document_records(id) ON DELETE CASCADE,
    operation       TEXT NOT NULL DEFAULT 'upload',
    status          TEXT NOT NULL DEFAULT 'pending',
    attempts        INTEGER NOT NULL DEFAULT 0,
    maxAttempts     INTEGER NOT NULL DEFAULT 5,
    nextAttemptAt   TEXT NOT NULL DEFAULT '',
    fileName        TEXT NOT NULL DEFAULT '',
    storagePath     TEXT NOT NULL DEFAULT '',
    sizeBytes       INTEGER NOT NULL DEFAULT 0,
    sha256          TEXT NOT NULL DEFAULT '',
    payload         TEXT NOT NULL DEFAULT '{}',
    errorMessage    TEXT NOT NULL DEFAULT '',
    flowResult      TEXT NOT NULL DEFAULT '{}',
    startedAt       TEXT NOT NULL DEFAULT '',
    finishedAt      TEXT NOT NULL DEFAULT '',
    createdAt       TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_document_upload_jobs_status ON document_upload_jobs(status, nextAttemptAt, createdAt);
  CREATE INDEX IF NOT EXISTS idx_document_upload_jobs_recordId ON document_upload_jobs(recordId);
`);

function ensureColumn({ table, column, definition }) {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => String(row.name || ""));
  if (columns.includes(column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// Lightweight migrations for existing DBs.
ensureColumn({
  table: "projects",
  column: "customDocuments",
  definition: "TEXT NOT NULL DEFAULT '[]'",
});
ensureColumn({
  table: "projects",
  column: "archivedAt",
  definition: "TEXT NOT NULL DEFAULT ''",
});

const stmts = {
  allProjects: db.prepare(
    "SELECT * FROM projects WHERE archivedAt = '' ORDER BY createdAt DESC"
  ),
  allProjectsIncludingArchived: db.prepare(
    "SELECT * FROM projects ORDER BY (archivedAt = '') DESC, createdAt DESC"
  ),
  setProjectArchivedAt: db.prepare(
    "UPDATE projects SET archivedAt = @archivedAt, updatedAt = datetime('now') WHERE id = @id"
  ),
  getProject: db.prepare("SELECT * FROM projects WHERE id = ?"),
  insertProject: db.prepare(`
    INSERT INTO projects (id, name, dossierId, folderPath, deadline, customDocuments)
    VALUES (@id, @name, @dossierId, @folderPath, @deadline, @customDocuments)
  `),
  updateProject: db.prepare(`
    UPDATE projects
    SET name = @name, dossierId = @dossierId, folderPath = @folderPath,
        deadline = @deadline, customDocuments = @customDocuments, updatedAt = datetime('now')
    WHERE id = @id
  `),
  deleteProject: db.prepare("DELETE FROM projects WHERE id = ?"),

  companiesByProject: db.prepare(
    "SELECT * FROM companies WHERE projectId = ? ORDER BY companyName"
  ),
  allCompanies: db.prepare("SELECT * FROM companies ORDER BY companyName"),
  companyExpectedDocumentsByProject: db.prepare(
    "SELECT id, expectedDocuments FROM companies WHERE projectId = ?"
  ),
  getCompany: db.prepare("SELECT * FROM companies WHERE id = ?"),
  insertCompany: db.prepare(`
    INSERT INTO companies (id, projectId, companyName, companyId, contactName, companyEmail, submissionId, expectedDocuments)
    VALUES (@id, @projectId, @companyName, @companyId, @contactName, @companyEmail, @submissionId, @expectedDocuments)
  `),
  updateCompany: db.prepare(`
    UPDATE companies
    SET companyName = @companyName, companyId = @companyId, contactName = @contactName,
        companyEmail = @companyEmail, submissionId = @submissionId, expectedDocuments = @expectedDocuments,
        updatedAt = datetime('now')
    WHERE id = @id
  `),
  deleteCompany: db.prepare("DELETE FROM companies WHERE id = ?"),

  isInvitationRevoked: db.prepare("SELECT 1 FROM revoked_invitations WHERE id = ? LIMIT 1"),
  revokeInvitation: db.prepare(`
    INSERT INTO revoked_invitations (id, reason, payload)
    VALUES (@id, @reason, @payload)
    ON CONFLICT(id) DO UPDATE SET
      revokedAt = datetime('now'),
      reason = excluded.reason,
      payload = excluded.payload
  `),
  listRevokedInvitations: db.prepare(
    "SELECT * FROM revoked_invitations ORDER BY revokedAt DESC LIMIT ?"
  ),

  // N-08: prune rows whose embedded payload.exp is older than a grace date.
  // json_extract is safe here because the payload column is always valid JSON
  // (empty rows fall back to {}, which yields NULL for any extract path and
  // is therefore never pruned).
  pruneRevokedInvitations: db.prepare(`
    DELETE FROM revoked_invitations
    WHERE json_extract(payload, '$.exp') IS NOT NULL
      AND json_extract(payload, '$.exp') <> ''
      AND datetime(json_extract(payload, '$.exp')) < datetime(@cutoff)
  `),

  // N-09: scrub the mutable payload column on audit rows older than the
  // retention window. The immutable sha256 payloadHash is kept so an
  // operator can still verify that a given decision was made if they have
  // the original payload on file.
  scrubAuditLogPayloads: db.prepare(`
    UPDATE audit_log
    SET payload = '{}'
    WHERE payload <> '{}'
      AND createdAt < datetime(@cutoff)
  `),

  getSubmissionBudget: db.prepare(
    "SELECT count FROM submission_daily_budget WHERE submissionId = ? AND day = ?"
  ),
  bumpSubmissionBudget: db.prepare(`
    INSERT INTO submission_daily_budget (submissionId, day, count)
    VALUES (@submissionId, @day, @delta)
    ON CONFLICT(submissionId, day) DO UPDATE SET
      count = count + excluded.count,
      updatedAt = datetime('now')
  `),

  insertAuditLog: db.prepare(`
    INSERT INTO audit_log (actorIp, action, payloadHash, payload)
    VALUES (@actorIp, @action, @payloadHash, @payload)
  `),

  findProjectByInvitationScope: db.prepare(`
    SELECT p.id
    FROM projects p
    LEFT JOIN companies c ON c.projectId = p.id
    WHERE p.dossierId = @dossierId
      AND (
        (@submissionId <> '' AND c.submissionId = @submissionId)
        OR (@companyId <> '' AND c.companyId = @companyId)
        OR (@companyName <> '' AND lower(c.companyName) = lower(@companyName))
      )
    ORDER BY (p.archivedAt = '') DESC, p.updatedAt DESC
    LIMIT 1
  `),

  insertDocumentRecord: db.prepare(`
    INSERT INTO document_records (
      id, projectId, dossierId, folderPath, companyId, companyName,
      companyEmail, contactName, submissionId, contestName, documentType,
      documentLabel, status, operation, originalFileName, fileName, mimeType,
      storagePath, sizeBytes, sha256, jobId, sharePointFilePath,
      sharePointFileIdentifier, receivedAt, retainedUntil, createdAt, updatedAt
    )
    VALUES (
      @id, @projectId, @dossierId, @folderPath, @companyId, @companyName,
      @companyEmail, @contactName, @submissionId, @contestName, @documentType,
      @documentLabel, @status, @operation, @originalFileName, @fileName, @mimeType,
      @storagePath, @sizeBytes, @sha256, @jobId, @sharePointFilePath,
      @sharePointFileIdentifier, @receivedAt, @retainedUntil, @now, @now
    )
  `),
  markSupersededDocumentRecords: db.prepare(`
    UPDATE document_records
    SET status = 'superseded',
        errorMessage = '',
        updatedAt = @now
    WHERE id <> @id
      AND status NOT IN ('deleted', 'superseded')
      AND documentType = @documentType
      AND dossierId = @dossierId
      AND (
        (@projectId <> '' AND projectId = @projectId)
        OR (@projectId = '' AND projectId = '')
        OR projectId = ''
      )
      AND (
        (@submissionId <> '' AND submissionId = @submissionId)
        OR (@companyId <> '' AND companyId = @companyId)
        OR (@companyName <> '' AND lower(companyName) = lower(@companyName))
      )
  `),
  markSupersededDocumentJobs: db.prepare(`
    UPDATE document_upload_jobs
    SET status = 'superseded',
        updatedAt = @now
    WHERE status IN ('pending', 'failed')
      AND recordId IN (
        SELECT id
        FROM document_records
        WHERE id <> @id
          AND status = 'superseded'
          AND documentType = @documentType
          AND dossierId = @dossierId
          AND (
            (@projectId <> '' AND projectId = @projectId)
            OR (@projectId = '' AND projectId = '')
            OR projectId = ''
          )
          AND (
            (@submissionId <> '' AND submissionId = @submissionId)
            OR (@companyId <> '' AND companyId = @companyId)
            OR (@companyName <> '' AND lower(companyName) = lower(@companyName))
          )
      )
  `),
  insertDocumentUploadJob: db.prepare(`
    INSERT INTO document_upload_jobs (
      id, recordId, operation, status, attempts, maxAttempts, nextAttemptAt,
      fileName, storagePath, sizeBytes, sha256, payload, createdAt, updatedAt
    )
    VALUES (
      @id, @recordId, @operation, 'pending', 0, @maxAttempts, @nextAttemptAt,
      @fileName, @storagePath, @sizeBytes, @sha256, @payload, @now, @now
    )
  `),
  setDocumentRecordJobId: db.prepare(`
    UPDATE document_records
    SET jobId = @jobId,
        updatedAt = @now
    WHERE id = @id
  `),
  listDocumentRecordsForProject: db.prepare(`
    SELECT *
    FROM document_records
    WHERE status NOT IN ('deleted', 'superseded')
      AND (
        (@projectId <> '' AND (projectId = @projectId OR (projectId = '' AND dossierId = @dossierId)))
        OR (@projectId = '' AND dossierId = @dossierId)
      )
      AND (@companyId = '' OR companyId = @companyId)
      AND (@companyName = '' OR lower(companyName) = lower(@companyName))
      AND (@submissionId = '' OR submissionId = @submissionId)
    ORDER BY updatedAt DESC
  `),
  listDocumentRecordsForInvitation: db.prepare(`
    SELECT *
    FROM document_records
    WHERE status NOT IN ('deleted', 'superseded')
      AND dossierId = @dossierId
      AND (@projectId = '' OR projectId = @projectId OR projectId = '')
      AND (
        (@submissionId <> '' AND submissionId = @submissionId)
        OR (@companyId <> '' AND companyId = @companyId)
        OR (@companyName <> '' AND lower(companyName) = lower(@companyName))
      )
    ORDER BY updatedAt DESC
  `),
  getDocumentRecordById: db.prepare("SELECT * FROM document_records WHERE id = ?"),
  getDocumentUploadJobById: db.prepare("SELECT * FROM document_upload_jobs WHERE id = ?"),
  getActiveDocumentRecordByScope: db.prepare(`
    SELECT *
    FROM document_records
    WHERE status NOT IN ('deleted', 'superseded')
      AND dossierId = @dossierId
      AND (@projectId = '' OR projectId = @projectId OR projectId = '')
      AND documentType = @documentType
      AND (
        (@submissionId <> '' AND submissionId = @submissionId)
        OR (@companyId <> '' AND companyId = @companyId)
        OR (@companyName <> '' AND lower(companyName) = lower(@companyName))
      )
    ORDER BY updatedAt DESC
    LIMIT 1
  `),
  markDocumentRecordDeleted: db.prepare(`
    UPDATE document_records
    SET status = 'deleted',
        deletedAt = @deletedAt,
        updatedAt = @deletedAt
    WHERE id = @id
  `),
  claimNextDocumentUploadJob: db.prepare(`
    SELECT *
    FROM document_upload_jobs
    WHERE status = 'pending'
      AND (nextAttemptAt = '' OR nextAttemptAt <= @now)
    ORDER BY
      CASE WHEN nextAttemptAt = '' THEN 0 ELSE 1 END,
      nextAttemptAt ASC,
      createdAt ASC
    LIMIT 1
  `),
  recoverStuckUploadingJobs: db.prepare(`
    UPDATE document_upload_jobs
    SET status = 'pending',
        nextAttemptAt = @now,
        errorMessage = 'Recovered from interrupted run.',
        updatedAt = @now
    WHERE status = 'uploading'
  `),
  recoverStuckSyncingRecords: db.prepare(`
    UPDATE document_records
    SET status = 'sync_pending',
        updatedAt = @now
    WHERE status = 'syncing'
  `),
  markDocumentUploadJobUploading: db.prepare(`
    UPDATE document_upload_jobs
    SET status = 'uploading',
        attempts = attempts + 1,
        startedAt = @now,
        updatedAt = @now
    WHERE id = @id
      AND status = 'pending'
  `),
  markDocumentRecordSyncing: db.prepare(`
    UPDATE document_records
    SET status = 'syncing',
        updatedAt = @now
    WHERE id = @id
      AND status NOT IN ('deleted', 'superseded')
  `),
  completeDocumentUploadJob: db.prepare(`
    UPDATE document_upload_jobs
    SET status = CASE WHEN status = 'superseded' THEN 'superseded' ELSE 'uploaded' END,
        flowResult = @flowResult,
        errorMessage = '',
        finishedAt = @uploadedAt,
        updatedAt = @uploadedAt
    WHERE id = @id
      AND status IN ('uploading', 'superseded')
  `),
  // Record SharePoint coordinates even on superseded/deleted records so that a
  // follow-up cleanup (manual or scheduled) can locate the orphan file. The
  // `status` is only flipped to 'synced' when the record is still live.
  markDocumentRecordSynced: db.prepare(`
    UPDATE document_records
    SET sharePointFilePath = @sharePointFilePath,
        sharePointFileIdentifier = @sharePointFileIdentifier,
        sharePointLink = @sharePointLink,
        flowResult = @flowResult,
        status = CASE
          WHEN status IN ('deleted', 'superseded') THEN status
          ELSE 'synced'
        END,
        errorMessage = '',
        uploadedAt = @uploadedAt,
        updatedAt = @uploadedAt
    WHERE id = @id
  `),
  retryDocumentUploadJob: db.prepare(`
    UPDATE document_upload_jobs
    SET status = 'pending',
        errorMessage = '',
        nextAttemptAt = @now,
        updatedAt = @now
    WHERE id = @id
      AND status IN ('failed', 'pending')
  `),
  rollbackDocumentUploadJobAttempt: db.prepare(`
    UPDATE document_upload_jobs
    SET attempts = CASE WHEN attempts > 0 THEN attempts - 1 ELSE 0 END,
        updatedAt = @now
    WHERE id = @id
  `),
  markDocumentUploadJobFailed: db.prepare(`
    UPDATE document_upload_jobs
    SET status = @status,
        errorMessage = @errorMessage,
        nextAttemptAt = @nextAttemptAt,
        finishedAt = @finishedAt,
        updatedAt = @now
    WHERE id = @id
  `),
  markDocumentRecordSyncFailed: db.prepare(`
    UPDATE document_records
    SET status = 'sync_failed',
        errorMessage = @errorMessage,
        updatedAt = @now
    WHERE id = @id
      AND status NOT IN ('deleted', 'superseded')
  `),
  markDocumentRecordSyncPending: db.prepare(`
    UPDATE document_records
    SET status = 'sync_pending',
        errorMessage = '',
        updatedAt = @now
    WHERE id = @id
      AND status = 'sync_failed'
  `),
  markDocumentRecordSyncPendingWithError: db.prepare(`
    UPDATE document_records
    SET status = 'sync_pending',
        errorMessage = @errorMessage,
        updatedAt = @now
    WHERE id = @id
      AND status NOT IN ('deleted', 'superseded')
  `),
  listDocumentUploadJobsForProject: db.prepare(`
    SELECT j.*, r.status AS recordStatus, r.projectId, r.dossierId, r.companyId, r.companyName, r.submissionId,
           r.documentType, r.documentLabel
    FROM document_upload_jobs j
    JOIN document_records r ON r.id = j.recordId
    WHERE (
      (@projectId <> '' AND (r.projectId = @projectId OR (r.projectId = '' AND r.dossierId = @dossierId)))
      OR (@projectId = '' AND r.dossierId = @dossierId)
    )
    ORDER BY j.updatedAt DESC
    LIMIT @limit
  `),
  listPurgeableDocumentRecords: db.prepare(`
    SELECT *
    FROM document_records
    WHERE storagePath <> ''
      AND retainedUntil <> ''
      AND retainedUntil <= @now
      AND status IN ('synced', 'deleted', 'superseded')
    ORDER BY retainedUntil ASC
    LIMIT @limit
  `),
  markDocumentRecordStoragePurged: db.prepare(`
    UPDATE document_records
    SET storagePath = '',
        updatedAt = @now
    WHERE id = @id
  `),
};

function serializeCompany(row) {
  if (!row) return null;
  return {
    ...row,
    expectedDocuments: parseJsonArray(row.expectedDocuments, []),
  };
}

function serializeProject(row) {
  if (!row) return null;
  return {
    ...row,
    customDocuments: (() => {
      try {
        return JSON.parse(row.customDocuments || "[]");
      } catch {
        return [];
      }
    })(),
  };
}

function parseJsonArray(value, fallback = []) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function stableJson(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function parseJsonObject(value, fallback = {}) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : fallback;
  } catch {
    return fallback;
  }
}

function sha256Hex(input) {
  return createHash("sha256").update(String(input || ""), "utf8").digest("hex");
}

export function getAllProjects({ includeArchived = false } = {}) {
  const projects = includeArchived
    ? stmts.allProjectsIncludingArchived.all()
    : stmts.allProjects.all();
  const projectIds = new Set(projects.map((project) => project.id));
  const companiesByProject = new Map();

  for (const company of stmts.allCompanies.all()) {
    if (!projectIds.has(company.projectId)) continue;
    const serialized = serializeCompany(company);
    if (!companiesByProject.has(company.projectId)) {
      companiesByProject.set(company.projectId, []);
    }
    companiesByProject.get(company.projectId).push(serialized);
  }

  return projects.map((p) => ({
    ...serializeProject(p),
    companies: companiesByProject.get(p.id) || [],
  }));
}

export function setProjectArchived(id, archived) {
  const existing = stmts.getProject.get(id);
  if (!existing) return null;
  stmts.setProjectArchivedAt.run({
    id,
    archivedAt: archived ? new Date().toISOString() : "",
  });
  return getProject(id);
}

export function getProject(id) {
  const row = stmts.getProject.get(id);
  if (!row) return null;
  return {
    ...serializeProject(row),
    companies: stmts.companiesByProject.all(id).map(serializeCompany),
  };
}

export function upsertProject({ id, name, dossierId, folderPath, deadline, customDocuments }) {
  const existing = stmts.getProject.get(id);
  const existingCustom = existing ? parseJsonArray(existing.customDocuments, []) : [];
  const params = {
    id,
    name,
    dossierId: dossierId || "",
    folderPath: folderPath || "",
    deadline: deadline || "",
    customDocuments: JSON.stringify(customDocuments || []),
  };
  if (existing) {
    stmts.updateProject.run(params);
  } else {
    stmts.insertProject.run(params);
  }

  // Keep company expectedDocuments consistent: if a custom document is removed
  // from the project definition, drop it from all companies in that project.
  const nextCustomIds = new Set(
    (customDocuments || [])
      .map((doc) => (doc && typeof doc === "object" ? doc.id : ""))
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
  const removedCustomIds = (existingCustom || [])
    .map((doc) => (doc && typeof doc === "object" ? doc.id : ""))
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((idValue) => !nextCustomIds.has(idValue));

  if (removedCustomIds.length) {
    const rows = stmts.companyExpectedDocumentsByProject.all(id);
    for (const row of rows) {
      const expected = parseJsonArray(row.expectedDocuments, []);
      const filtered = expected.filter((docId) => !removedCustomIds.includes(docId));
      if (filtered.length === expected.length) continue;
      const companyRow = stmts.getCompany.get(row.id);
      if (!companyRow) continue;
      upsertCompany({
        id: row.id,
        projectId: id,
        companyName: companyRow.companyName || "",
        companyId: companyRow.companyId || "",
        contactName: companyRow.contactName || "",
        companyEmail: companyRow.companyEmail || "",
        submissionId: companyRow.submissionId || "",
        expectedDocuments: filtered,
      });
    }
  }

  return getProject(id);
}

export function deleteProject(id) {
  return stmts.deleteProject.run(id);
}

export function upsertCompany({ id, projectId, companyName, companyId, contactName, companyEmail, submissionId, expectedDocuments }) {
  const existing = stmts.getCompany.get(id);
  const params = {
    id,
    projectId,
    companyName,
    companyId: companyId || "",
    contactName: contactName || "",
    companyEmail: companyEmail || "",
    submissionId: submissionId || "",
    expectedDocuments: JSON.stringify(expectedDocuments || []),
  };
  if (existing) {
    stmts.updateCompany.run(params);
  } else {
    stmts.insertCompany.run(params);
  }
  return serializeCompany(stmts.getCompany.get(id));
}

export function deleteCompany(id) {
  return stmts.deleteCompany.run(id);
}

export function isInvitationRevoked(id) {
  return Boolean(stmts.isInvitationRevoked.get(id));
}

export function revokeInvitation({ id, reason = "", payload = {} }) {
  stmts.revokeInvitation.run({
    id,
    reason: String(reason || "").trim(),
    payload: JSON.stringify(payload || {}),
  });
  return { ok: true };
}

export function listRevokedInvitations(limit = 50) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
  return stmts.listRevokedInvitations.all(safeLimit).map((row) => ({
    ...row,
    payload: (() => {
      try {
        return JSON.parse(row.payload || "{}");
      } catch {
        return {};
      }
    })(),
  }));
}

function toBudgetDay(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

export function getSubmissionDailyUsage({ submissionId, day = new Date() }) {
  const safeSubmissionId = String(submissionId || "").trim();
  if (!safeSubmissionId) return 0;
  const row = stmts.getSubmissionBudget.get(safeSubmissionId, toBudgetDay(day));
  return Number(row?.count) || 0;
}

export function bumpSubmissionDailyUsage({ submissionId, delta = 1, day = new Date() }) {
  const safeSubmissionId = String(submissionId || "").trim();
  if (!safeSubmissionId) return { ok: false, count: 0 };

  const safeDelta = Number(delta) || 0;
  if (!Number.isFinite(safeDelta) || safeDelta <= 0) {
    return { ok: false, count: getSubmissionDailyUsage({ submissionId: safeSubmissionId, day }) };
  }

  stmts.bumpSubmissionBudget.run({
    submissionId: safeSubmissionId,
    day: toBudgetDay(day),
    delta: Math.floor(safeDelta),
  });

  return {
    ok: true,
    count: getSubmissionDailyUsage({ submissionId: safeSubmissionId, day }),
  };
}

// N-08: drop revoked entries whose signature has been expired for longer
// than the grace window (default 30 days). The signature itself is
// cryptographically invalid past `exp`, so keeping it on the deny-list is
// only useful for forensics. Callers should invoke this periodically.
export function pruneRevokedInvitations({ now = new Date(), graceMs = 30 * 24 * 60 * 60 * 1000 } = {}) {
  const cutoff = new Date(now.getTime() - graceMs).toISOString();
  const result = stmts.pruneRevokedInvitations.run({ cutoff });
  return { ok: true, removed: result.changes || 0, cutoff };
}

// N-09: scrub the payload JSON on audit rows older than the retention window
// (default 90 days). The sha256 payloadHash and the action label survive.
export function scrubOldAuditPayloads({ now = new Date(), retentionMs = 90 * 24 * 60 * 60 * 1000 } = {}) {
  const cutoff = new Date(now.getTime() - retentionMs).toISOString();
  const result = stmts.scrubAuditLogPayloads.run({ cutoff });
  return { ok: true, scrubbed: result.changes || 0, cutoff };
}

export function writeAuditLog({ actorIp = "", action, payload = {} }) {
  const safeAction = String(action || "").trim();
  if (!safeAction) return { ok: false };

  const payloadJson = stableJson(payload);
  stmts.insertAuditLog.run({
    actorIp: String(actorIp || "").trim(),
    action: safeAction,
    payloadHash: sha256Hex(payloadJson),
    payload: payloadJson,
  });

  return { ok: true };
}

function serializeDocumentRecord(row) {
  if (!row) return null;
  return {
    ...row,
    sizeBytes: Number(row.sizeBytes) || 0,
    flowResult: parseJsonObject(row.flowResult, {}),
  };
}

function serializeDocumentUploadJob(row) {
  if (!row) return null;
  return {
    ...row,
    attempts: Number(row.attempts) || 0,
    maxAttempts: Number(row.maxAttempts) || 0,
    sizeBytes: Number(row.sizeBytes) || 0,
    payload: parseJsonObject(row.payload, {}),
    flowResult: parseJsonObject(row.flowResult, {}),
  };
}

function cleanScope(value) {
  return String(value || "").trim();
}

function normalizeRecordScope(scope = {}) {
  return {
    projectId: cleanScope(scope.projectId),
    dossierId: cleanScope(scope.dossierId),
    companyId: cleanScope(scope.companyId),
    companyName: cleanScope(scope.companyName),
    submissionId: cleanScope(scope.submissionId),
  };
}

function addRetentionDate({ now = new Date(), retentionDays = 14 } = {}) {
  const days = Math.max(0, Number(retentionDays) || 0);
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function findProjectForInvitationScope(scope = {}) {
  const normalized = normalizeRecordScope(scope);
  if (normalized.projectId) {
    return getProject(normalized.projectId);
  }

  if (!normalized.dossierId) return null;
  const row = stmts.findProjectByInvitationScope.get(normalized);
  return row?.id ? getProject(row.id) : null;
}

const createDocumentRecordWithJobTx = db.transaction(
  ({ record, job, retentionDays = 14 }) => {
    const now = new Date();
    const nowIso = now.toISOString();
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
      status: "sync_pending",
      operation: cleanScope(record.operation || "upload"),
      originalFileName: cleanScope(record.originalFileName),
      fileName: cleanScope(record.fileName),
      mimeType: cleanScope(record.mimeType),
      storagePath: cleanScope(record.storagePath),
      sizeBytes: Number(record.sizeBytes) || 0,
      sha256: cleanScope(record.sha256),
      jobId: cleanScope(job.id),
      sharePointFilePath: cleanScope(record.sharePointFilePath),
      sharePointFileIdentifier: cleanScope(record.sharePointFileIdentifier),
      receivedAt: nowIso,
      retainedUntil: addRetentionDate({ now, retentionDays }),
      now: nowIso,
    };

    stmts.markSupersededDocumentRecords.run({
      ...recordParams,
      now: nowIso,
    });
    stmts.markSupersededDocumentJobs.run({
      ...recordParams,
      now: nowIso,
    });
    stmts.insertDocumentRecord.run(recordParams);
    stmts.insertDocumentUploadJob.run({
      id: cleanScope(job.id),
      recordId: recordParams.id,
      operation: recordParams.operation,
      maxAttempts: Math.max(1, Number(job.maxAttempts) || 5),
      nextAttemptAt: nowIso,
      fileName: recordParams.fileName,
      storagePath: recordParams.storagePath,
      sizeBytes: recordParams.sizeBytes,
      sha256: recordParams.sha256,
      payload: stableJson(job.payload || {}),
      now: nowIso,
    });

    return serializeDocumentRecord(stmts.getDocumentRecordById.get(recordParams.id));
  }
);

export function createDocumentRecordWithJob(params) {
  return createDocumentRecordWithJobTx(params);
}

export function listDocumentRecordsForProject(scope = {}) {
  const normalized = normalizeRecordScope(scope);
  return stmts.listDocumentRecordsForProject
    .all(normalized)
    .map(serializeDocumentRecord);
}

export function listDocumentRecordsForInvitation(scope = {}) {
  const normalized = normalizeRecordScope(scope);
  if (!normalized.dossierId) return [];
  if (!normalized.submissionId && !normalized.companyId && !normalized.companyName) {
    return [];
  }
  return stmts.listDocumentRecordsForInvitation
    .all(normalized)
    .map(serializeDocumentRecord);
}

export function getDocumentRecordById(id) {
  return serializeDocumentRecord(stmts.getDocumentRecordById.get(id));
}

export function getActiveDocumentRecordByScope(scope = {}) {
  const normalized = normalizeRecordScope(scope);
  if (!normalized.dossierId || !scope.documentType) return null;
  return serializeDocumentRecord(
    stmts.getActiveDocumentRecordByScope.get({
      ...normalized,
      documentType: cleanScope(scope.documentType),
    })
  );
}

export function markDocumentRecordDeleted(id, deletedAt = new Date().toISOString()) {
  stmts.markDocumentRecordDeleted.run({ id: cleanScope(id), deletedAt });
  return getDocumentRecordById(id);
}

// Atomic claim: a single transaction that selects the next pending job,
// conditionally flips it to 'uploading' (the WHERE clause is the lock - if
// another claim raced in, our UPDATE changes 0 rows and we return null), and
// mirrors the change on the linked document_record. Wrapping the three
// statements in `db.transaction` keeps WAL writes consistent and avoids
// half-claimed rows when another statement throws mid-claim.
const claimNextDocumentUploadJobTx = db.transaction((nowIso) => {
  const selected = stmts.claimNextDocumentUploadJob.get({ now: nowIso });
  if (!selected) return null;

  const result = stmts.markDocumentUploadJobUploading.run({
    id: selected.id,
    now: nowIso,
  });
  if (!result.changes) return null;

  stmts.markDocumentRecordSyncing.run({ id: selected.recordId, now: nowIso });
  return stmts.getDocumentUploadJobById.get(selected.id);
});

export function claimNextDocumentUploadJob({ now = new Date() } = {}) {
  const nowIso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const row = claimNextDocumentUploadJobTx(nowIso);
  return row ? serializeDocumentUploadJob(row) : null;
}

// Recover jobs/records that were mid-upload when the process crashed or was
// killed. Without this, a row in status='uploading' is invisible to the claim
// query and stays wedged forever. Called once on worker startup.
export function recoverStuckUploadingJobs({ now = new Date() } = {}) {
  const nowIso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const jobs = stmts.recoverStuckUploadingJobs.run({ now: nowIso });
  const records = stmts.recoverStuckSyncingRecords.run({ now: nowIso });
  return { jobs: jobs.changes || 0, records: records.changes || 0 };
}

export function completeDocumentUploadJob({ jobId, flowResult = {}, sharePoint = {} }) {
  const uploadedAt = new Date().toISOString();
  const flowResultJson = stableJson(flowResult);
  const job = serializeDocumentUploadJob(stmts.getDocumentUploadJobById.get(jobId));
  if (!job) return null;

  stmts.completeDocumentUploadJob.run({
    id: job.id,
    flowResult: flowResultJson,
    uploadedAt,
  });
  stmts.markDocumentRecordSynced.run({
    id: job.recordId,
    sharePointFilePath: cleanScope(sharePoint.filePath),
    sharePointFileIdentifier: cleanScope(sharePoint.fileIdentifier),
    sharePointLink: cleanScope(sharePoint.link),
    flowResult: flowResultJson,
    uploadedAt,
  });

  return serializeDocumentUploadJob(stmts.getDocumentUploadJobById.get(job.id));
}

export function failDocumentUploadJob({
  jobId,
  errorMessage,
  retryDelayMs = 0,
  // When true, do NOT count this failure against the attempts budget. Used for
  // operator-fixable misconfiguration (missing flow URL). The DB column was
  // bumped by markDocumentUploadJobUploading; this rolls it back.
  preserveAttempts = false,
  // When true, force terminal failure regardless of attempts (e.g. ENOENT on
  // the staging file - retrying is pointless).
  permanent = false,
}) {
  const now = new Date();
  const nowIso = now.toISOString();
  const job = serializeDocumentUploadJob(stmts.getDocumentUploadJobById.get(jobId));
  if (!job) return null;

  if (preserveAttempts && job.attempts > 0) {
    stmts.rollbackDocumentUploadJobAttempt.run({ id: job.id, now: nowIso });
  }

  const effectiveAttempts = preserveAttempts ? Math.max(0, job.attempts - 1) : job.attempts;
  const finalFailure = permanent || effectiveAttempts >= job.maxAttempts;
  const nextAttemptAt = finalFailure
    ? ""
    : new Date(now.getTime() + Math.max(0, Number(retryDelayMs) || 0)).toISOString();
  stmts.markDocumentUploadJobFailed.run({
    id: job.id,
    status: finalFailure ? "failed" : "pending",
    errorMessage: cleanScope(errorMessage).slice(0, 2000),
    nextAttemptAt,
    finishedAt: finalFailure ? nowIso : "",
    now: nowIso,
  });

  if (finalFailure) {
    stmts.markDocumentRecordSyncFailed.run({
      id: job.recordId,
      errorMessage: cleanScope(errorMessage).slice(0, 2000),
      now: nowIso,
    });
  } else {
    stmts.markDocumentRecordSyncPendingWithError.run({
      id: job.recordId,
      errorMessage: cleanScope(errorMessage).slice(0, 2000),
      now: nowIso,
    });
  }

  return serializeDocumentUploadJob(stmts.getDocumentUploadJobById.get(job.id));
}

export function retryDocumentUploadJob(jobId) {
  const now = new Date().toISOString();
  const job = serializeDocumentUploadJob(stmts.getDocumentUploadJobById.get(jobId));
  if (!job) return null;
  stmts.retryDocumentUploadJob.run({ id: job.id, now });
  stmts.markDocumentRecordSyncPending.run({ id: job.recordId, now });
  return serializeDocumentUploadJob(stmts.getDocumentUploadJobById.get(job.id));
}

export function retryDocumentRecordSync(recordId) {
  const record = getDocumentRecordById(recordId);
  if (!record?.jobId) return null;
  return retryDocumentUploadJob(record.jobId);
}

export function listDocumentUploadJobsForProject(scope = {}, limit = 100) {
  const normalized = normalizeRecordScope(scope);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  return stmts.listDocumentUploadJobsForProject
    .all({ ...normalized, limit: safeLimit })
    .map(serializeDocumentUploadJob);
}

export function listPurgeableDocumentRecords({ now = new Date(), limit = 100 } = {}) {
  const nowIso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
  return stmts.listPurgeableDocumentRecords
    .all({ now: nowIso, limit: safeLimit })
    .map(serializeDocumentRecord);
}

export function markDocumentRecordStoragePurged(id) {
  const now = new Date().toISOString();
  stmts.markDocumentRecordStoragePurged.run({ id: cleanScope(id), now });
  return getDocumentRecordById(id);
}

export default db;
