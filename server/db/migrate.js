import { loadSchemaSql } from "./pool.js";

const SCHEMA_VERSION = 6;

async function migrateInvitationStatusColumns(client) {
  await client.query(`
    ALTER TABLE signed_invitations
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'generated',
      ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS "replacesInvitationId" TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_signed_invitations_status ON signed_invitations(status)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_signed_invitations_project_company
      ON signed_invitations("projectId", "companyId", "createdAt" DESC)
  `);
  await client.query(`
    UPDATE signed_invitations
    SET status = 'expired',
        "updatedAt" = NOW() AT TIME ZONE 'UTC'
    WHERE status = 'generated'
      AND exp IS NOT NULL
      AND exp < NOW() AT TIME ZONE 'UTC'
  `);
}

async function migrateDropLegacyRemoteStorageColumns(client) {
  await client.query(`
    ALTER TABLE document_records
      DROP COLUMN IF EXISTS "sharePointFilePath",
      DROP COLUMN IF EXISTS "sharePointFileIdentifier",
      DROP COLUMN IF EXISTS "sharePointLink"
  `);
}

async function migrateDocumentReviewColumns(client) {
  await client.query(`
    ALTER TABLE document_records
      ADD COLUMN IF NOT EXISTS "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS "reviewedAt" TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS "reviewComment" TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS "reviewedBy" TEXT NOT NULL DEFAULT ''
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_document_records_review
      ON document_records("projectId", "reviewStatus")
  `);
}

async function migrateInvitationEvents(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS invitation_events (
      id BIGSERIAL PRIMARY KEY,
      "invitationId" TEXT NOT NULL REFERENCES signed_invitations(id) ON DELETE CASCADE,
      "eventType" TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'recipient',
      "actorIpHash" TEXT NOT NULL DEFAULT '',
      "userAgent" TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_invitation_events_invitationId
      ON invitation_events("invitationId", "createdAt" DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_invitation_events_eventType
      ON invitation_events("eventType", "createdAt" DESC)
  `);
}

export async function runMigrations(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists"
    );
    if (!rows[0]?.exists) {
      await client.query(loadSchemaSql());
      await client.query(
        "INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING",
        [SCHEMA_VERSION]
      );
    } else {
      const current = await client.query(
        "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations"
      );
      const version = Number(current.rows[0]?.version) || 0;
      if (version < SCHEMA_VERSION) {
        if (version < 3) {
          await migrateInvitationStatusColumns(client);
        }
        if (version < 4) {
          await migrateInvitationEvents(client);
        }
        if (version < 5) {
          await migrateDocumentReviewColumns(client);
        }
        if (version < 6) {
          await migrateDropLegacyRemoteStorageColumns(client);
        }
        await client.query(loadSchemaSql());
        for (let next = version + 1; next <= SCHEMA_VERSION; next += 1) {
          await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [next]);
        }
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function checkDatabaseHealth(pool) {
  const result = await pool.query("SELECT 1 AS ok");
  return Boolean(result.rows[0]?.ok);
}
