import { readFile } from "node:fs/promises";

import {
  listDocumentRecordsForInvitation,
  markDocumentRecordDeleted,
} from "../db.js";
import { removeStoredUploadDir } from "../documentFiles.js";

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
    purgeExpiredLocalDocumentFiles,
    audit,
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

      const buffer = await readFile(record.storagePath);
      await commitSubmissionDailyBudget(invitation, { cost: 1 });

      res.json({
        success: true,
        localOnly: true,
        fileContent: buffer.toString("base64"),
        filePath: `local:${record.id}`,
        fileName: record.fileName,
      });
    })
  );

  app.post(
    "/api/portal/maintenance/cleanup",
    wrap(async (req, res) => {
      const purgedUploads = await purgeExpiredLocalDocumentFiles();
      await audit(req, "portal.maintenance.cleanup", {
        purgedUploads: purgedUploads.removed,
      });
      res.json({ ok: true, purgedUploads });
    })
  );
}
