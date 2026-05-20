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
