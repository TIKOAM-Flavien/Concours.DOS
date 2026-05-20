import { existsSync } from "node:fs";
import { resolve } from "node:path";

function pushAssetsDir(assetsDirs, dir) {
  const assets = resolve(dir, "assets");
  if (existsSync(assets) && !assetsDirs.includes(assets)) {
    assetsDirs.push(assets);
  }
}

/**
 * Resolve frontend bundles for the current PORTAL_APP_ROLE.
 */
export function getStaticBundle(rootDir, role = "all") {
  const distAllDir = resolve(rootDir, "dist-all");
  const distPortalDir = resolve(rootDir, "dist-portal");
  const distAdminDir = resolve(rootDir, "dist-admin");

  const portalCandidates = [
    resolve(distAllDir, "index.html"),
    resolve(distPortalDir, "index.html"),
  ];
  const adminCandidates = [
    resolve(distAllDir, "admin.html"),
    resolve(distAdminDir, "admin.html"),
  ];

  const portalHtmlPath = portalCandidates.find((path) => existsSync(path)) || null;
  const adminHtmlPath = adminCandidates.find((path) => existsSync(path)) || null;

  if (role === "admin") {
    if (!adminHtmlPath) return null;
    const assetsDirs = [];
    pushAssetsDir(assetsDirs, distAdminDir);
    pushAssetsDir(assetsDirs, distAllDir);
    return { portalHtmlPath: null, adminHtmlPath, assetsDirs };
  }

  if (role === "portal") {
    if (!portalHtmlPath) return null;
    const assetsDirs = [];
    pushAssetsDir(assetsDirs, distPortalDir);
    pushAssetsDir(assetsDirs, distAllDir);
    return { portalHtmlPath, adminHtmlPath: null, assetsDirs };
  }

  if (!portalHtmlPath || !adminHtmlPath) return null;

  const assetsDirs = [];
  pushAssetsDir(assetsDirs, distAllDir);
  pushAssetsDir(assetsDirs, distPortalDir);
  pushAssetsDir(assetsDirs, distAdminDir);
  return { portalHtmlPath, adminHtmlPath, assetsDirs };
}
