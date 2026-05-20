import { getUploadStorageConfig } from "../documentFiles.js";
import { parsePositiveInt } from "../security.js";
import { createAdminAuthHandlers } from "./adminAuthHandlers.js";
import { createDocumentFlowHelpers } from "./documentFlow.js";
import { createInvitationAdminHandlers } from "./invitationAdmin.js";
import { createInvitationHandlers } from "./invitationHandlers.js";
import { createRequestHelpers, parseAdminAllowedEntries } from "./requestHelpers.js";
import { createUploadHandlers } from "./uploadHandlers.js";

export { getStartupDiagnostics } from "./startupDiagnostics.js";

export function buildRequestContext({
  rootDir,
  env = process.env,
  staticBundle,
  startupDiagnostics,
  role,
  port,
}) {
  const isProduction = env.NODE_ENV === "production";
  const maxFileMb = Math.max(parsePositiveInt(env.PORTAL_MAX_FILE_MB, 20), 1);
  const submissionDailyBudget = Math.max(
    parsePositiveInt(env.PORTAL_SUBMISSION_DAILY_BUDGET, 300),
    1
  );
  const MAX_INVITATION_TTL_MINUTES = Math.max(
    parsePositiveInt(env.PORTAL_LINK_TTL_MAX_MINUTES, 525600),
    1
  );
  const uploadStorageConfig = getUploadStorageConfig(env);
  const { ips: adminAllowedIps, cidrs: adminAllowedCidrs } = parseAdminAllowedEntries(env);

  const helpers = createRequestHelpers({ env, isProduction, port });
  const documentFlow = createDocumentFlowHelpers();
  const adminAuth = createAdminAuthHandlers({
    env,
    adminAllowedIps,
    adminAllowedCidrs,
    getActorIp: helpers.getActorIp,
    audit: helpers.audit,
    normalizeTextField: helpers.normalizeTextField,
  });
  const invitations = createInvitationHandlers({
    env,
    badRequest: helpers.badRequest,
    forbidden: helpers.forbidden,
    normalizeTextField: helpers.normalizeTextField,
    getActorIp: helpers.getActorIp,
    hashActorIp: helpers.hashActorIp,
  });
  const uploads = createUploadHandlers({
    env,
    maxFileMb,
    submissionDailyBudget,
    uploadStorageConfig,
    forbidden: helpers.forbidden,
    tooManyRequests: helpers.tooManyRequests,
    normalizeTextField: helpers.normalizeTextField,
    normalizeFileName: helpers.normalizeFileName,
    prefixFileNameWithCompany: helpers.prefixFileNameWithCompany,
    getVerifiedInvitationFromBody: invitations.getVerifiedInvitationFromBody,
    ensureProjectAllowsDeposits: invitations.ensureProjectAllowsDeposits,
    resolveInvitationDocument: invitations.resolveInvitationDocument,
    buildMetadata: documentFlow.buildMetadata,
    documentRecordToFlowRow: documentFlow.documentRecordToFlowRow,
    localRecordMatchesInvitation: documentFlow.localRecordMatchesInvitation,
  });
  const invitationAdmin = createInvitationAdminHandlers({
    env,
    startupDiagnostics,
    MAX_INVITATION_TTL_MINUTES,
    badRequest: helpers.badRequest,
    resolvePortalEntryUrl: helpers.resolvePortalEntryUrl,
  });

  return {
    rootDir,
    env,
    staticBundle,
    startupDiagnostics,
    role,
    port,
    isProduction,
    maxFileMb,
    submissionDailyBudget,
    MAX_INVITATION_TTL_MINUTES,
    uploadStorageConfig,
    adminAllowedIps,
    adminAllowedCidrs,
    ...helpers,
    ...adminAuth,
    ...documentFlow,
    ...invitations,
    ...uploads,
    ...invitationAdmin,
  };
}
