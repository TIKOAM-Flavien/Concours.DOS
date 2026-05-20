import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CUSTOM_DOC_CATEGORY } from "../src/lib/adminConstants.js";
import {
  buildCompanyDirectory,
  buildCompanyDocumentGroups,
  buildCompanyDocumentOptions,
  countTotalCompanies,
  filterDirectoryResults,
  sumExpectedPieces,
} from "../src/lib/adminCompanyDocuments.js";

describe("adminCompanyDocuments", () => {
  it("buildCompanyDocumentOptions deduplicates by id", () => {
    const catalog = [{ id: "DOC_A", label: "A", category: "Cat" }];
    const custom = [{ id: "DOC_A", label: "Duplicate" }, { id: "CUSTOM_X", label: "X" }];
    const options = buildCompanyDocumentOptions(catalog, custom);
    assert.equal(options.length, 2);
    assert.equal(options[0].id, "DOC_A");
    assert.equal(options[1].id, "CUSTOM_X");
  });

  it("buildCompanyDocumentGroups adds empty custom category when not searching", () => {
    const groups = buildCompanyDocumentGroups(
      [{ id: "DOC_A", label: "A", category: "Admin" }],
      ""
    );
    assert.ok(groups.some((group) => group.category === CUSTOM_DOC_CATEGORY));
  });

  it("buildCompanyDirectory aggregates usage across projects", () => {
    const directory = buildCompanyDirectory([
      {
        id: "p1",
        name: "Projet 1",
        companies: [
          {
            companyId: "ACME",
            companyName: "Acme",
            contactName: "Alice",
            companyEmail: "a@acme.test",
            expectedDocuments: ["DOC_A"],
          },
        ],
      },
      {
        id: "p2",
        name: "Projet 2",
        companies: [
          {
            companyId: "ACME",
            companyName: "Acme",
            contactName: "Alice",
            companyEmail: "a@acme.test",
            expectedDocuments: ["DOC_B"],
          },
        ],
      },
    ]);
    assert.equal(directory.length, 1);
    assert.equal(directory[0].usageCount, 2);
  });

  it("filterDirectoryResults marks attached companies and filters search", () => {
    const directory = buildCompanyDirectory([
      {
        id: "p1",
        name: "Alpha",
        companies: [
          {
            companyId: "ACME",
            companyName: "Acme",
            contactName: "Alice",
            companyEmail: "a@acme.test",
            expectedDocuments: [],
          },
          {
            companyId: "BETA",
            companyName: "Beta Corp",
            contactName: "Bob",
            companyEmail: "b@beta.test",
            expectedDocuments: [],
          },
        ],
      },
    ]);
    const selectedProject = {
      companies: [{ companyId: "ACME", companyName: "Acme" }],
    };
    const filtered = filterDirectoryResults(directory, selectedProject, "beta");
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].companyName, "Beta Corp");
    assert.equal(filtered[0].alreadyAttached, false);

    const attached = filterDirectoryResults(directory, selectedProject, "");
    const acme = attached.find((entry) => entry.companyName === "Acme");
    assert.equal(acme.alreadyAttached, true);
  });

  it("sumExpectedPieces and countTotalCompanies aggregate project data", () => {
    const projects = [
      {
        companies: [
          { expectedDocuments: ["A", "B"] },
          { expectedDocuments: ["C"] },
        ],
      },
      {
        companies: [{ expectedDocuments: ["D"] }],
      },
    ];
    assert.equal(sumExpectedPieces(projects), 4);
    assert.equal(countTotalCompanies(projects), 3);
  });
});
