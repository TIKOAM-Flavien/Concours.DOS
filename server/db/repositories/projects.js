import { getPool } from "../pool.js";
import {
  normalizeRecordScope,
  parseJsonArray,
  serializeCompany,
  serializeProject,
} from "../serialize.js";

export async function getAllProjects({ includeArchived = false } = {}) {
  const pool = getPool();
  // Single JOIN + jsonb_agg replaces the previous 2-query fetch-then-stitch.
  // FILTER (WHERE c.id IS NOT NULL) keeps projects without companies as an
  // empty array (LEFT JOIN would otherwise produce [null]).
  const result = await pool.query(
    `SELECT p.*,
            COALESCE(
              jsonb_agg(to_jsonb(c) ORDER BY c."companyName")
                FILTER (WHERE c.id IS NOT NULL),
              '[]'::jsonb
            ) AS companies_json
     FROM projects p
     LEFT JOIN companies c ON c."projectId" = p.id
     ${includeArchived ? "" : `WHERE p."archivedAt" = ''`}
     GROUP BY p.id
     ORDER BY ${includeArchived ? `(p."archivedAt" = '') DESC,` : ""} p."createdAt" DESC`
  );

  return result.rows.map((row) => {
    const { companies_json, ...projectRow } = row;
    return {
      ...serializeProject(projectRow),
      companies: (companies_json || []).map(serializeCompany),
    };
  });
}

export async function getProject(id) {
  const pool = getPool();
  const projectResult = await pool.query("SELECT * FROM projects WHERE id = $1", [id]);
  const row = projectResult.rows[0];
  if (!row) return null;
  const companiesResult = await pool.query(
    'SELECT * FROM companies WHERE "projectId" = $1 ORDER BY "companyName"',
    [id]
  );
  return {
    ...serializeProject(row),
    companies: companiesResult.rows.map(serializeCompany),
  };
}

export async function setProjectArchived(id, archived) {
  const existing = await getProject(id);
  if (!existing) return null;
  const pool = getPool();
  await pool.query(
    `UPDATE projects SET "archivedAt" = $2, "updatedAt" = NOW() AT TIME ZONE 'UTC' WHERE id = $1`,
    [id, archived ? new Date().toISOString() : ""]
  );
  return getProject(id);
}

export async function upsertProject({
  id,
  name,
  dossierId,
  folderPath,
  deadline,
  customDocuments,
}) {
  const pool = getPool();
  const existingResult = await pool.query("SELECT * FROM projects WHERE id = $1", [id]);
  const existing = existingResult.rows[0];
  const existingCustom = existing ? parseJsonArray(existing.customDocuments, []) : [];
  const params = [
    id,
    name,
    dossierId || "",
    folderPath || "",
    deadline || "",
    JSON.stringify(customDocuments || []),
  ];

  if (existing) {
    await pool.query(
      `UPDATE projects SET name = $2, "dossierId" = $3, "folderPath" = $4,
       deadline = $5, "customDocuments" = $6, "updatedAt" = NOW() AT TIME ZONE 'UTC'
       WHERE id = $1`,
      params
    );
  } else {
    await pool.query(
      `INSERT INTO projects (id, name, "dossierId", "folderPath", deadline, "customDocuments")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      params
    );
  }

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
    const rows = await pool.query(
      'SELECT id, "expectedDocuments" FROM companies WHERE "projectId" = $1',
      [id]
    );
    for (const row of rows.rows) {
      const expected = parseJsonArray(row.expectedDocuments, []);
      const filtered = expected.filter((docId) => !removedCustomIds.includes(docId));
      if (filtered.length === expected.length) continue;
      const companyRow = await pool.query("SELECT * FROM companies WHERE id = $1", [
        row.id,
      ]);
      const company = companyRow.rows[0];
      if (!company) continue;
      await upsertCompany({
        id: row.id,
        projectId: id,
        companyName: company.companyName || "",
        companyId: company.companyId || "",
        contactName: company.contactName || "",
        companyEmail: company.companyEmail || "",
        submissionId: company.submissionId || "",
        expectedDocuments: filtered,
      });
    }
  }

  return getProject(id);
}

export async function deleteProject(id) {
  const pool = getPool();
  await pool.query("DELETE FROM projects WHERE id = $1", [id]);
}

export async function upsertCompany({
  id,
  projectId,
  companyName,
  companyId,
  contactName,
  companyEmail,
  submissionId,
  expectedDocuments,
}) {
  const pool = getPool();
  const existingResult = await pool.query("SELECT * FROM companies WHERE id = $1", [id]);
  const existing = existingResult.rows[0];
  const expectedDocumentsJson = JSON.stringify(expectedDocuments || []);

  if (existing) {
    // Parameters must be sequential ($1..$n). Skipping $2 breaks PostgreSQL type inference.
    await pool.query(
      `UPDATE companies SET "companyName" = $2, "companyId" = $3, "contactName" = $4,
       "companyEmail" = $5, "submissionId" = $6, "expectedDocuments" = $7,
       "updatedAt" = NOW() AT TIME ZONE 'UTC' WHERE id = $1`,
      [
        id,
        companyName,
        companyId || "",
        contactName || "",
        companyEmail || "",
        submissionId || "",
        expectedDocumentsJson,
      ]
    );
  } else {
    await pool.query(
      `INSERT INTO companies (id, "projectId", "companyName", "companyId", "contactName",
       "companyEmail", "submissionId", "expectedDocuments")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        projectId,
        companyName,
        companyId || "",
        contactName || "",
        companyEmail || "",
        submissionId || "",
        expectedDocumentsJson,
      ]
    );
  }

  const row = await pool.query("SELECT * FROM companies WHERE id = $1", [id]);
  return serializeCompany(row.rows[0]);
}

export async function deleteCompany(id) {
  const pool = getPool();
  await pool.query("DELETE FROM companies WHERE id = $1", [id]);
}

export async function findProjectForInvitationScope(scope = {}) {
  const normalized = normalizeRecordScope(scope);
  if (normalized.projectId) {
    return getProject(normalized.projectId);
  }
  if (!normalized.dossierId) return null;

  const pool = getPool();
  const result = await pool.query(
    `SELECT p.id
     FROM projects p
     LEFT JOIN companies c ON c."projectId" = p.id
     WHERE p."dossierId" = $1
       AND (
         ($2 <> '' AND c."submissionId" = $2)
         OR ($3 <> '' AND c."companyId" = $3)
         OR ($4 <> '' AND lower(c."companyName") = lower($4))
       )
     ORDER BY (p."archivedAt" = '') DESC, p."updatedAt" DESC
     LIMIT 1`,
    [
      normalized.dossierId,
      normalized.submissionId,
      normalized.companyId,
      normalized.companyName,
    ]
  );
  return result.rows[0]?.id ? getProject(result.rows[0].id) : null;
}
