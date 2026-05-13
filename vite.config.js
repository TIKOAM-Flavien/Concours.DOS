import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

import {
  getInvitationPayloadIssues,
  getSigningConfig,
  hashSignedContextId,
  isInvitationDeadlinePast,
  verifySignedContext,
} from "./server/security.js";

const rootDir = dirname(fileURLToPath(import.meta.url));

function resolveInputs() {
  return {
    portal: resolve(rootDir, "index.html"),
    admin: resolve(rootDir, "admin.html"),
  };
}

// Paths that map to the public portal HTML in dev. The admin SPA (`/admin*`)
// is intentionally excluded: it has its own access control (server-side
// localhost-only in prod) and must remain reachable in dev for local admins.
const PORTAL_HTML_PATHS = new Set(["/", "/depot", "/depot/", "/index.html"]);

const ACCESS_ERROR_MESSAGES = {
  missing_ctx: "Le lien ne contient pas de contexte (ctx).",
  missing_sig: "Le lien ne contient pas de signature (sig).",
  invalid_alg: "L'algorithme de signature n'est pas supporte.",
  invalid_sig: "La signature du lien est invalide.",
  invalid_ctx: "Le contexte du lien est invalide.",
  invalid_exp: "La date d'expiration du lien est invalide.",
  invalid_payload: "Le lien signe ne contient pas toutes les informations requises.",
  expired: "Le lien est expire.",
  deadline_passed:
    "La date limite de depot est passee. Le portail n'est plus accessible pour cette invitation.",
  missing_secret:
    "PORTAL_LINK_SECRET n'est pas configure cote serveur (verifiez .env / .env.local).",
};

function renderAccessDenied(code) {
  const message = ACCESS_ERROR_MESSAGES[code] || "Lien de depot invalide.";
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>Acces refuse</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; background: #f6f7fb; color: #182033; }
      main { max-width: 680px; margin: 8vh auto; padding: 2rem; background: #fff; border-radius: 14px; box-shadow: 0 14px 30px rgba(16, 24, 40, 0.1); }
      h1 { margin: 0 0 0.75rem; font-size: 1.4rem; }
      p { margin: 0; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <h1>Acces depot refuse</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;
}

// Dev-only middleware: enforces the same signed-link check that the prod
// Express server applies via `requireSignedDepotLink`. Without this, Vite
// happily serves `index.html` for any request, leaking the portal shell to
// unsigned visitors. With this in place, an unsigned hit to `/`, `/depot`,
// `/depot/` or `/index.html` is answered with a minimal 403 page and the
// React app never boots.
function signedPortalGuardPlugin() {
  return {
    name: "portail-entreprise:signed-portal-guard",
    apply: "serve",
    configureServer(server) {
      const env = loadEnv("development", rootDir, "");
      const effectiveEnv = { ...process.env, ...env };

      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          return next();
        }

        let url;
        try {
          url = new URL(req.url || "/", "http://localhost");
        } catch {
          return next();
        }

        if (!PORTAL_HTML_PATHS.has(url.pathname)) {
          return next();
        }

        const { secret } = getSigningConfig(effectiveEnv);
        const ctx = url.searchParams.get("ctx") || "";
        const sig = url.searchParams.get("sig") || "";
        const alg = url.searchParams.get("alg") || "HS256";

        const verification = verifySignedContext({ ctx, sig, alg, secret });
        let code = verification.ok ? "ok" : verification.code;

        if (verification.ok) {
          const issues = getInvitationPayloadIssues(verification.payload || {});
          if (issues.length) {
            code = "invalid_payload";
          } else if (isInvitationDeadlinePast(verification.payload)) {
            code = "deadline_passed";
          }
        }

        if (code !== "ok") {
          res.statusCode = 403;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("X-Content-Type-Options", "nosniff");
          res.setHeader("X-Frame-Options", "DENY");
          res.setHeader("Referrer-Policy", "no-referrer");
          res.end(renderAccessDenied(code));
          return;
        }

        // Verified link: attach a marker so further dev-time logging can
        // distinguish trusted vs. untrusted hits without re-parsing the URL.
        req._signedInvitationId = hashSignedContextId(ctx);
        return next();
      });
    },
  };
}

export default defineConfig(() => ({
  plugins: [signedPortalGuardPlugin(), react()],
  server: (() => {
    const apiTarget =
      process.env.VITE_DEV_API_TARGET ||
      `http://localhost:${process.env.PORT || "3001"}`;

    return {
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    };
  })(),
  build: {
    rollupOptions: {
      input: resolveInputs(),
    },
  },
}));
