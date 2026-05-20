import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildOverviewSummary,
  enrichOverviewItems,
  filterOverviewItems,
} from "../src/lib/adminOverviewLogic.js";

describe("adminOverviewLogic", () => {
  const now = Date.parse("2026-05-20T12:00:00.000Z");

  it("enrichOverviewItems marks overdue and reminder flags", () => {
    const items = enrichOverviewItems(
      [
        {
          id: "p1",
          statusKey: "progress",
          incompleteCompanies: 2,
          deadline: "2026-05-18T00:00:00.000Z",
        },
        {
          id: "p2",
          statusKey: "complete",
          incompleteCompanies: 0,
          deadline: "2026-05-25T00:00:00.000Z",
        },
      ],
      { now }
    );

    assert.equal(items[0].urgencyKey, "overdue");
    assert.equal(items[0].needsReminder, true);
    assert.equal(items[1].urgencyKey, "done");
    assert.equal(items[1].needsReminder, false);
  });

  it("buildOverviewSummary counts complete, urgent and reminders", () => {
    const items = enrichOverviewItems(
      [
        {
          id: "p1",
          statusKey: "complete",
          incompleteCompanies: 0,
          deadline: "2026-06-01T00:00:00.000Z",
        },
        {
          id: "p2",
          statusKey: "almost",
          incompleteCompanies: 1,
          deadline: "2026-05-21T00:00:00.000Z",
        },
        {
          id: "p3",
          statusKey: "progress",
          incompleteCompanies: 3,
          deadline: "2026-05-19T00:00:00.000Z",
        },
      ],
      { now }
    );

    assert.deepEqual(buildOverviewSummary(items), {
      complete: 1,
      almost: 1,
      urgent: 2,
      reminders: 2,
    });
  });

  it("filterOverviewItems applies status and reminder filters", () => {
    const items = enrichOverviewItems(
      [
        { id: "p1", statusKey: "complete", incompleteCompanies: 0, deadline: "" },
        { id: "p2", statusKey: "progress", incompleteCompanies: 2, deadline: "" },
      ],
      { now }
    );

    assert.equal(filterOverviewItems(items, "complete").length, 1);
    assert.equal(filterOverviewItems(items, "reminders").length, 1);
    assert.equal(filterOverviewItems(items, "all").length, 2);
  });
});
