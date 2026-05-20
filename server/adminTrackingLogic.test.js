import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCompanyTracking,
  buildFilteredTrackingSummary,
  filterCompanyTracking,
  hasActiveTrackingFilters,
} from "../src/lib/adminTrackingLogic.js";
import { DOCUMENT_OPTIONS } from "../src/lib/adminConstants.js";

describe("adminTrackingLogic", () => {
  const docA = DOCUMENT_OPTIONS[0].id;
  const docB = DOCUMENT_OPTIONS[1].id;

  const project = {
    id: "project-a",
    dossierId: "DOSS-A",
    companies: [
      {
        id: "c1",
        companyId: "ACME",
        companyName: "Acme",
        contactName: "Alice",
        companyEmail: "a@acme.test",
        submissionId: "sub-acme",
        expectedDocuments: [docA],
      },
      {
        id: "c2",
        companyId: "BETA",
        companyName: "Beta",
        contactName: "Bob",
        companyEmail: "b@beta.test",
        submissionId: "sub-beta",
        expectedDocuments: [docA, docB],
      },
    ],
  };

  const records = [
    {
      submissionId: "sub-acme",
      companyId: "ACME",
      companyName: "Acme",
      documentType: docA,
      fileName: "memoire-acme.pdf",
      modifiedAt: "2026-05-01T10:00:00.000Z",
    },
    {
      submissionId: "sub-beta",
      companyId: "BETA",
      companyName: "Beta",
      documentType: docA,
      fileName: "memoire-beta.pdf",
      modifiedAt: "2026-05-02T10:00:00.000Z",
    },
  ];

  it("buildCompanyTracking computes completion status per company", () => {
    const tracking = buildCompanyTracking({
      selectedProject: project,
      records,
    });

    assert.equal(tracking.length, 2);
    assert.equal(tracking[0].companyName, "Acme");
    assert.equal(tracking[0].statusKey, "complete");
    assert.equal(tracking[1].statusKey, "progress");
    assert.equal(tracking[1].receivedCount, 1);
    assert.equal(tracking[1].expectedCount, 2);
  });

  it("filterCompanyTracking searches and filters by status", () => {
    const tracking = buildCompanyTracking({
      selectedProject: project,
      records,
    });

    const betaOnly = filterCompanyTracking(tracking, { trackingSearch: "beta" });
    assert.equal(betaOnly.length, 1);
    assert.equal(betaOnly[0].companyName, "Beta");

    const completeOnly = filterCompanyTracking(tracking, {
      trackingStatusFilter: "complete",
    });
    assert.equal(completeOnly.length, 1);
    assert.equal(completeOnly[0].companyName, "Acme");
  });

  it("buildFilteredTrackingSummary and hasActiveTrackingFilters work", () => {
    const tracking = buildCompanyTracking({
      selectedProject: project,
      records,
    });
    const filtered = filterCompanyTracking(tracking, { trackingOnlyMissing: true });

    assert.deepEqual(buildFilteredTrackingSummary(filtered), {
      total: 1,
      complete: 0,
      progress: 1,
      todo: 0,
    });

    assert.equal(hasActiveTrackingFilters({}), false);
    assert.equal(hasActiveTrackingFilters({ trackingSearch: "acme" }), true);
    assert.equal(hasActiveTrackingFilters({ trackingOnlyMissing: true }), true);
  });
});
