import { z } from "zod";

// Centralized Zod schemas for the request bodies that previously parsed each
// field manually with normalizeTextField. The middleware adapter at the bottom
// converts a Zod failure into a 400 with a consistent shape so route handlers
// can stay focused on business logic.

const trimmedString = (max) =>
  z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length <= max, { message: `must be <= ${max} characters` });

const optionalString = (max) =>
  z
    .union([z.string(), z.undefined(), z.null()])
    .transform((value) => (value == null ? "" : String(value).trim()))
    .refine((value) => value.length <= max, { message: `must be <= ${max} characters` });

export const signedLinkSchema = z.object({
  inv: trimmedString(2000),
  sig: trimmedString(1024),
  alg: optionalString(32).default("HS256"),
  source: optionalString(32).optional(),
});

export const portalVerifySchema = signedLinkSchema;

export const portalDownloadSchema = signedLinkSchema.extend({
  filePath: optionalString(1000),
  fileIdentifier: optionalString(1000),
});

export const portalDeleteSchema = portalDownloadSchema.extend({
  documentId: optionalString(120),
});

export const adminLoginSchema = z.object({
  username: trimmedString(120),
  password: z.string().min(1).max(256),
});

export const reviewStatusSchema = z.object({
  reviewStatus: z.enum(["pending", "accepted", "rejected"]),
  reviewComment: optionalString(2000).optional(),
});

// Express middleware: validates `req.body` against `schema`, replaces the body
// with the parsed (sanitized) result, or responds with 400.
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue?.path?.join(".") || "body";
      return res.status(400).json({
        error: `Invalid ${path}: ${issue?.message || "validation failed"}`,
        details: result.error.issues.map((each) => ({
          path: each.path.join("."),
          message: each.message,
        })),
      });
    }
    req.body = result.data;
    next();
  };
}
