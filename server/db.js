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

export default db;
