import {
  findReusableSignedInvitation,
  insertSignedInvitation,
  updateSignedInvitationPayload,
} from "../db.js";
import { getFlowStatus } from "../flows.js";
import {
  buildSignedInvitationUrl,
  getInvitationPayloadIssues,
  getSigningConfig,
  sanitizeInvitationContext,
} from "../security.js";

export function createInvitationAdminHandlers({
  env,
  startupDiagnostics,
  MAX_INVITATION_TTL_MINUTES,
  badRequest,
  resolvePortalEntryUrl,
}) {
  function buildAdminSecurityResponse(req) {
    return {
      signingEnabled: Boolean(getSigningConfig(env).secret),
      ttlMinutes: getSigningConfig(env).ttlMinutes,
      portalUrl: resolvePortalEntryUrl(req),
      flows: getFlowStatus(env),
      warnings: startupDiagnostics.warnings,
    };
  }

  function buildCompanyInvitationContext(project, company) {
    const customDocs = Array.isArray(project.customDocuments) ? project.customDocuments : [];
    const customById = new Map(
      customDocs
        .filter((doc) => doc && typeof doc === "object" && doc.id)
        .map((doc) => [doc.id, doc])
    );
    const documents = (company.expectedDocuments || []).map((id) => customById.get(id) || id);

    return {
      projectId: project.id,
      companyDbId: company.id,
      companyId: company.companyId,
      companyName: company.companyName,
      companyEmail: company.companyEmail,
      contactName: company.contactName,
      submissionId: company.submissionId,
      contestName: project.name,
      dossierId: project.dossierId,
      folderPath: project.folderPath,
      deadline: project.deadline,
      documents,
    };
  }

  function resolveCompanyTargets(project, rawIds) {
    const allCompanies = Array.isArray(project.companies) ? project.companies : [];
    const selectedIds = Array.isArray(rawIds)
      ? rawIds.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    const targets = selectedIds.length
      ? allCompanies.filter((company) => selectedIds.includes(company.id))
      : allCompanies;

    return { targets, explicitSelection: selectedIds.length > 0 };
  }

  async function signInvitationForCompany({ project, company, signing, req }) {
    const context = sanitizeInvitationContext(buildCompanyInvitationContext(project, company));
    const issues = getInvitationPayloadIssues(context);
    if (issues.length) {
      throw badRequest(
        `Entreprise ${company.companyName || company.id}: champs manquants (${issues.join(", ")}).`
      );
    }
    const ttlMinutes =
      signing.ttlMinutes > 0
        ? Math.min(signing.ttlMinutes, MAX_INVITATION_TTL_MINUTES)
        : MAX_INVITATION_TTL_MINUTES;

    return buildSignedInvitationUrl({
      context,
      secret: signing.secret,
      ttlMinutes,
      baseUrl: resolvePortalEntryUrl(req),
      insertSignedInvitation,
      findReusableSignedInvitation,
      updateSignedInvitationPayload,
    });
  }

  return {
    buildAdminSecurityResponse,
    buildCompanyInvitationContext,
    resolveCompanyTargets,
    signInvitationForCompany,
  };
}
