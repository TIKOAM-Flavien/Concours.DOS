import { getPool } from "../pool.js";
import { parseJsonObject, sha256Hex, stableJson } from "../serialize.js";

export async function scrubOldAuditPayloads({
  now = new Date(),
  retentionMs = 90 * 24 * 60 * 60 * 1000,
} = {}) {
  const pool = getPool();
  const cutoff = new Date(now.getTime() - retentionMs).toISOString();
  const result = await pool.query(
    `UPDATE audit_log SET payload = '{}'
     WHERE payload <> '{}'
       AND "createdAt" < $1::timestamptz`,
    [cutoff]
  );
  return { ok: true, scrubbed: result.rowCount || 0, cutoff };
}

export async function writeAuditLog({ actorIp = "", action, payload = {} }) {
  const safeAction = String(action || "").trim();
  if (!safeAction) return { ok: false };

  const pool = getPool();
  const payloadJson = stableJson(payload);
  await pool.query(
    `INSERT INTO audit_log ("actorIp", action, "payloadHash", payload)
     VALUES ($1, $2, $3, $4)`,
    [String(actorIp || "").trim(), safeAction, sha256Hex(payloadJson), payloadJson]
  );

  return { ok: true };
}

function serializeAuditRow(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    actorIp: row.actorIp || "",
    action: row.action || "",
    payload: parseJsonObject(row.payload, {}),
    createdAt:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt || "",
  };
}

export async function listAuditLogsForProject(projectId, { limit = 200 } = {}) {
  const pid = String(projectId || "").trim();
  if (!pid) return [];

  const pool = getPool();
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const result = await pool.query(
    `SELECT id, "actorIp", action, payload, "createdAt"
     FROM audit_log
     WHERE payload::jsonb->>'projectId' = $1
        OR (
          action = 'admin.invitation.sign'
          AND payload::jsonb->>'invitationId' IN (
            SELECT id FROM signed_invitations WHERE "projectId" = $1
          )
        )
     ORDER BY "createdAt" DESC
     LIMIT $2`,
    [pid, safeLimit]
  );
  return result.rows.map(serializeAuditRow).filter(Boolean);
}
