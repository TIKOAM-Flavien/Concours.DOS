import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCompanyId,
  buildProjectId,
  dedupe,
  matchCompanyRecords,
  normalizeKey,
  slugify,
} from "../src/lib/adminUtils.js";

describe("adminUtils", () => {
  it("slugify removes accents and special characters", () => {
    assert.equal(slugify("Projet École #1"), "projet-ecole-1");
  });

  it("dedupe trims and removes empty values", () => {
    assert.deepEqual(dedupe([" a ", "a", "", "b"]), ["a", "b"]);
  });

  it("buildProjectId prefers dossierId slug", () => {
    assert.equal(
      buildProjectId({ dossierId: "DOSS-2026", name: "Ignored" }),
      "project-doss-2026"
    );
  });

  it("buildCompanyId uppercases company token", () => {
    assert.equal(buildCompanyId({ companyId: "acme", companyName: "" }), "ENT-ACME");
  });

  it("matchCompanyRecords matches by submissionId first", () => {
    const company = { submissionId: "inv-a-b", companyId: "X", companyName: "Acme" };
    const records = [
      { submissionId: "inv-a-b", companyId: "Y", companyName: "Other" },
      { submissionId: "inv-c-d", companyId: "X", companyName: "Acme" },
    ];
    assert.equal(matchCompanyRecords(company, records).length, 1);
    assert.equal(
      normalizeKey(matchCompanyRecords(company, records)[0].submissionId),
      normalizeKey("inv-a-b")
    );
  });
});
