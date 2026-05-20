import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import {
  listDocumentRecordsForInvitation,
  markDocumentRecordDeleted,
} from "../db.js";
import { removeStoredUploadDir } from "../documentFiles.js";
import { publishAdminEvent } from "../lib/realtimeBus.js";

export function registerPortalRoutes(app, ctx) {
  const {
    wrap,
    maxFileMb,
    getVerifiedInvitationFromBody,
    trackInvitationEvent,
    recordsToFlowRows,
    queueDocumentUploadFromMultipart,
    checkSubmissionDailyBudget,
    commitSubmissionDailyBudget,
    resolveInvitationDocument,
    resolveLocalRecordReference,
    env,
  } = ctx;

  app.post(
    "/api/portal/verify",
    wrap(async (req, res) => {
      const invitation = await getVerifiedInvitationFromBody(req.body);
      await trackInvitationEvent(req, invitation.invitationId, "verified");
      res.json({
        ok: true,
        invitation,
        limits: {
          maxFileMb,
        },
      });
    })
  );

  app.post(
    "/api/portal/documents",
    wrap(async (req, res) => {
      const invitation = await getVerifiedInvitationFromBody(req.body);
      const rows = recordsToFlowRows(
        await listDocumentRecordsForInvitation({
          projectId: invitation.projectId,
          dossierId: invitation.dossierId,
          companyId: invitation.companyId,
          companyName: invitation.companyName,
          submissionId: invitation.submissionId,
        })
      );

      res.json(rows);
    })
  );

  app.post(
    "/api/portal/upload-jobs",
    wrap(async (req, res) => {
      const invitation = await getVerifiedInvitationFromBody(req.body);
      const records = await listDocumentRecordsForInvitation({
        projectId: invitation.projectId,
        dossierId: invitation.dossierId,
        companyId: invitation.companyId,
        companyName: invitation.companyName,
        submissionId: invitation.submissionId,
      });
      res.json(recordsToFlowRows(records));
    })
  );

  app.post(
    "/api/portal/upload",
    wrap(async (req, res) => {
      const result = await queueDocumentUploadFromMultipart(req, "upload");
      res.status(202).json(result);
    })
  );

  app.post(
    "/api/portal/update",
    wrap(async (req, res) => {
      const result = await queueDocumentUploadFromMultipart(req, "update");
      res.status(202).json(result);
    })
  );

  app.post(
    "/api/portal/delete",
    wrap(async (req, res) => {
      const invitation = await getVerifiedInvitationFromBody(req.body);
      await checkSubmissionDailyBudget(invitation, { cost: 1 });
      const document = resolveInvitationDocument(invitation, req.body?.documentId);
      const record = await resolveLocalRecordReference({
        invitation,
        filePath: req.body?.filePath,
        fileIdentifier: req.body?.fileIdentifier,
        documentId: document.id,
        requireDocumentType: true,
      });

      await markDocumentRecordDeleted(record.id);
      await removeStoredUploadDir(record.id, env).catch(() => {});
      await commitSubmissionDailyBudget(invitation, { cost: 1 });

      publishAdminEvent({
        type: "admin.invalidate",
        scope: "documents",
        projectId: invitation.projectId || "",
        companyId: invitation.companyId || "",
        operation: "delete",
      });

      res.json({ ok: true, localOnly: true });
    })
  );

  app.post(
    "/api/portal/download",
    wrap(async (req, res) => {
      const invitation = await getVerifiedInvitationFromBody(req.body);
      await checkSubmissionDailyBudget(invitation, { cost: 1 });
      const record = await resolveLocalRecordReference({
        invitation,
        filePath: req.body?.filePath,
        fileIdentifier: req.body?.fileIdentifier,
      });

      if (!record.storagePath) {
        throw new Error("Local file is no longer retained.");
      }

      const stats = await stat(record.storagePath).catch(() => null);
      if (!stats) {
        return res.status(410).json({ error: "Fichier local plus disponible sur le serveur." });
      }

      await commitSubmissionDailyBudget(invitation, { cost: 1 });

      const fileName = record.fileName || record.originalFileName || "document";
      res.setHeader("Content-Type", record.mimeType || "application/octet-stream");
      res.setHeader("Content-Length", String(stats.size));
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
      );
      res.setHeader("X-File-Name", encodeURIComponent(fileName));
      res.setHeader("X-Local-Path", `local:${record.id}`);

      const stream = createReadStream(record.storagePath);
      stream.on("error", (error) => {
        console.error("[portal.download] stream error", error);
        if (!res.headersSent) res.status(500).end();
        else res.destroy(error);
      });
      stream.pipe(res);
    })
  );

}
