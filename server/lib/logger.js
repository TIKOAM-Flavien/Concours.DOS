import { randomUUID } from "node:crypto";

import pino from "pino";
import pinoHttp from "pino-http";

// In dev we keep the existing `console.error` ergonomics so developers don't
// suddenly lose readable stack traces. In prod we emit structured JSON so the
// log shipper (loki, ES, etc.) can index by request_id and statusCode.
export function createLogger({ env = process.env } = {}) {
  const isProduction = env.NODE_ENV === "production";
  return pino({
    level: env.LOG_LEVEL || (isProduction ? "info" : "debug"),
    base: isProduction ? { service: "concours-dos" } : undefined,
    transport: isProduction
      ? undefined
      : {
          target: "pino/file",
          options: { destination: 1 },
        },
    redact: {
      paths: [
        "req.headers.cookie",
        "req.headers.authorization",
        "req.headers['x-portal-admin-password']",
        'res.headers["set-cookie"]',
      ],
      censor: "[REDACTED]",
    },
  });
}

export function createHttpLogger(logger) {
  return pinoHttp({
    logger,
    // Use an existing X-Request-Id if a reverse-proxy injected one; otherwise
    // mint a fresh UUID so the request can be correlated across the audit log.
    genReqId(req, res) {
      const incoming = req.headers["x-request-id"];
      const requestId =
        (typeof incoming === "string" && incoming.trim()) || randomUUID();
      res.setHeader("X-Request-Id", requestId);
      return requestId;
    },
    customLogLevel(req, res, err) {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url,
          remoteAddress: req.socket?.remoteAddress,
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  });
}
