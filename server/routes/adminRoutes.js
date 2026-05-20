import { statfs } from "node:fs/promises";
import rateLimit from "express-rate-limit";
import { resolveDocumentList } from "../../src/config/documentCatalog.js";
import { publishAdminEvent, subscribeToAdminEvents } from "../lib/realtimeBus.js";
import { registerAdminDocumentRoutes } from "./adminDocumentRoutes.js";
import {
  bulkRevokeInvitations,
  deleteCompany as removeCompany,
  deleteProject as removeProject,
  getAllProjects,
  getProject,
  listDocumentRecordsForProject,
  sumStoredDocumentBytes,
  listRevokedInvitations,
  getSignedInvitationById,
  findReusableSignedInvitation,
  insertSignedInvitation,
  listLatestInvitationsByProject,
  listInvitationEventSummariesByInvitationIds,
  listInvitationSendCountsByProject,
  markExpiredInvitations,
  markInvitationsSent,
  pruneExpiredSignedInvitations,
  pruneRevokedInvitations,
  revokeInvitation,
  recordInvitationEvent,
  listAuditLogsForProject,
  listInvitationEventsForProject,
  scrubOldAuditPayloads,
  setProjectArchived,
  updateSignedInvitationPayload,
  upsertCompany,
  upsertProject,
} from "../db.js";
import { callFlow, getFlowConfig } from "../flows.js";
import { getUploadStorageConfig } from "../documentFiles.js";
import { resolveStorageQuotaBytes, sumDirectoryBytes } from "../lib/storageStats.js";
import { buildProjectActivityFeed } from "../lib/projectActivity.js";
import {
  buildSignedInvitationUrl,
  getInvitationPayloadIssues,
  getSigningConfig,
  parsePositiveInt,
  sanitizeInvitationContext,
  verifySignedInvitation,
} from "../security.js";

