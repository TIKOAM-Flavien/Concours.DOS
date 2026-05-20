import { getPool } from "../pool.js";
import { toBudgetDay } from "../serialize.js";

export async function getSubmissionDailyUsage({ submissionId, day = new Date() }) {
  const safeSubmissionId = String(submissionId || "").trim();
  if (!safeSubmissionId) return 0;
  const pool = getPool();
  const result = await pool.query(
    'SELECT count FROM submission_daily_budget WHERE "submissionId" = $1 AND day = $2',
    [safeSubmissionId, toBudgetDay(day)]
  );
  return Number(result.rows[0]?.count) || 0;
}

export async function bumpSubmissionDailyUsage({ submissionId, delta = 1, day = new Date() }) {
  const safeSubmissionId = String(submissionId || "").trim();
  if (!safeSubmissionId) return { ok: false, count: 0 };

  const safeDelta = Number(delta) || 0;
  if (!Number.isFinite(safeDelta) || safeDelta <= 0) {
    return {
      ok: false,
      count: await getSubmissionDailyUsage({ submissionId: safeSubmissionId, day }),
    };
  }

  const pool = getPool();
  const budgetDay = toBudgetDay(day);
  await pool.query(
    `INSERT INTO submission_daily_budget ("submissionId", day, count)
     VALUES ($1, $2, $3)
     ON CONFLICT ("submissionId", day) DO UPDATE SET
       count = submission_daily_budget.count + EXCLUDED.count,
       "updatedAt" = NOW() AT TIME ZONE 'UTC'`,
    [safeSubmissionId, budgetDay, Math.floor(safeDelta)]
  );

  return {
    ok: true,
    count: await getSubmissionDailyUsage({ submissionId: safeSubmissionId, day }),
  };
}
