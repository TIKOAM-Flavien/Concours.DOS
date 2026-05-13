import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Busboy from "busboy";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

function cleanString(value) {
  return String(value || "").trim();
}

function parsePositiveInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function safeDiskFileName(value, fallback = "upload.bin") {
  const base = cleanString(value).split(/[\\/]/).pop() || fallback;
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^_+/, "");
  return safe || fallback;
}

function isWithinDirectory(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !rel.includes(":"));
}

export function getUploadStorageConfig(env = process.env) {
  const stagingDir = cleanString(env.PORTAL_UPLOAD_STAGING_DIR)
    ? resolve(env.PORTAL_UPLOAD_STAGING_DIR)
    : resolve(rootDir, "server", "uploads");

  return {
    stagingDir,
    retentionDays: parsePositiveInt(env.PORTAL_UPLOAD_RETENTION_DAYS, 14),
    workerEnabled:
      cleanString(env.PORTAL_UPLOAD_WORKER_ENABLED).toLowerCase() !== "false",
    workerIntervalMs: parsePositiveInt(env.PORTAL_UPLOAD_WORKER_INTERVAL_MS, 5000),
    workerMaxAttempts: parsePositiveInt(env.PORTAL_UPLOAD_WORKER_MAX_ATTEMPTS, 5),
  };
}

export async function removeStoredUploadDir(uploadId, env = process.env) {
  const { stagingDir } = getUploadStorageConfig(env);
  const target = resolve(stagingDir, safeDiskFileName(uploadId, "upload"));
  if (!isWithinDirectory(stagingDir, target)) return;
  await rm(target, { recursive: true, force: true });
}

export async function parseMultipartFileUpload(req, {
  uploadId,
  maxFileBytes,
  env = process.env,
} = {}) {
  const contentType = cleanString(req.headers["content-type"]).toLowerCase();
  if (!contentType.includes("multipart/form-data")) {
    const error = new Error("Expected multipart/form-data upload.");
    error.statusCode = 415;
    throw error;
  }

  const { stagingDir } = getUploadStorageConfig(env);
  const safeUploadId = safeDiskFileName(uploadId || randomUUID(), "upload");
  const uploadDir = resolve(stagingDir, safeUploadId);
  if (!isWithinDirectory(stagingDir, uploadDir)) {
    const error = new Error("Invalid upload staging path.");
    error.statusCode = 400;
    throw error;
  }
  await mkdir(uploadDir, { recursive: true });

  return await new Promise((resolvePromise, rejectPromise) => {
    const fields = {};
    let fileInfo = null;
    let filePromise = null;
    let fileTooLarge = false;
    let settled = false;

    const reject = async (error) => {
      if (settled) return;
      settled = true;
      try {
        if (typeof req.unpipe === "function") req.unpipe(busboy);
      } catch {
        // best effort: an already-detached pipe is harmless.
      }
      // Drain the rest of the body so the socket isn't left half-read; many
      // HTTP clients hang forever otherwise.
      if (typeof req.resume === "function") req.resume();
      await rm(uploadDir, { recursive: true, force: true }).catch(() => {});
      rejectPromise(error);
    };

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: Math.max(1, Number(maxFileBytes) || 1),
        fields: 30,
        fieldSize: 5000,
      },
    });

    busboy.on("field", (name, value) => {
      fields[cleanString(name)] = cleanString(value).slice(0, 5000);
    });

    busboy.on("file", (_name, stream, info = {}) => {
      if (fileInfo) {
        stream.resume();
        const error = new Error("Only one file can be uploaded.");
        error.statusCode = 400;
        reject(error);
        return;
      }

      const originalFileName = safeDiskFileName(info.filename, "upload.bin");
      const extension = extname(originalFileName).slice(0, 24);
      const diskFileName = `${safeUploadId}${extension || ".bin"}`;
      const storagePath = resolve(uploadDir, diskFileName);
      const hash = createHash("sha256");
      let sizeBytes = 0;
      const out = createWriteStream(storagePath, { flags: "wx" });

      stream.on("limit", () => {
        // Reject as soon as the byte ceiling is hit instead of waiting for
        // the rest of the request body. Busboy truncates further data but the
        // socket keeps flowing, which wastes bandwidth + disk on the
        // already-written prefix. Destroying the file stream releases the fd
        // and reject() unpipes the request.
        fileTooLarge = true;
        const error = new Error("File too large.");
        error.statusCode = 413;
        stream.resume();
        out.destroy();
        reject(error);
      });
      stream.on("data", (chunk) => {
        sizeBytes += chunk.length;
        hash.update(chunk);
      });

      filePromise = new Promise((resolveFile, rejectFile) => {
        out.on("error", rejectFile);
        out.on("finish", async () => {
          try {
            const written = await stat(storagePath);
            resolveFile({
              originalFileName,
              diskFileName,
              storagePath,
              mimeType: cleanString(info.mimeType),
              sizeBytes: written.size || sizeBytes,
              sha256: hash.digest("hex"),
            });
          } catch (error) {
            rejectFile(error);
          }
        });
      });

      stream.pipe(out);
      fileInfo = { pending: true };
    });

    busboy.on("filesLimit", () => {
      const error = new Error("Only one file can be uploaded.");
      error.statusCode = 400;
      reject(error);
    });

    busboy.on("error", reject);
    // Surface client/socket aborts so we don't leak the per-upload temp dir.
    req.on("error", reject);
    req.on("aborted", () => {
      const error = new Error("Upload aborted by client.");
      error.statusCode = 400;
      reject(error);
    });

    busboy.on("finish", async () => {
      if (settled) return;
      try {
        if (fileTooLarge) {
          const error = new Error("File too large.");
          error.statusCode = 413;
          throw error;
        }
        if (!filePromise) {
          const error = new Error("Missing required file field: file");
          error.statusCode = 400;
          throw error;
        }
        const file = await filePromise;
        settled = true;
        resolvePromise({ fields, file, uploadDir });
      } catch (error) {
        await reject(error);
      }
    });

    req.pipe(busboy);
  });
}
