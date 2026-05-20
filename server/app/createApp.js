import express from "express";
import rateLimit from "express-rate-limit";

import { createHttpLogger, createLogger } from "../lib/logger.js";
import { parsePositiveInt } from "../security.js";

export function createApp({ env = process.env } = {}) {
  const app = express();
  const isProduction = env.NODE_ENV === "production";
  const bodyLimitMb = Math.max(parsePositiveInt(env.PORTAL_MAX_BODY_MB, 5), 1);
  const portalRateLimitPerMinute = Math.max(
    parsePositiveInt(env.PORTAL_RATE_LIMIT_PER_MINUTE, 60),
    1
  );
  const portalUploadRateLimitPerMinute = Math.max(
    parsePositiveInt(env.PORTAL_UPLOAD_RATE_LIMIT_PER_MINUTE, 10),
    1
  );

  app.disable("x-powered-by");

  const trustProxy = String(env.TRUST_PROXY || "").trim().toLowerCase();
  if (trustProxy === "1" || trustProxy === "true") {
    app.set("trust proxy", "loopback");
  } else if (trustProxy) {
    const value = trustProxy.includes(",")
      ? trustProxy.split(",").map((part) => part.trim()).filter(Boolean)
      : trustProxy;
    app.set("trust proxy", value);
  }

  const logger = createLogger({ env });
  app.locals.logger = logger;
  app.use(createHttpLogger(logger));

  app.use(express.json({ limit: `${bodyLimitMb}mb` }));

  return {
    app,
    isProduction,
    bodyLimitMb,
    portalRateLimitPerMinute,
    portalUploadRateLimitPerMinute,
    logger,
  };
}

export function applyPortalRateLimits(app, {
  portalRateLimitPerMinute,
  portalUploadRateLimitPerMinute,
}) {
  app.use(
    "/api/portal",
    rateLimit({
      windowMs: 60 * 1000,
      limit: portalRateLimitPerMinute,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Rate limit exceeded. Please wait and try again." },
      skip: (req) => {
        return req.path === "/upload" || req.path.startsWith("/upload/");
      },
    })
  );
  app.use(
    "/api/portal/upload",
    rateLimit({
      windowMs: 60 * 1000,
      limit: portalUploadRateLimitPerMinute,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Upload rate limit exceeded. Please wait and try again." },
      skip: () => false,
    })
  );
}

export function applyBodySizeErrorHandler(app, bodyLimitMb, maxFileMb) {
  app.use((err, req, res, next) => {
    if (err && err.type === "entity.too.large") {
      return res.status(413).json({
        error: "Payload too large.",
        hint: `Increase PORTAL_MAX_BODY_MB (currently ${bodyLimitMb}MB) for JSON requests. File uploads use multipart and PORTAL_MAX_FILE_MB=${maxFileMb}MB.`,
      });
    }
    return next(err);
  });
}

export function applySecurityHeaders(app, { isProduction, env = process.env }) {
  const HSTS_ENABLED = (() => {
    const raw = String(env.PORTAL_FORCE_HSTS || "").trim().toLowerCase();
    if (raw === "1" || raw === "true" || raw === "yes") return true;
    if (raw === "0" || raw === "false" || raw === "no") return false;
    return isProduction;
  })();

  const HSTS_VALUE = (() => {
    const maxAge = Math.max(parsePositiveInt(env.PORTAL_HSTS_MAX_AGE, 31536000), 0);
    const includeSubDomains =
      String(env.PORTAL_HSTS_INCLUDE_SUBDOMAINS || "true").trim().toLowerCase() !== "false";
    const preload =
      String(env.PORTAL_HSTS_PRELOAD || "false").trim().toLowerCase() === "true";
    return [
      `max-age=${maxAge}`,
      includeSubDomains ? "includeSubDomains" : "",
      preload ? "preload" : "",
    ]
      .filter(Boolean)
      .join("; ");
  })();

  app.use((req, res, next) => {
    res.set("Content-Security-Policy", [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "frame-src 'self' blob:",
    ].join("; "));
    res.set("Cross-Origin-Opener-Policy", "same-origin");
    res.set("Cross-Origin-Resource-Policy", "same-origin");
    res.set("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
    res.set("Referrer-Policy", "strict-origin-when-cross-origin");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");
    res.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");

    const isSecureRequest =
      Boolean(req.secure) ||
      String(req.get("x-forwarded-proto") || "")
        .split(",")[0]
        .trim()
        .toLowerCase() === "https";

    if (HSTS_ENABLED && HSTS_VALUE && isSecureRequest) {
      res.set("Strict-Transport-Security", HSTS_VALUE);
    }

    if (
      req.path.startsWith("/api") ||
      req.path === "/health" ||
      req.path === "/readyz"
    ) {
      res.set("Cache-Control", "no-store");
    }

    next();
  });

  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send("User-agent: *\nDisallow: /\n");
  });

  return { HSTS_ENABLED, HSTS_VALUE };
}
