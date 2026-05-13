import { readFile } from "node:fs/promises";

import {
  claimNextDocumentUploadJob,
  completeDocumentUploadJob,
  failDocumentUploadJob,
  getDocumentRecordById,
  recoverStuckUploadingJobs,
} from "./db.js";
import { callFlow, getFlowConfig } from "./flows.js";
import { getUploadStorageConfig } from "./documentFiles.js";

function cleanString(value) {
  return String(value || "").trim();
}

function unwrapBody(value) {
  if (value && typeof value === "object" && value.body !== undefined) {
    return value.body;
  }
  return value;
}

function readFirst(source, candidates) {
  const value = unwrapBody(source);
  if (!value || typeof value !== "object") return "";

  for (const candidate of candidates) {
    const direct = candidate
      .split(".")
      .reduce((current, key) => (current == null ? null : current[key]), value);
    if (direct != null && cleanString(direct)) return cleanString(direct);
  }

  for (const nestedKey of ["file", "item", "driveItem", "record", "data", "body"]) {
    if (value[nestedKey] && typeof value[nestedKey] === "object") {
      const nested = readFirst(value[nestedKey], candidates);
      if (nested) return nested;
    }
  }

  return "";
}

function extractSharePointInfo(result) {
  return {
    filePath: readFirst(result, [
      "filePath",
      "ServerRelativeUrl",
      "Path",
      "FileRef",
      "RelativeUrl",
      "DecodedUrl",
      "ServerRelativePath.DecodedUrl",
    ]),
    fileIdentifier: readFirst(result, [
      "fileIdentifier",
      "Identifier",
      "UniqueId",
      "DriveItemId",
      "FileId",
      "Id",
      "id",
    ]),
    link: readFirst(result, [
      "link",
      "Link",
      "sharePointUrl",
      "SharePointUrl",
      "webUrl",
      "EncodedAbsUrl",
      "AbsoluteUri",
    ]),
  };
}

function retryDelayMs(attempts) {
  const attempt = Math.max(1, Number(attempts) || 1);
  return Math.min(15 * 60 * 1000, 15 * 1000 * 2 ** (attempt - 1));
}

// Errors that must NOT count against the attempts budget. They represent
// operator-fixable misconfiguration: leaving the job pending lets it pick up
// the moment the env var/file is restored, instead of burning all 5 retries.
const CONFIG_ERROR = Symbol("config-error");
const MISSING_STORAGE = Symbol("missing-storage");

function isMissingStorageError(error) {
  return error && (error.code === "ENOENT" || /ENOENT/i.test(String(error?.message || "")));
}

async function processJob(job, env = process.env) {
  const flowConfig = getFlowConfig(env);
  const record = getDocumentRecordById(job.recordId);
  if (!record) {
    await failDocumentUploadJob({
      jobId: job.id,
      errorMessage: "Local document record not found.",
      retryDelayMs: 0,
      permanent: true,
    });
    return;
  }

  const flowUrl = job.operation === "update"
    ? flowConfig.updateUrl
    : flowConfig.uploadUrl;
  const label = job.operation === "update" ? "UPDATE_FILE" : "UPLOAD_FILE";
  if (!flowUrl) {
    const err = new Error(`${label}: configure the corresponding POWER_AUTOMATE_* URL.`);
    err.kind = CONFIG_ERROR;
    throw err;
  }

  let buffer;
  try {
    buffer = await readFile(job.storagePath);
  } catch (error) {
    if (isMissingStorageError(error)) {
      const err = new Error(
        `Local staging file missing for job ${job.id} (${job.storagePath}).`
      );
      err.kind = MISSING_STORAGE;
      throw err;
    }
    throw error;
  }

  const payload = {
    ...(job.payload || {}),
    fileName: job.fileName,
    fileContent: buffer.toString("base64"),
  };

  const result = await callFlow(label, flowUrl, payload);
  await completeDocumentUploadJob({
    jobId: job.id,
    flowResult: result,
    sharePoint: extractSharePointInfo(result),
  });
}

export function startDocumentUploadWorker({ env = process.env } = {}) {
  const config = getUploadStorageConfig(env);
  if (!config.workerEnabled) {
    console.log("[upload-worker] disabled by PORTAL_UPLOAD_WORKER_ENABLED=false");
    return { stop: async () => {}, runOnce: async () => {} };
  }

  let timer = null;
  let running = false;
  let stopped = false;
  let activeRun = null;

  // Recover jobs that were mid-upload when the previous process died. Without
  // this, the rows are invisible to the claim query and stay stuck forever.
  try {
    const recovered = recoverStuckUploadingJobs();
    if (recovered.jobs || recovered.records) {
      console.log(
        `[upload-worker] recovered ${recovered.jobs} interrupted job(s), ${recovered.records} record(s)`
      );
    }
  } catch (error) {
    console.warn(
      "[upload-worker] recovery on startup failed:",
      error?.message || error
    );
  }

  async function processNextBatch() {
    for (let i = 0; i < 5; i += 1) {
      if (stopped) break;
      const job = claimNextDocumentUploadJob();
      if (!job) break;
      try {
        await processJob(job, env);
        // After each completed job, re-check the stop flag so a SIGTERM that
        // arrives mid-batch doesn't force the worker to also pick up the next
        // 4 jobs before honoring shutdown.
        if (stopped) break;
      } catch (error) {
        const message = error?.message || String(error);
        console.warn(`[upload-worker] ${job.id} failed: ${message}`);

        if (error?.kind === CONFIG_ERROR) {
          // Misconfiguration: do not consume retry budget. Push the job back
          // to 'pending' with a 1-minute deferral so the worker rechecks once
          // the operator has had a chance to fix the env.
          await failDocumentUploadJob({
            jobId: job.id,
            errorMessage: message,
            retryDelayMs: 60 * 1000,
            preserveAttempts: true,
          });
          continue;
        }

        if (error?.kind === MISSING_STORAGE) {
          // The staging file is gone (manual delete, disk wipe, premature
          // purge). Retrying is pointless - fail the job permanently so an
          // operator can investigate without it ping-ponging in the queue.
          await failDocumentUploadJob({
            jobId: job.id,
            errorMessage: message,
            retryDelayMs: 0,
            permanent: true,
          });
          continue;
        }

        await failDocumentUploadJob({
          jobId: job.id,
          errorMessage: message,
          retryDelayMs: retryDelayMs(job.attempts),
        });
      }
    }
  }

  async function runOnce() {
    if (running || stopped) return;
    running = true;
    activeRun = processNextBatch().finally(() => {
      running = false;
      activeRun = null;
    });
    await activeRun;
  }

  function schedule() {
    if (stopped) return;
    timer = setInterval(() => {
      // setInterval doesn't await, so swallow rejection to avoid unhandled
      // rejection warnings. processNextBatch already logs per-job failures.
      runOnce().catch(() => {});
    }, config.workerIntervalMs);
    timer.unref?.();
  }

  schedule();
  setTimeout(() => {
    runOnce().catch(() => {});
  }, 1000).unref?.();
  console.log(
    `[upload-worker] enabled; interval=${config.workerIntervalMs}ms maxAttempts=${config.workerMaxAttempts}`
  );

  return {
    runOnce,
    async stop() {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (activeRun) {
        try { await activeRun; } catch { /* already logged per-job */ }
      }
    },
  };
}
