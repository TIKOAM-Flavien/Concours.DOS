import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

let pool = null;
let initPromise = null;

export function resolveDatabaseUrl(env = process.env) {
  const url = String(env.DATABASE_URL || "").trim();
  if (url) return url;

  const legacyPath = String(env.PORTAL_ADMIN_DB_PATH || "").trim();
  if (legacyPath) {
    console.warn(
      "[db] PORTAL_ADMIN_DB_PATH is deprecated. Set DATABASE_URL=postgresql://… instead."
    );
  }

  return "";
}

export function getPool() {
  if (!pool) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return pool;
}

export async function initDatabase(env = process.env) {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const databaseUrl = resolveDatabaseUrl(env);
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL is required (postgresql://user:pass@host:5432/dbname). " +
          "PORTAL_ADMIN_DB_PATH (SQLite) is no longer supported at runtime."
      );
    }

    pool = new pg.Pool({
      connectionString: databaseUrl,
      max: Math.max(parseInt(env.PG_POOL_MAX || "10", 10) || 10, 1),
    });

    pool.on("error", (err) => {
      console.error("[db] pool error:", err?.message || err);
    });

    const { runMigrations } = await import("./migrate.js");
    await runMigrations(pool);
  })();

  return initPromise;
}

export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
  }
  initPromise = null;
}

export function loadSchemaSql() {
  return readFileSync(resolve(__dirname, "schema.sql"), "utf8");
}
