import { createWriteStream } from "node:fs";
import { mkdir, open, rm, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Busboy from "busboy";
import { fileTypeFromBuffer } from "file-type";

import { cleanString, parseStrictPositiveInt as parsePositiveInt } from "./lib/coercions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

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
    jobMaxAttempts: parsePositiveInt(
      env.PORTAL_UPLOAD_JOB_MAX_ATTEMPTS || env.PORTAL_UPLOAD_WORKER_MAX_ATTEMPTS,
      5
    ),
  };
}

export async function removeStoredUploadDir(uploadId, env = process.env) {
  const { stagingDir } = getUploadStorageConfig(env);
  const target = resolve(stagingDir, safeDiskFileName(uploadId, "upload"));
  if (!isWithinDirectory(stagingDir, target)) return;
  await rm(target, { recursive: true, force: true });
}

// MIME types we never accept regardless of what the client claims.
// HTML/SVG/JS/JAR can carry active content; executables are obvious; archives
// were never an authorized format and we don't want them sneaking in.
const DISALLOWED_DETECTED_MIME_TYPES = new Set([
  "text/html",
  "image/svg+xml",
  "application/x-msdownload",
  "application/x-dosexec",
  "application/x-executable",
  "application/x-sharedlib",
  "application/x-mach-binary",
  "application/java-archive",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
]);

async function sniffFileMimeType(filePath) {
  // file-type only needs the first ~4100 bytes to identify the format.
  let handle = null;
  try {
    handle = await open(filePath, "r");
    const buffer = Buffer.alloc(4100);
    const { bytesRead } = await handle.read(buffer, 0, 4100, 0);
    if (!bytesRead) return { mimeType: "", extension: "" };
    const detected = await fileTypeFromBuffer(buffer.subarray(0, bytesRead));
    if (!detected) return { mimeType: "", extension: "" };
    return { mimeType: detected.mime, extension: detected.ext };
  } catch {
    return { mimeType: "", extension: "" };
  } finally {
    await handle?.close().catch(() => {});
  }
}

function assertSafeUploadType({ originalFileName, claimedMimeType, detection }) {
  if (detection.mimeType && DISALLOWED_DETECTED_MIME_TYPES.has(detection.mimeType)) {
    const error = new Error(
      `File type ${detection.mimeType} is not allowed (rejected by server-side MIME sniff).`
    );
    error.statusCode = 415;
    throw error;
  }
  // A file announced as a PDF but detected as a PE/ELF executable, an HTML
  // payload, or an image is a clear spoofing attempt. file-type returning
  // nothing (text/CSV) is fine — we just keep the client claim.
  if (detection.mimeType && claimedMimeType) {
    const claimed = claimedMimeType.toLowerCase();
    const detected = detection.mimeType.toLowerCase();
    if (claimed === "application/pdf" && detected !== "application/pdf") {
      const error = new Error(
        `Upload "${originalFileName}" was sent with Content-Type application/pdf but real type is ${detected}.`
      );
      error.statusCode = 415;
      throw error;
    }
  }
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
            const claimedMimeType = cleanString(info.mimeType);
            const detection = await sniffFileMimeType(storagePath);
            assertSafeUploadType({ originalFileName, claimedMimeType, detection });
            resolveFile({
              originalFileName,
              diskFileName,
              storagePath,
              // Prefer the type detected from the file's magic bytes over the
              // client-supplied header — the latter is trivially spoofable.
              mimeType: detection.mimeType || claimedMimeType,
              claimedMimeType,
              detectedMimeType: detection.mimeType || "",
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
