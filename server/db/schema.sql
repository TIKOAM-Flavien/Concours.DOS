-- PostgreSQL schema

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  "dossierId" TEXT NOT NULL DEFAULT '',
  "folderPath" TEXT NOT NULL DEFAULT '',
  deadline TEXT NOT NULL DEFAULT '',
  "customDocuments" TEXT NOT NULL DEFAULT '[]',
  "archivedAt" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  "companyName" TEXT NOT NULL,
  "companyId" TEXT NOT NULL DEFAULT '',
  "contactName" TEXT NOT NULL DEFAULT '',
  "companyEmail" TEXT NOT NULL DEFAULT '',
  "submissionId" TEXT NOT NULL DEFAULT '',
  "expectedDocuments" TEXT NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS idx_companies_projectId ON companies("projectId");

CREATE TABLE IF NOT EXISTS revoked_invitations (
  id TEXT PRIMARY KEY,
  "revokedAt" TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  reason TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_revoked_invitations_revokedAt ON revoked_invitations("revokedAt");

CREATE TABLE IF NOT EXISTS signed_invitations (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  "projectId" TEXT NOT NULL DEFAULT '',
  "companyId" TEXT NOT NULL DEFAULT '',
  "submissionId" TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'generated',
  "sentAt" TIMESTAMPTZ,
  "replacesInvitationId" TEXT NOT NULL DEFAULT '',
  iat TIMESTAMPTZ NOT NULL,
  exp TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS idx_signed_invitations_exp ON signed_invitations(exp);
CREATE INDEX IF NOT EXISTS idx_signed_invitations_projectId ON signed_invitations("projectId");
CREATE INDEX IF NOT EXISTS idx_signed_invitations_companyId ON signed_invitations("companyId");
CREATE INDEX IF NOT EXISTS idx_signed_invitations_status ON signed_invitations(status);
CREATE INDEX IF NOT EXISTS idx_signed_invitations_project_company ON signed_invitations("projectId", "companyId", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS invitation_events (
  id BIGSERIAL PRIMARY KEY,
  "invitationId" TEXT NOT NULL REFERENCES signed_invitations(id) ON DELETE CASCADE,
  "eventType" TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'recipient',
  "actorIpHash" TEXT NOT NULL DEFAULT '',
  "userAgent" TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS idx_invitation_events_invitationId ON invitation_events("invitationId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_invitation_events_eventType ON invitation_events("eventType", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS submission_daily_budget (
  "submissionId" TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  PRIMARY KEY ("submissionId", day)
);

CREATE INDEX IF NOT EXISTS idx_submission_daily_budget_day ON submission_daily_budget(day);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  "actorIp" TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS idx_audit_log_createdAt ON audit_log("createdAt");

CREATE TABLE IF NOT EXISTS document_records (
  id TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL DEFAULT '',
  "dossierId" TEXT NOT NULL DEFAULT '',
  "folderPath" TEXT NOT NULL DEFAULT '',
  "companyId" TEXT NOT NULL DEFAULT '',
  "companyName" TEXT NOT NULL DEFAULT '',
  "companyEmail" TEXT NOT NULL DEFAULT '',
  "contactName" TEXT NOT NULL DEFAULT '',
  "submissionId" TEXT NOT NULL DEFAULT '',
  "contestName" TEXT NOT NULL DEFAULT '',
  "documentType" TEXT NOT NULL,
  "documentLabel" TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'sync_pending',
  operation TEXT NOT NULL DEFAULT 'upload',
  "originalFileName" TEXT NOT NULL DEFAULT '',
  "fileName" TEXT NOT NULL DEFAULT '',
  "mimeType" TEXT NOT NULL DEFAULT '',
  "storagePath" TEXT NOT NULL DEFAULT '',
  "sizeBytes" BIGINT NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  "jobId" TEXT NOT NULL DEFAULT '',
  "flowResult" TEXT NOT NULL DEFAULT '{}',
  "errorMessage" TEXT NOT NULL DEFAULT '',
  "receivedAt" TEXT NOT NULL DEFAULT '',
  "uploadedAt" TEXT NOT NULL DEFAULT '',
  "deletedAt" TEXT NOT NULL DEFAULT '',
  "retainedUntil" TEXT NOT NULL DEFAULT '',
  "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
  "reviewedAt" TEXT NOT NULL DEFAULT '',
  "reviewComment" TEXT NOT NULL DEFAULT '',
  "reviewedBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS idx_document_records_project ON document_records("projectId", "dossierId");
CREATE INDEX IF NOT EXISTS idx_document_records_scope ON document_records("dossierId", "submissionId", "companyId", "documentType");
CREATE INDEX IF NOT EXISTS idx_document_records_status ON document_records(status, "updatedAt");
CREATE INDEX IF NOT EXISTS idx_document_records_review ON document_records("projectId", "reviewStatus");

CREATE TABLE IF NOT EXISTS document_upload_jobs (
  id TEXT PRIMARY KEY,
  "recordId" TEXT NOT NULL REFERENCES document_records(id) ON DELETE CASCADE,
  operation TEXT NOT NULL DEFAULT 'upload',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "nextAttemptAt" TEXT NOT NULL DEFAULT '',
  "fileName" TEXT NOT NULL DEFAULT '',
  "storagePath" TEXT NOT NULL DEFAULT '',
  "sizeBytes" BIGINT NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  "errorMessage" TEXT NOT NULL DEFAULT '',
  "flowResult" TEXT NOT NULL DEFAULT '{}',
  "startedAt" TEXT NOT NULL DEFAULT '',
  "finishedAt" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS idx_document_upload_jobs_status ON document_upload_jobs(status, "nextAttemptAt", "createdAt");
CREATE INDEX IF NOT EXISTS idx_document_upload_jobs_recordId ON document_upload_jobs("recordId");

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
