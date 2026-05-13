import { normalizeSharePointFolderPath } from "../../shared/sharepointPath.js";

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const env = import.meta.env;

export const portalEnv = Object.freeze({
  brandName: (env.VITE_CLIENT_PORTAL_ORGANIZATION || "TIKOAM").trim(),
  portalTitle: (
    env.VITE_CLIENT_PORTAL_TITLE || "Plateforme de depot de pieces concours"
  ).trim(),
  portalSubtitle: (
    env.VITE_CLIENT_PORTAL_SUBTITLE ||
    "Deposez les pieces administratives demandees pour votre candidature."
  ).trim(),
  supportEmail: (env.VITE_CLIENT_PORTAL_SUPPORT_EMAIL || "contact@tikoam.com").trim(),
  supportPhone: (env.VITE_CLIENT_PORTAL_SUPPORT_PHONE || "").trim(),
  websiteUrl: (env.VITE_CLIENT_PORTAL_WEBSITE_URL || "https://www.tikoam.com").trim(),
  maxFileMb: positiveNumber(env.VITE_CLIENT_PORTAL_MAX_FILE_MB, 20),
  defaultContestName: (env.VITE_CLIENT_PORTAL_CONTEST_NAME || "").trim(),
  defaultFolderPath: normalizeSharePointFolderPath(
    env.VITE_CLIENT_PORTAL_DEFAULT_FOLDER_PATH ||
      env.VITE_SHAREPOINT_FOLDER_PATH ||
      env.VITE_SHAREPOINT_FOLDER ||
      ""
  ),
  defaultDossierId: (
    env.VITE_CLIENT_PORTAL_DEFAULT_DOSSIER_ID ||
    env.VITE_DOSSIER_ID ||
    ""
  ).trim(),
  requiredDocuments: splitCsv(env.VITE_CLIENT_PORTAL_REQUIRED_DOCUMENTS),
});
