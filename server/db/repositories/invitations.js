import { getPool } from "../pool.js";
import { parseJsonObject } from "../serialize.js";

export async function isInvitationRevoked(id) {
  const pool = getPool();
  const result = await pool.query(
    "SELECT 1 FROM revoked_invitations WHERE id = $1 LIMIT 1",
    [id]
  );
  return result.rowCount > 0;
}

export async function revokeInvitation({ id, reason = "", payload = {} }) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO revoked_invitations (id, reason, payload)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET
       "revokedAt" = NOW() AT TIME ZONE 'UTC',
       reason = EXCLUDED.reason,
       payload = EXCLUDED.payload`,
    [id, String(reason || "").trim(), JSON.stringify(payload || {})]
  );
  return { ok: true };
}

export async function listRevokedInvitations(limit = 50) {
  const pool = getPool();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
  const result = await pool.query(
    'SELECT * FROM revoked_invitations ORDER BY "revokedAt" DESC LIMIT $1',
    [safeLimit]
  );
  return result.rows.map((row) => ({
    ...row,
    revokedAt: row.revokedAt instanceof Date ? row.revokedAt.toISOString() : row.revokedAt,
    payload: parseJsonObject(row.payload, {}),
  }));
}

// Revoke every still-active invitation matching the given scope in one SQL
// statement. "Active" = not already in revoked_invitations AND status in
// (generated, sent) AND not past its expiry. Reuses revoked_invitations as
// the single source of truth — same shape as single-link revoke, so existing
// `isInvitationRevoked` / findReusableSignedInvitation checks keep working.
//
// scope: { projectId, companyId? } — projectId is required, companyId narrows
// the scope to a single company within the project.
export async function bulkRevokeInvitations({
  projectId,
  companyId = "",
  reason = "",
  now = new Date(),
}) {
  const project = String(projectId || "").trim();
  if (!project) {
    return { ok: false, revoked: 0, ids: [], error: "projectId required" };
  }
  const company = String(companyId || "").trim();
  const pool = getPool();

  // INSERT...SELECT keeps the operation atomic and avoids a round-trip per id.
  // We persist a minimal payload snapshot so downstream audit/UI keeps working
  // even after the signed_invitations row is pruned later.
  const result = await pool.query(
    `INSERT INTO revoked_invitations (id, reason, payload)
     SELECT s.id,
            $3 AS reason,
            jsonb_build_object(
              'companyId', s."companyId",
              'companyName', COALESCE(s.payload->>'companyName', ''),
              'submissionId', s."submissionId",
              'dossierId', COALESCE(s.payload->>'dossierId', ''),
              'projectId', s."projectId",
              'exp', COALESCE(to_char(s.exp, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), ''),
              'iat', COALESCE(to_char(s.iat, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), ''),
              'nonce', COALESCE(s.payload->>'nonce', ''),
              'bulkScope', CASE WHEN $2 <> '' THEN 'company' ELSE 'project' END
            )::text AS payload
     FROM signed_invitations s
     LEFT JOIN revoked_invitations r ON r.id = s.id
     WHERE s."projectId" = $1
       AND ($2 = '' OR s."companyId" = $2)
       AND s.status IN ('generated', 'sent')
       AND r.id IS NULL
       AND (s.exp IS NULL OR s.exp >= $4::timestamptz)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [project, company, String(reason || "").trim(), now.toISOString()]
  );

  const ids = result.rows.map((row) => row.id);
  return { ok: true, revoked: ids.length, ids };
}

export async function pruneRevokedInvitations({
  now = new Date(),
  graceMs = 30 * 24 * 60 * 60 * 1000,
} = {}) {
  const pool = getPool();
  const cutoff = new Date(now.getTime() - graceMs).toISOString();
  const result = await pool.query(
    `DELETE FROM revoked_invitations
     WHERE payload::jsonb->>'exp' IS NOT NULL
       AND payload::jsonb->>'exp' <> ''
       AND (payload::jsonb->>'exp')::timestamptz < $1::timestamptz`,
    [cutoff]
  );
  return { ok: true, removed: result.rowCount || 0, cutoff };
}
