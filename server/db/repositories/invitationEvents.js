import { getPool } from "../pool.js";
import { parseJsonObject } from "../serialize.js";

const KNOWN_EVENT_TYPES = new Set([
  "opened",
  "verified",
  "submitted",
  "admin_test_open",
  "email_sent",
  "email_reminder_sent",
]);

function sanitizeEventType(value) {
  const eventType = String(value || "").trim();
  if (!KNOWN_EVENT_TYPES.has(eventType)) {
    throw new Error(`Unsupported invitation event type: ${eventType || "(empty)"}`);
  }
  return eventType;
}

function serializeDate(value) {
  return value instanceof Date ? value.toISOString() : value || null;
}

export async function recordInvitationEvent({
  invitationId,
  eventType,
  source = "recipient",
  actorIpHash = "",
  userAgent = "",
  metadata = {},
  now = new Date(),
}) {
  const id = String(invitationId || "").trim();
  if (!id) return { ok: false, recorded: false };

  const pool = getPool();
  await pool.query(
    `INSERT INTO invitation_events (
       "invitationId", "eventType", source, "actorIpHash", "userAgent", metadata, "createdAt"
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)`,
    [
      id,
      sanitizeEventType(eventType),
      String(source || "recipient").trim().slice(0, 40) || "recipient",
      String(actorIpHash || "").trim().slice(0, 128),
      String(userAgent || "").trim().slice(0, 500),
      JSON.stringify(metadata || {}),
      now.toISOString(),
    ]
  );

  return { ok: true, recorded: true };
}

export async function listInvitationEventSummariesByInvitationIds(invitationIds = []) {
  const ids = [
    ...new Set(invitationIds.map((value) => String(value || "").trim()).filter(Boolean)),
  ];
  if (!ids.length) return new Map();

  const pool = getPool();
  const result = await pool.query(
    `SELECT
       "invitationId",
       COUNT(*) FILTER (WHERE "eventType" = 'opened')::int AS "openedCount",
       COUNT(*) FILTER (WHERE "eventType" = 'verified')::int AS "verifiedCount",
       MIN("createdAt") FILTER (WHERE "eventType" IN ('opened', 'verified')) AS "firstOpenedAt",
       MAX("createdAt") FILTER (WHERE "eventType" IN ('opened', 'verified')) AS "lastOpenedAt"
     FROM invitation_events
     WHERE "invitationId" = ANY($1::text[])
     GROUP BY "invitationId"`,
    [ids]
  );

  const map = new Map();
  for (const row of result.rows) {
    map.set(String(row.invitationId || ""), {
      openedCount: Number(row.openedCount) || 0,
      verifiedCount: Number(row.verifiedCount) || 0,
      firstOpenedAt: serializeDate(row.firstOpenedAt),
      lastOpenedAt: serializeDate(row.lastOpenedAt),
    });
  }
  return map;
}

function mapProjectInvitationEventRow(row) {
  const payload = parseJsonObject(row.invitationPayload, {});
  return {
    id: String(row.id),
    invitationId: row.invitationId || "",
    eventType: row.eventType || "",
    source: row.source || "",
    createdAt: serializeDate(row.createdAt),
    companyId: row.companyId || payload.companyId || "",
    companyName: row.companyName || payload.companyName || "",
    companyEmail: row.companyEmail || payload.companyEmail || "",
    submissionId: row.submissionId || payload.submissionId || "",
  };
}

export async function listInvitationEventsForProject(projectId, { limit = 150 } = {}) {
  const pid = String(projectId || "").trim();
  if (!pid) return [];

  const pool = getPool();
  const safeLimit = Math.min(Math.max(Number(limit) || 150, 1), 500);
  const result = await pool.query(
    `SELECT
       e.id,
       e."invitationId",
       e."eventType",
       e.source,
       e."createdAt",
       s."companyId",
       s."submissionId",
       s.payload AS "invitationPayload",
       COALESCE(s.payload->>'companyName', '') AS "companyName",
       COALESCE(s.payload->>'companyEmail', '') AS "companyEmail"
     FROM invitation_events e
     INNER JOIN signed_invitations s ON s.id = e."invitationId"
     WHERE s."projectId" = $1
     ORDER BY e."createdAt" DESC
     LIMIT $2`,
    [pid, safeLimit]
  );
  return result.rows.map(mapProjectInvitationEventRow);
}
