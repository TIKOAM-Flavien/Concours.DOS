import { isInvitationStatus } from "../../../shared/invitationStatus.js";
import { getPool } from "../pool.js";
import { parseJsonObject } from "../serialize.js";

const ACTIVE_STATUSES = ["generated", "sent"];

function mapInvitationRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    payload: parseJsonObject(row.payload, {}),
    projectId: row.projectId,
    companyId: row.companyId,
    submissionId: row.submissionId,
    status: row.status,
    sentAt: row.sentAt instanceof Date ? row.sentAt.toISOString() : row.sentAt || null,
    replacesInvitationId: row.replacesInvitationId || "",
    iat: row.iat instanceof Date ? row.iat.toISOString() : row.iat,
    exp: row.exp instanceof Date ? row.exp.toISOString() : row.exp || null,
    createdAt:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt:
      row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}

export async function reissuePriorInvitations({
  projectId,
  companyId,
  exceptId,
  now = new Date(),
}) {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE signed_invitations
     SET status = 'reissued',
         "updatedAt" = $4::timestamptz
     WHERE "projectId" = $1
       AND "companyId" = $2
       AND id <> $3
       AND status = ANY($5::text[])`,
    [
      String(projectId || ""),
      String(companyId || ""),
      String(exceptId || ""),
      now.toISOString(),
      ACTIVE_STATUSES,
    ]
  );
  return { ok: true, reissued: result.rowCount || 0 };
}

export async function insertSignedInvitation({
  id,
  payload,
  projectId = "",
  companyId = "",
  submissionId = "",
  iat,
  exp = null,
  replacesInvitationId = "",
}) {
  const pool = getPool();

  if (projectId && companyId) {
    await reissuePriorInvitations({ projectId, companyId, exceptId: id });
  }

  await pool.query(
    `INSERT INTO signed_invitations (
       id, payload, "projectId", "companyId", "submissionId",
       status, "sentAt", "replacesInvitationId", iat, exp
     )
     VALUES ($1, $2::jsonb, $3, $4, $5, 'generated', NULL, $6, $7::timestamptz, $8::timestamptz)`,
    [
      id,
      JSON.stringify(payload || {}),
      String(projectId || ""),
      String(companyId || ""),
      String(submissionId || ""),
      String(replacesInvitationId || ""),
      iat,
      exp || null,
    ]
  );
  return { ok: true, id, status: "generated" };
}

export async function getSignedInvitationById(id) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, payload, "projectId", "companyId", "submissionId",
            status, "sentAt", "replacesInvitationId", iat, exp, "createdAt", "updatedAt"
     FROM signed_invitations
     WHERE id = $1
     LIMIT 1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;

  const invitation = mapInvitationRow(row);
  if (
    invitation.exp &&
    ACTIVE_STATUSES.includes(invitation.status) &&
    Date.now() > new Date(invitation.exp).getTime()
  ) {
    await markInvitationsExpired([invitation.id]);
    invitation.status = "expired";
  }

  return invitation;
}

export async function findReusableSignedInvitation({
  projectId,
  companyDbId = "",
  companyId = "",
  now = new Date(),
}) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT s.id, s.payload, s."projectId", s."companyId", s."submissionId",
            s.status, s."sentAt", s."replacesInvitationId", s.iat, s.exp,
            s."createdAt", s."updatedAt"
     FROM signed_invitations s
     LEFT JOIN revoked_invitations r ON r.id = s.id
     WHERE s."projectId" = $1
       AND s.status = ANY($4::text[])
       AND r.id IS NULL
       AND (s.exp IS NULL OR s.exp >= $5::timestamptz)
       AND (
         ($2 <> '' AND s.payload->>'companyDbId' = $2)
         OR ($3 <> '' AND s."companyId" = $3)
       )
     ORDER BY
       CASE WHEN $2 <> '' AND s.payload->>'companyDbId' = $2 THEN 0 ELSE 1 END,
       s."createdAt" DESC
     LIMIT 1`,
    [
      String(projectId || ""),
      String(companyDbId || ""),
      String(companyId || ""),
      ACTIVE_STATUSES,
      now.toISOString(),
    ]
  );
  return mapInvitationRow(result.rows[0]);
}

