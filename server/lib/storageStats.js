import { lstat, opendir } from "node:fs/promises";

import { parsePositiveInt } from "../security.js";

function parsePositiveFloat(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function resolveStorageQuotaBytes(env = process.env) {
  const directBytes = parsePositiveInt(env.PORTAL_STORAGE_QUOTA_BYTES, 0);
  if (directBytes > 0) return directBytes;

  const gb = parsePositiveFloat(env.PORTAL_STORAGE_QUOTA_GB, 0);
  if (gb > 0) return Math.round(gb * 1024 * 1024 * 1024);

  return 15 * 1024 * 1024 * 1024;
}

export async function sumDirectoryBytes(rootDir) {
  let total = 0;
  const queue = [rootDir];

  while (queue.length) {
    const current = queue.pop();
    let dir;
    try {
      dir = await opendir(current);
    } catch {
      continue;
    }

    try {
      for await (const entry of dir) {
        const fullPath = `${current}/${entry.name}`;
        if (entry.isDirectory()) {
          queue.push(fullPath);
          continue;
        }

        if (entry.isFile()) {
          try {
            const info = await lstat(fullPath);
            total += Number(info.size) || 0;
          } catch {
            // Ignore transient files being removed while scanning.
          }
        }
      }
    } finally {
      await dir.close().catch(() => {});
    }
  }

  return total;
}
