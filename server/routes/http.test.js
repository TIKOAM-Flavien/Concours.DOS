import test from "node:test";
import assert from "node:assert/strict";

import express from "express";
import request from "supertest";

import { validateBody, reviewStatusSchema } from "../lib/validation.js";

// Sanity-check the validation middleware end-to-end through Express, so a
// regression in Zod wiring or response shape is caught by `npm test`.
test("validateBody middleware", async (t) => {
  const app = express();
  app.use(express.json());
  app.patch("/review", validateBody(reviewStatusSchema), (req, res) => {
    res.json({ ok: true, body: req.body });
  });

  await t.test("rejects an invalid reviewStatus with 400 + details", async () => {
    const res = await request(app)
      .patch("/review")
      .send({ reviewStatus: "maybe" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /reviewStatus/);
    assert.ok(Array.isArray(res.body.details));
  });

  await t.test("accepts a valid payload and trims optional fields", async () => {
    const res = await request(app)
      .patch("/review")
      .send({ reviewStatus: "accepted", reviewComment: "  ok  " });
    assert.equal(res.status, 200);
    assert.equal(res.body.body.reviewStatus, "accepted");
    assert.equal(res.body.body.reviewComment, "ok");
  });

  await t.test("treats a missing body as an invalid one", async () => {
    const res = await request(app).patch("/review").send({});
    assert.equal(res.status, 400);
  });
});

test("validateBody preserves request id header when present", async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.setHeader("X-Request-Id", req.headers["x-request-id"] || "");
    next();
  });
  app.post("/echo", validateBody(reviewStatusSchema), (req, res) => res.json(req.body));

  const res = await request(app)
    .post("/echo")
    .set("X-Request-Id", "abc-123")
    .send({ reviewStatus: "rejected" });
  assert.equal(res.status, 200);
  assert.equal(res.headers["x-request-id"], "abc-123");
});