export async function updateSignedInvitationPayload({
  id,
  payload,
  projectId = "",
  companyId = "",
  submissionId = "",
  now = new Date(),
}) {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE signed_invitations
     SET payload = $2::jsonb,
         "projectId" = $3,
         "companyId" = $4,
         "submissionId" = $5,
         "updatedAt" = $6::timestamptz
     WHERE id = $1
     RETURNING id, payload, "projectId", "companyId", "submissionId",
               status, "sentAt", "replacesInvitationId", iat, exp,
               "createdAt", "updatedAt"`,
    [
      String(id || ""),
      JSON.stringify(payload || {}),
      String(projectId || ""),
      String(companyId || ""),
      String(submissionId || ""),
      now.toISOString(),
    ]
  );
  return mapInvitationRow(result.rows[0]);
}

export async function markInvitationsSent(ids = [], { now = new Date() } = {}) {
  const pool = getPool();
  const safeIds = [...new Set(ids.map((value) => String(value || "").trim()).filter(Boolean))];
  if (!safeIds.length) return { ok: true, updated: 0 };

  const result = await pool.query(
    `UPDATE signed_invitations
     SET status = 'sent',
         "sentAt" = $2::timestamptz,
         "updatedAt" = $2::timestamptz
     WHERE id = ANY($1::text[])
       AND status = 'generated'`,
    [safeIds, now.toISOString()]
  );
  return { ok: true, updated: result.rowCount || 0 };
}

export async function markInvitationsExpired(ids = [], { now = new Date() } = {}) {
  const pool = getPool();
  const safeIds = [...new Set(ids.map((value) => String(value || "").trim()).filter(Boolean))];
  if (!safeIds.length) return { ok: true, updated: 0 };

  const result = await pool.query(
    `UPDATE signed_invitations
     SET status = 'expired',
         "updatedAt" = $2::timestamptz
     WHERE id = ANY($1::text[])
       AND status = ANY($3::text[])`,
    [safeIds, now.toISOString(), ACTIVE_STATUSES]
  );
  return { ok: true, updated: result.rowCount || 0 };
}

export async function markExpiredInvitations({ now = new Date() } = {}) {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE signed_invitations
     SET status = 'expired',
         "updatedAt" = $1::timestamptz
     WHERE exp IS NOT NULL
       AND exp < $1::timestamptz
       AND status = ANY($2::text[])`,
    [now.toISOString(), ACTIVE_STATUSES]
  );
  return { ok: true, updated: result.rowCount || 0 };
}

export async function listLatestInvitationsByProject(projectId) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT DISTINCT ON ("companyId")
            id, payload, "projectId", "companyId", "submissionId",
            status, "sentAt", "replacesInvitationId", iat, exp, "createdAt", "updatedAt"
     FROM signed_invitations
     WHERE "projectId" = $1
     ORDER BY "companyId", "createdAt" DESC`,
    [String(projectId || "")]
  );
  return result.rows.map(mapInvitationRow);
}

export async function listInvitationSendCountsByProject(projectId) {
  const pool = getPool();
  // Count every email actually sent (sentAt set). Re-issued links keep sentAt on
  // older rows, so reminders increment the counter unlike status = 'sent' alone.
  const result = await pool.query(
    `WITH legacy_counts AS (
       SELECT "companyId",
              COUNT(*) FILTER (WHERE "sentAt" IS NOT NULL)::int AS "sentCount"
       FROM signed_invitations
       WHERE "projectId" = $1
         AND "companyId" <> ''
       GROUP BY "companyId"
     ),
     event_counts AS (
       SELECT s."companyId",
              COUNT(e.id)::int AS "eventCount"
       FROM signed_invitations s
       JOIN invitation_events e ON e."invitationId" = s.id
       WHERE s."projectId" = $1
         AND s."companyId" <> ''
         AND e."eventType" IN ('email_sent', 'email_reminder_sent')
       GROUP BY s."companyId"
     )
     SELECT COALESCE(l."companyId", e."companyId") AS "companyId",
            GREATEST(
              COALESCE(l."sentCount", 0),
              COALESCE(e."eventCount", 0)
            )::int AS "sentCount"
     FROM legacy_counts l
     FULL OUTER JOIN event_counts e ON e."companyId" = l."companyId"`,
    [String(projectId || "")]
  );

  const map = new Map();
  for (const row of result.rows) {
    const companyId = String(row.companyId || "").trim();
    if (!companyId) continue;
    map.set(companyId, Number(row.sentCount) || 0);
  }
  return map;
}

export async function pruneExpiredSignedInvitations({
  now = new Date(),
  graceMs = 30 * 24 * 60 * 60 * 1000,
} = {}) {
  const pool = getPool();
  const cutoff = new Date(now.getTime() - graceMs).toISOString();
  const result = await pool.query(
    `DELETE FROM signed_invitations
     WHERE exp IS NOT NULL
       AND exp < $1::timestamptz
       AND status IN ('expired', 'reissued')`,
    [cutoff]
  );
  return { ok: true, removed: result.rowCount || 0, cutoff };
}

export { isInvitationStatus };