export function registerAdminRoutes(app, ctx) {
  const {
    wrap,
    badRequest,
    serviceUnavailable,
    requireAdminAuth,
    buildAdminAuthSessionResponse,
    loginAdmin,
    logoutAdmin,
    normalizeTextField,
    ensureFlowUrl,
    sanitizeProjectPayload,
    sanitizeCompanyPayload,
    recordsToFlowRows,
    resolvePortalEntryUrl,
    buildAdminSecurityResponse,
    signInvitationForCompany,
    resolveCompanyTargets,
    buildProjectOverviewBase,
    buildProjectOverview,
    matchCompanyRow,
    readRowDocumentType,
    audit,
    getActorIp,
    hashActorIp,
    MAX_INVITATION_TTL_MINUTES,
    purgeExpiredLocalDocumentFiles,
    env,
    role,
  } = ctx;

  const adminLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Trop de tentatives de connexion. Reessayez dans quelques minutes." },
  });

  async function recordAdminInvitationEmailEvents(req, invitationIds, eventType) {
    await Promise.all(
      invitationIds.map((invitationId) =>
        recordInvitationEvent({
          invitationId,
          eventType,
          source: "admin",
          actorIpHash: hashActorIp(getActorIp(req)),
          userAgent: req.get("user-agent") || "",
          metadata: {
            path: req.originalUrl || req.url || "",
            method: req.method || "",
          },
        }).catch((error) => {
          console.warn("[invitation-email-event] failed:", error?.message || error);
        })
      )
    );
  }

  app.get(["/api/admin/auth/session", "/api/auth/session"], wrap((req, res) => {
    res.json(buildAdminAuthSessionResponse(req));
  }));

  app.post(["/api/admin/auth/login", "/api/auth/login"], adminLoginLimiter, wrap((req, res) => {
    loginAdmin(req, res);
  }));

  app.post(["/api/admin/auth/logout", "/api/auth/logout"], wrap((req, res) => {
    logoutAdmin(req, res);
  }));

  app.get("/api/admin-debug-ip", requireAdminAuth, (req, res) => {
    if (env.NODE_ENV === "production") {
      return res.status(404).end();
    }
    res.json({
      actorIp: ctx.getActorIp(req),
      reqIp: req.ip,
      reqIps: req.ips,
      remoteAddress: req.socket?.remoteAddress,
      trustProxy: req.app.get("trust proxy"),
      xForwardedFor: req.get("x-forwarded-for"),
      allowed: Array.from(ctx.adminAllowedIps),
    });
  });

  app.get(
    ["/api/admin/security", "/api/security"],
    requireAdminAuth,
    wrap((req, res) => {
      res.json(buildAdminSecurityResponse(req));
    })
  );

  // Server-Sent Events stream. Each admin tab opens one connection and gets
  // a push when something happens server-side (upload, review, revoke, ...).
  // Replaces the 30s polling loop the tracking panel used to run.
  app.get(
    "/api/admin/events",
    requireAdminAuth,
    wrap(async (req, res) => {
      res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Disable nginx response buffering — otherwise events get held until
        // the buffer flushes, defeating the point of a push channel.
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders?.();
      // Initial retry hint + ready event so the client knows the channel is
      // alive immediately rather than on the first real notify.
      res.write("retry: 5000\n\n");
      res.write(`event: ready\ndata: {"at":"${new Date().toISOString()}"}\n\n`);

      const send = (event) => {
        try {
          const type = String(event?.type || "message");
          res.write(`event: ${type}\n`);
          res.write(`data: ${JSON.stringify(event || {})}\n\n`);
        } catch {
          // socket gone — close handler below clears the subscription
        }
      };

      const unsubscribe = await subscribeToAdminEvents(send, { env });

      // Reverse-proxies typically idle-close at 30s. Send a comment-line
      // ping every 25s so the stream stays open.
      const heartbeat = setInterval(() => {
        try {
          res.write(`: ping ${Date.now()}\n\n`);
        } catch {
          /* socket gone */
        }
      }, 25_000);
      heartbeat.unref?.();

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      req.on("close", cleanup);
      req.on("aborted", cleanup);
    })
  );

  app.get(
    ["/api/admin/storage/stats", "/api/storage/stats"],
    requireAdminAuth,
    wrap(async (_req, res) => {
      const { stagingDir } = getUploadStorageConfig(env);
      const storedBytes = await sumStoredDocumentBytes();
      const quotaBytes = resolveStorageQuotaBytes(env);

      // Files live on the portal host in split deployment; admin has no local staging.
      const filesOnPortalHost = role === "admin";
      let storedOnDiskBytes = 0;
      let disk = { totalBytes: 0, freeBytes: 0, usedBytes: 0 };

      if (!filesOnPortalHost) {
        const [fsStats, scannedBytes] = await Promise.all([
          statfs(stagingDir),
          sumDirectoryBytes(stagingDir),
        ]);
        storedOnDiskBytes = scannedBytes;
        const totalBytes = Number(fsStats.blocks) * Number(fsStats.bsize);
        const freeBytes = Number(fsStats.bavail) * Number(fsStats.bsize);
        disk = {
          totalBytes,
          freeBytes,
          usedBytes: Math.max(0, totalBytes - freeBytes),
        };
      }

      const usedBytes = filesOnPortalHost
        ? storedBytes
        : Math.max(storedBytes, storedOnDiskBytes);

      res.json({
        stagingDir,
        storedBytes,
        storedOnDiskBytes,
        usedBytes,
        quotaBytes,
        filesOnPortalHost,
        disk,
      });
    })
  );

  app.post(
    ["/api/admin/invitations/sign", "/api/invitations/sign"],
    requireAdminAuth,
    wrap(async (req, res) => {
      const signing = getSigningConfig(env);
      if (!signing.secret) {
        throw serviceUnavailable(
          "Signature secret missing on server. Configure PORTAL_LINK_SECRET to sign links."
        );
      }

      const context = sanitizeInvitationContext(req.body?.context || req.body || {});
      const issues = getInvitationPayloadIssues(context);

      if (issues.length) {
        throw badRequest(`Missing required fields: ${issues.join(", ")}`);
      }

      const rawTtl = req.body?.ttlMinutes;
      const ttlSupplied =
        rawTtl !== undefined && rawTtl !== null && String(rawTtl).trim() !== "";
      let ttlMinutes;
      if (ttlSupplied) {
        const parsed = parsePositiveInt(rawTtl, 0);
        if (parsed > 0) {
          ttlMinutes = Math.min(parsed, MAX_INVITATION_TTL_MINUTES);
        } else {
          ttlMinutes = signing.ttlMinutes > 0 ? signing.ttlMinutes : MAX_INVITATION_TTL_MINUTES;
        }
      } else {
        ttlMinutes = signing.ttlMinutes > 0 ? signing.ttlMinutes : MAX_INVITATION_TTL_MINUTES;
      }
      const signed = await buildSignedInvitationUrl({
        context,
        secret: signing.secret,
        ttlMinutes,
        baseUrl: resolvePortalEntryUrl(req),
        insertSignedInvitation,
        findReusableSignedInvitation,
        updateSignedInvitationPayload,
      });

      await audit(req, "admin.invitation.sign", {
        invitationId: signed.invitationId,
        companyId: context.companyId,
        companyName: context.companyName,
        submissionId: context.submissionId,
        dossierId: context.dossierId,
        ttlMinutes,
        expiresAt: signed.payload.exp || null,
      });

      res.json({
        url: signed.url,
        invitationId: signed.invitationId,
        status: "generated",
        expiresAt: signed.payload.exp || null,
        issuedAt: signed.payload.iat,
        signatureAlgorithm: "HS256",
      });
    })
  );

  app.get(
    ["/api/admin/projects/:id/invitations", "/api/projects/:id/invitations"],
    requireAdminAuth,
    wrap(async (req, res) => {
      const project = await getProject(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      await markExpiredInvitations();
      const items = await listLatestInvitationsByProject(project.id);
      const invitationIds = items.map((item) => item.id).filter(Boolean);
      const [sentCounts, eventSummaries] = await Promise.all([
        listInvitationSendCountsByProject(project.id),
        listInvitationEventSummariesByInvitationIds(invitationIds),
      ]);

      res.json({
        items: items.map((item) => {
          const sentCount = sentCounts.get(String(item.companyId || "").trim()) || 0;
          const eventSummary = eventSummaries.get(item.id) || {};
          const openedCount = Number(eventSummary.openedCount) || 0;
          const verifiedCount = Number(eventSummary.verifiedCount) || 0;
          const openCount = Math.max(openedCount, verifiedCount);
          return {
            ...item,
            sentCount,
            reminderCount: Math.max(0, sentCount - 1),
            openCount,
            openedCount,
            verifiedCount,
            hasOpened: openCount > 0,
            firstOpenedAt: eventSummary.firstOpenedAt || null,
            lastOpenedAt: eventSummary.lastOpenedAt || null,
          };
        }),
      });
    })
  );

  app.post(
    [
      "/api/admin/projects/:id/send-invitations",
      "/api/projects/:id/send-invitations",
    ],
    requireAdminAuth,
    wrap(async (req, res) => {
      const flowConfig = getFlowConfig(env);
      ensureFlowUrl(flowConfig.sendInvitationsUrl, "SEND_INVITATIONS");
      const signing = getSigningConfig(env);
      if (!signing.secret) {
        throw serviceUnavailable(
          "Signature secret missing on server. Configure PORTAL_LINK_SECRET."
        );
      }

      const project = await getProject(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const { targets } = resolveCompanyTargets(project, req.body?.companyIds);
      if (!targets.length) {
        throw badRequest("Aucune entreprise selectionnee pour l'envoi d'invitations.");
      }

      const invitations = [];
      const invitationIds = [];
      for (const company of targets) {
        if (!company.companyEmail) {
          throw badRequest(
            `Entreprise ${company.companyName || company.id}: email manquant.`
          );
        }
        const signed = await signInvitationForCompany({ project, company, signing, req });
        invitationIds.push(signed.invitationId);
        invitations.push({
          companyId: company.companyId,
          companyName: company.companyName,
          companyEmail: company.companyEmail,
          contactName: company.contactName,
          submissionId: company.submissionId,
          invitationId: signed.invitationId,
          status: "generated",
          url: signed.url,
          expiresAt: signed.payload.exp || "",
        });
      }

      const payload = {
        type: "invitation",
        projectId: project.id,
        projectName: project.name,
        dossierId: project.dossierId,
        deadline: project.deadline || "",
        portalUrl: resolvePortalEntryUrl(req),
        invitations,
      };

      const result = await callFlow(
        "SEND_INVITATIONS",
        flowConfig.sendInvitationsUrl,
        payload
      );

      await markInvitationsSent(invitationIds);
      await recordAdminInvitationEmailEvents(req, invitationIds, "email_sent");

      await audit(req, "admin.invitations.send", {
        projectId: project.id,
        count: invitations.length,
        companyIds: invitations.map((item) => item.companyId),
        recipients: invitations.map((item) => ({
          companyId: item.companyId,
          companyName: item.companyName,
          companyEmail: item.companyEmail,
        })),
      });

      publishAdminEvent({
        type: "admin.invalidate",
        scope: "invitations",
        projectId: project.id,
      });

      res.json({ ok: true, count: invitations.length, result });
    })
  );

  app.post(
    [
      "/api/admin/projects/:id/send-reminders",
      "/api/projects/:id/send-reminders",
    ],
    requireAdminAuth,
    wrap(async (req, res) => {
      const flowConfig = getFlowConfig(env);
      ensureFlowUrl(flowConfig.sendRemindersUrl, "SEND_REMINDERS");
      const signing = getSigningConfig(env);
      if (!signing.secret) {
        throw serviceUnavailable(
          "Signature secret missing on server. Configure PORTAL_LINK_SECRET."
        );
      }

      const project = await getProject(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const { targets, explicitSelection } = resolveCompanyTargets(
        project,
        req.body?.companyIds
      );
      if (!targets.length) {
        throw badRequest("Aucune entreprise a relancer.");
      }

      const documentRows = recordsToFlowRows(
        await listDocumentRecordsForProject({
          projectId: project.id,
          dossierId: project.dossierId,
        })
      );

      const customDocs = Array.isArray(project.customDocuments)
        ? project.customDocuments
        : [];
      const customById = new Map(
        customDocs
          .filter((doc) => doc && typeof doc === "object" && doc.id)
          .map((doc) => [doc.id, doc])
      );

      const reminders = [];
      const reminderInvitationIds = [];
      const skipped = [];
      for (const company of targets) {
        if (!company.companyEmail) {
          throw badRequest(
            `Entreprise ${company.companyName || company.id}: email manquant.`
          );
        }

        const expectedIds = Array.isArray(company.expectedDocuments)
          ? company.expectedDocuments
          : [];
        const companyRows = documentRows.filter((row) => matchCompanyRow(row, company));
        const presentIds = new Set(
          companyRows.map(readRowDocumentType).filter(Boolean)
        );
        const missingIds = expectedIds.filter((id) => !presentIds.has(id));

        if (!missingIds.length) {
          skipped.push({ companyId: company.companyId, reason: "complete" });
          if (!explicitSelection) continue;
        }

        const missingDocuments = resolveDocumentList(
          missingIds.map((id) => customById.get(id) || id)
        ).map((doc) => ({ id: doc.id, label: doc.label }));

        const signed = await signInvitationForCompany({ project, company, signing, req });
        reminderInvitationIds.push(signed.invitationId);
        reminders.push({
          companyId: company.companyId,
          companyName: company.companyName,
          companyEmail: company.companyEmail,
          contactName: company.contactName,
          submissionId: company.submissionId,
          invitationId: signed.invitationId,
          status: "generated",
          url: signed.url,
          expiresAt: signed.payload.exp || "",
          expectedCount: expectedIds.length,
          receivedCount: expectedIds.length - missingIds.length,
          missingDocuments,
        });
      }

      if (!reminders.length) {
        return res.json({
          ok: true,
          count: 0,
          skipped,
          message: "Aucune entreprise incomplete a relancer.",
        });
      }

      const payload = {
        type: "reminder",
        projectId: project.id,
        projectName: project.name,
        dossierId: project.dossierId,
        deadline: project.deadline || "",
        portalUrl: resolvePortalEntryUrl(req),
        reminders,
      };

      const result = await callFlow(
        "SEND_REMINDERS",
        flowConfig.sendRemindersUrl,
        payload
      );

      await markInvitationsSent(reminderInvitationIds);
      await recordAdminInvitationEmailEvents(
        req,
        reminderInvitationIds,
        "email_reminder_sent"
      );

      await audit(req, "admin.invitations.remind", {
        projectId: project.id,
        count: reminders.length,
        skipped: skipped.length,
        companyIds: reminders.map((item) => item.companyId),
        recipients: reminders.map((item) => ({
          companyId: item.companyId,
          companyName: item.companyName,
          companyEmail: item.companyEmail,
        })),
      });

      publishAdminEvent({
        type: "admin.invalidate",
        scope: "invitations",
        projectId: project.id,
      });

      res.json({ ok: true, count: reminders.length, skipped, result });
    })
  );

  app.post(
    ["/api/admin/invitations/revoke", "/api/invitations/revoke"],
    requireAdminAuth,
    wrap(async (req, res) => {
      const signing = getSigningConfig(env);
      if (!signing.secret) {
        throw serviceUnavailable(
          "Signature secret missing on server. Configure PORTAL_LINK_SECRET to revoke links."
        );
      }

      const inv = normalizeTextField(req.body?.inv, "inv", { required: true, max: 64 });
      const sig = normalizeTextField(req.body?.sig, "sig", { required: true, max: 512 });
      const alg = normalizeTextField(req.body?.alg || "HS256", "alg", { max: 20 }) || "HS256";
      const reason = normalizeTextField(req.body?.reason, "reason", { max: 500 });

      const verification = await verifySignedInvitation({
        inv,
        sig,
        alg,
        secret: signing.secret,
        loadInvitation: getSignedInvitationById,
        allowExpired: true,
      });
      const expiredButOtherwiseValid = !verification.ok && verification.code === "expired";
      if (!verification.ok && !expiredButOtherwiseValid) {
        throw badRequest(`Cannot revoke: invalid signed invitation (${verification.code}).`);
      }

      const id = verification.invitationId || inv;
      const payload = verification.payload || {};
      await revokeInvitation({
        id,
        reason,
        payload: {
          companyId: payload.companyId || "",
          companyName: payload.companyName || "",
          submissionId: payload.submissionId || "",
          dossierId: payload.dossierId || "",
          exp: payload.exp || "",
          iat: payload.iat || "",
          nonce: payload.nonce || "",
        },
      });

      await audit(req, "admin.invitation.revoke", {
        id,
        reason,
        expiredAtRevoke: expiredButOtherwiseValid || false,
        companyId: payload.companyId || "",
        companyName: payload.companyName || "",
        submissionId: payload.submissionId || "",
        dossierId: payload.dossierId || "",
      });

      publishAdminEvent({
        type: "admin.invalidate",
        scope: "invitations",
        projectId: payload.projectId || "",
        companyId: payload.companyId || "",
      });

      res.json({
        ok: true,
        revoked: true,
        id,
        expired: expiredButOtherwiseValid || false,
      });
    })
  );

  app.get(
    ["/api/admin/invitations/revoked", "/api/invitations/revoked"],
    requireAdminAuth,
    wrap(async (req, res) => {
      const limit = parsePositiveInt(req.query?.limit, 50);
      res.json({ items: await listRevokedInvitations(limit) });
    })
  );

  app.post(
    "/api/admin/projects/:projectId/invitations/revoke-all",
    requireAdminAuth,
    wrap(async (req, res) => {
      const project = await getProject(req.params.projectId);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const reason =
        normalizeTextField(req.body?.reason, "reason", { max: 500 }) ||
        "Bulk revoke (project)";

      const result = await bulkRevokeInvitations({
        projectId: project.id,
        reason,
      });

      await audit(req, "admin.invitation.revoke.bulk", {
        scope: "project",
        projectId: project.id,
        reason,
        revoked: result.revoked,
        ids: result.ids,
      });

      publishAdminEvent({
        type: "admin.invalidate",
        scope: "invitations",
        projectId: project.id,
      });

      res.json({ ok: true, scope: "project", projectId: project.id, ...result });
    })
  );

  app.post(
    "/api/admin/projects/:projectId/companies/:companyId/invitations/revoke-all",
    requireAdminAuth,
    wrap(async (req, res) => {
      const project = await getProject(req.params.projectId);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const companyId = String(req.params.companyId || "").trim();
      if (!companyId) {
        throw badRequest("companyId is required.");
      }

      const reason =
        normalizeTextField(req.body?.reason, "reason", { max: 500 }) ||
        "Bulk revoke (company)";

      const result = await bulkRevokeInvitations({
        projectId: project.id,
        companyId,
        reason,
      });

      await audit(req, "admin.invitation.revoke.bulk", {
        scope: "company",
        projectId: project.id,
        companyId,
        reason,
        revoked: result.revoked,
        ids: result.ids,
      });

      publishAdminEvent({
        type: "admin.invalidate",
        scope: "invitations",
        projectId: project.id,
        companyId,
      });

      res.json({
        ok: true,
        scope: "company",
        projectId: project.id,
        companyId,
        ...result,
      });
    })
  );

  app.post(
    ["/api/admin/maintenance/cleanup", "/api/maintenance/cleanup"],
    requireAdminAuth,
    wrap(async (req, res) => {
      const expired = await markExpiredInvitations();
      const prune = await pruneRevokedInvitations();
      const pruneSigned = await pruneExpiredSignedInvitations();
      const scrub = await scrubOldAuditPayloads();
      const purgedUploads = await purgeExpiredLocalDocumentFiles();
      await audit(req, "admin.maintenance.cleanup", {
        markedExpired: expired.updated,
        prunedRevoked: prune.removed,
        prunedSignedInvitations: pruneSigned.removed,
        scrubbedAudit: scrub.scrubbed,
        purgedUploads: purgedUploads.removed,
      });
      res.json({ ok: true, expired, prune, pruneSigned, scrub, purgedUploads });
    })
  );

  app.get(
    ["/api/admin/projects", "/api/projects"],
    requireAdminAuth,
    wrap(async (req, res) => {
      const includeArchived =
        String(req.query?.includeArchived || "").toLowerCase() === "1" ||
        String(req.query?.includeArchived || "").toLowerCase() === "true";
      res.json(await getAllProjects({ includeArchived }));
    })
  );

  app.post(
    ["/api/admin/projects/:id/archive", "/api/projects/:id/archive"],
    requireAdminAuth,
    wrap(async (req, res) => {
      const existing = await getProject(req.params.id);
      if (!existing) return res.status(404).json({ error: "Project not found" });
      const project = await setProjectArchived(req.params.id, true);

      // Per the audit decision: archiving a project is treated as a hard
      // boundary — every active invitation tied to it is revoked so a stale
      // link cannot be reused after the project leaves the active set.
      // Unarchive does NOT restore them; the admin reissues fresh links.
      const revoke = await bulkRevokeInvitations({
        projectId: project.id,
        reason: "Project archived",
      });

      await audit(req, "admin.project.archive", {
        projectId: project.id,
        name: project.name,
        autoRevoked: revoke.revoked,
        revokedIds: revoke.ids,
      });

      publishAdminEvent({
        type: "admin.invalidate",
        scope: "projects",
        projectId: project.id,
      });

      res.json({ ...project, autoRevokedInvitations: revoke.revoked });
    })
  );

  app.post(
    ["/api/admin/projects/:id/unarchive", "/api/projects/:id/unarchive"],
    requireAdminAuth,
    wrap(async (req, res) => {
      const project = await setProjectArchived(req.params.id, false);
      if (!project) return res.status(404).json({ error: "Project not found" });
      await audit(req, "admin.project.unarchive", {
        projectId: project.id,
        name: project.name,
      });

      publishAdminEvent({
        type: "admin.invalidate",
        scope: "projects",
        projectId: project.id,
      });

      res.json(project);
    })
  );

  app.get(
    ["/api/admin/overview", "/api/overview"],
    requireAdminAuth,
    wrap(async (_req, res) => {
      const projects = await getAllProjects();
      const overviews = await Promise.all(
        projects.map(async (project) => {
          if (!project.dossierId) {
            return {
              ...buildProjectOverviewBase(project),
              receivedCount: 0,
              completionRate: 0,
              statusKey: "unknown",
              completeCompanies: 0,
              incompleteCompanies: 0,
              lastReceptionAt: "",
              syncError: "Aucun dossierId configure pour ce projet.",
            };
          }

          const rows = recordsToFlowRows(
            await listDocumentRecordsForProject({
              projectId: project.id,
              dossierId: project.dossierId,
            })
          );
          return buildProjectOverview(project, rows);
        })
      );

      res.json({
        synced: true,
        generatedAt: new Date().toISOString(),
        projects: overviews,
      });
    })
  );

  app.get(
    ["/api/admin/projects/:id", "/api/projects/:id"],
    requireAdminAuth,
    wrap(async (req, res) => {
      const project = await getProject(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      res.json(project);
    })
  );

  app.get(
    ["/api/admin/projects/:id/activity", "/api/projects/:id/activity"],
    requireAdminAuth,
    wrap(async (req, res) => {
      const project = await getProject(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const limit = parsePositiveInt(req.query?.limit, 80);
      const safeLimit = Math.min(Math.max(limit, 10), 200);
      const companies = Array.isArray(project.companies) ? project.companies : [];

      const [auditRows, invitationEvents, documents] = await Promise.all([
        listAuditLogsForProject(project.id, { limit: safeLimit * 2 }),
        listInvitationEventsForProject(project.id, { limit: safeLimit * 2 }),
        listDocumentRecordsForProject({
          projectId: project.id,
          dossierId: project.dossierId,
        }),
      ]);

      const items = buildProjectActivityFeed({
        companies,
        auditRows,
        invitationEvents,
        documents,
        limit: safeLimit,
      });

      res.json({
        ok: true,
        projectId: project.id,
        generatedAt: new Date().toISOString(),
        count: items.length,
        items,
      });
    })
  );

  app.put(
    ["/api/admin/projects/:id", "/api/projects/:id"],
    requireAdminAuth,
    wrap(async (req, res) => {
      const project = await upsertProject({
        id: req.params.id,
        ...sanitizeProjectPayload(req.body),
      });
      await audit(req, "admin.project.upsert", { projectId: project.id, name: project.name });
      res.json(project);
    })
  );

  app.delete(
    ["/api/admin/projects/:id", "/api/projects/:id"],
    requireAdminAuth,
    wrap(async (req, res) => {
      await removeProject(req.params.id);
      await audit(req, "admin.project.delete", { projectId: req.params.id });
      res.json({ ok: true });
    })
  );

  app.put(
    [
      "/api/admin/projects/:projectId/companies/:companyId",
      "/api/projects/:projectId/companies/:companyId",
    ],
    requireAdminAuth,
    wrap(async (req, res) => {
      if (!(await getProject(req.params.projectId))) {
        return res.status(404).json({ error: "Project not found" });
      }

      const company = await upsertCompany({
        id: req.params.companyId,
        projectId: req.params.projectId,
        ...sanitizeCompanyPayload(req.body),
      });
      await audit(req, "admin.company.upsert", {
        projectId: req.params.projectId,
        companyId: company.id,
        companyName: company.companyName,
        submissionId: company.submissionId,
      });
      res.json(company);
    })
  );

  app.delete(
    ["/api/admin/companies/:id", "/api/companies/:id"],
    requireAdminAuth,
    wrap(async (req, res) => {
      await removeCompany(req.params.id);
      await audit(req, "admin.company.delete", { companyId: req.params.id });
      res.json({ ok: true });
    })
  );

  registerAdminDocumentRoutes(app, ctx);
}
