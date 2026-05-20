import { loadSchemaSql } from "./pool.js";

export const SCHEMA_VERSION = 6;

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

// === Down migrations ========================================================
//
// Reverse the corresponding migrate* function above. Each `down*` undoes the
// schema changes introduced by its `migrate*` counterpart. Data is preserved
// where possible — e.g. dropping a column drops the data in that column, but
// that's the expected cost of a rollback.
//
// IMPORTANT: down migrations are not run automatically. Use
//   `node -e "import('./server/db/migrate.js').then(m => m.rollbackTo(<n>))"`
// after manually pointing DATABASE_URL at the affected environment. See
// docs/migrations.md for the runbook.

async function downInvitationStatusColumns(client) {
  await client.query(`DROP INDEX IF EXISTS idx_signed_invitations_project_company`);
  await client.query(`DROP INDEX IF EXISTS idx_signed_invitations_status`);
  await client.query(`
    ALTER TABLE signed_invitations
      DROP COLUMN IF EXISTS status,
      DROP COLUMN IF EXISTS "sentAt",
      DROP COLUMN IF EXISTS "replacesInvitationId",
      DROP COLUMN IF EXISTS "updatedAt"
  `);
}

async function downInvitationEvents(client) {
  await client.query(`DROP TABLE IF EXISTS invitation_events`);
}

async function downDocumentReviewColumns(client) {
  await client.query(`DROP INDEX IF EXISTS idx_document_records_review`);
  await client.query(`
    ALTER TABLE document_records
      DROP COLUMN IF EXISTS "reviewStatus",
      DROP COLUMN IF EXISTS "reviewedAt",
      DROP COLUMN IF EXISTS "reviewComment",
      DROP COLUMN IF EXISTS "reviewedBy"
  `);
}

async function downDropLegacyRemoteStorageColumns(client) {
  // This migration was destructive in the up direction — re-adding the columns
  // restores the shape but the original SharePoint links can't be recovered.
  await client.query(`
    ALTER TABLE document_records
      ADD COLUMN IF NOT EXISTS "sharePointFilePath" TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS "sharePointFileIdentifier" TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS "sharePointLink" TEXT NOT NULL DEFAULT ''
  `);
}

const DOWN_MIGRATIONS = {
  6: downDropLegacyRemoteStorageColumns,
  5: downDocumentReviewColumns,
  4: downInvitationEvents,
  3: downInvitationStatusColumns,
};

export async function rollbackTo(pool, targetVersion) {
  if (!Number.isInteger(targetVersion) || targetVersion < 0) {
    throw new Error(`targetVersion must be a non-negative integer, got ${targetVersion}`);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations"
    );
    let version = Number(current.rows[0]?.version) || 0;
    if (version <= targetVersion) {
      await client.query("COMMIT");
      return { applied: [], finalVersion: version };
    }
    const applied = [];
    while (version > targetVersion) {
      const down = DOWN_MIGRATIONS[version];
      if (!down) {
        throw new Error(
          `No down migration registered for version ${version}. ` +
            `Add a downXxx() function and entry in DOWN_MIGRATIONS before retrying.`
        );
      }
      await down(client);
      await client.query("DELETE FROM schema_migrations WHERE version = $1", [version]);
      applied.push(version);
      version -= 1;
    }
    await client.query("COMMIT");
    return { applied, finalVersion: version };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
