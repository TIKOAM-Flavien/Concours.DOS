import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { readAdminSession } from "../adminAuth.js";
import {
  getDocumentRecordById,
  listDocumentRecordsForProjectWithHistory,
  listDocumentUploadJobsForProject,
  updateDocumentRecordReview,
} from "../db.js";
import { reviewStatusSchema, validateBody } from "../lib/validation.js";

// Extracted from adminRoutes.js so the file stays maintainable. All routes
// require admin auth + share the same ctx contract as the parent registrar.
export function registerAdminDocumentRoutes(app, ctx) {
  const {
    wrap,
    badRequest,
    requireAdminAuth,
    normalizeTextField,
    recordsToFlowRows,
    documentRecordToFlowRow,
    audit,
    env,
  } = ctx;

  app.post(
    "/api/admin/documents",
    requireAdminAuth,
    wrap(async (req, res) => {
      const payload = {
        projectId: normalizeTextField(req.body?.projectId, "projectId", { max: 180 }),
        dossierId: normalizeTextField(req.body?.dossierId, "dossierId", {
          required: true,
          max: 180,
        }),
        companyId: normalizeTextField(req.body?.companyId, "companyId", { max: 120 }),
        companyName: normalizeTextField(req.body?.companyName, "companyName", {
          max: 180,
        }),
        submissionId: normalizeTextField(req.body?.submissionId, "submissionId", {
          max: 180,
        }),
      };

      res.json(recordsToFlowRows(await listDocumentRecordsForProjectWithHistory(payload)));
    })
  );

  app.post(
    "/api/admin/documents/:recordId/download",
    requireAdminAuth,
    wrap(async (req, res) => {
      const record = await getDocumentRecordById(req.params.recordId);
      if (!record || ["deleted", "superseded"].includes(record.status)) {
        return res.status(404).json({ error: "Document introuvable." });
      }
      if (!record.storagePath) {
        return res.status(410).json({ error: "Fichier local plus disponible sur le serveur." });
      }

      const stats = await stat(record.storagePath).catch(() => null);
      if (!stats) {
        return res.status(410).json({ error: "Fichier local plus disponible sur le serveur." });
      }

      await audit(req, "admin.document.download", {
        recordId: record.id,
        projectId: record.projectId,
        companyId: record.companyId,
        documentType: record.documentType,
      });

      const fileName = record.fileName || record.originalFileName || "document";
      res.setHeader("Content-Type", record.mimeType || "application/octet-stream");
      res.setHeader("Content-Length", String(stats.size));
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
      );
      res.setHeader("X-Review-Status", record.reviewStatus || "pending");
      res.setHeader("X-File-Name", encodeURIComponent(fileName));

      const stream = createReadStream(record.storagePath);
      stream.on("error", (error) => {
        const logger = req?.log || console;
        logger.error({ err: error }, "[admin.download] stream error");
        if (!res.headersSent) res.status(500).end();
        else res.destroy(error);
      });
      stream.pipe(res);
    })
  );

  app.patch(
    "/api/admin/documents/:recordId/review",
    requireAdminAuth,
    validateBody(reviewStatusSchema),
    wrap(async (req, res) => {
      const { reviewStatus, reviewComment = "" } = req.body;

      const record = await getDocumentRecordById(req.params.recordId);
      if (!record || ["deleted", "superseded"].includes(record.status)) {
        return res.status(404).json({ error: "Document introuvable." });
      }

      const session = readAdminSession(req, env);
      const reviewedBy = session?.username || "admin";

      const updated = await updateDocumentRecordReview(record.id, {
        reviewStatus,
        reviewComment,
        reviewedBy,
      });
      if (!updated) {
        return res.status(404).json({ error: "Document introuvable." });
      }

      await audit(req, "admin.document.review", {
        recordId: updated.id,
        projectId: updated.projectId,
        companyId: updated.companyId,
        documentType: updated.documentType,
        reviewStatus,
        reviewedBy,
      });

      res.json(documentRecordToFlowRow(updated));
    })
  );

  app.get(
    "/api/admin/upload-jobs",
    requireAdminAuth,
    wrap(async (req, res) => {
      const projectId = normalizeTextField(req.query?.projectId, "projectId", { max: 180 });
      const dossierId = normalizeTextField(req.query?.dossierId, "dossierId", { max: 180 });
      if (!projectId && !dossierId) {
        throw badRequest("Missing required query: projectId or dossierId");
      }
      res.json(
        await listDocumentUploadJobsForProject({
          projectId,
          dossierId,
        })
      );
    })
  );
}
