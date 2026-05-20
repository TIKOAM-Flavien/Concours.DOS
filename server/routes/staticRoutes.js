import { existsSync } from "node:fs";

import express from "express";

import { roleIncludesAdmin, roleIncludesPortal } from "../bootstrap/role.js";

export function registerStaticRoutes(app, ctx) {
  const { staticBundle, requireAdminPageAccess, requireSignedDepotLink, role } = ctx;

  if (!staticBundle) {
    if (roleIncludesAdmin(role)) {
      app.get(["/admin", "/admin/", "/admin.html"], requireAdminPageAccess, (_req, res) => {
        res.status(503).json({
          error: "Frontend build missing. Run `npm run build:admin` before production start.",
        });
      });
    }
    if (roleIncludesPortal(role)) {
      app.get(["/", "/depot", "/depot/", "/index.html"], (_req, res) => {
        res.status(503).json({
          error: "Portal build missing. Run `npm run build:portal` before production start.",
        });
      });
    }
    return;
  }

  for (const assetsDir of staticBundle.assetsDirs) {
    if (!existsSync(assetsDir)) continue;
    app.use(
      "/assets",
      express.static(assetsDir, {
        index: false,
        maxAge: "365d",
        immutable: true,
      })
    );
  }

  if (roleIncludesAdmin(role) && staticBundle.adminHtmlPath) {
    app.get(["/admin", "/admin/", "/admin.html"], requireAdminPageAccess, (_req, res) => {
      res.set("Cache-Control", "no-store");
      res.sendFile(staticBundle.adminHtmlPath);
    });
  }

  if (roleIncludesPortal(role) && staticBundle.portalHtmlPath) {
    app.get(
      ["/", "/depot", "/depot/", "/index.html"],
      requireSignedDepotLink,
      (_req, res) => {
        res.set("Cache-Control", "no-store");
        res.sendFile(staticBundle.portalHtmlPath);
      }
    );
  }
}
