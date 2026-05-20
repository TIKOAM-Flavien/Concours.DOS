const DAY_MS = 24 * 60 * 60 * 1000;

export function enrichOverviewItems(projects, { now = Date.now() } = {}) {
  return (projects || []).map((entry) => {
    let urgencyKey = "none";
    let daysUntilDeadline = null;
    if (entry.deadline) {
      const parsed = Date.parse(entry.deadline);
      if (!Number.isNaN(parsed)) {
        daysUntilDeadline = Math.ceil((parsed - now) / DAY_MS);
        if (entry.statusKey === "complete") {
          urgencyKey = "done";
        } else if (daysUntilDeadline < 0) {
          urgencyKey = "overdue";
        } else if (daysUntilDeadline <= 3) {
          urgencyKey = "urgent";
        } else if (daysUntilDeadline <= 14) {
          urgencyKey = "soon";
        } else {
          urgencyKey = "normal";
        }
      }
    }
    const needsReminder =
      entry.statusKey !== "complete" &&
      entry.statusKey !== "empty" &&
      entry.incompleteCompanies > 0;
    return {
      ...entry,
      urgencyKey,
      daysUntilDeadline,
      needsReminder,
    };
  });
}

export function buildOverviewSummary(overviewItems) {
  return (overviewItems || []).reduce(
    (acc, item) => {
      if (item.statusKey === "complete") acc.complete += 1;
      else if (item.statusKey === "almost") acc.almost += 1;
      if (item.urgencyKey === "overdue" || item.urgencyKey === "urgent") {
        if (item.statusKey !== "complete") acc.urgent += 1;
      }
      if (item.needsReminder) acc.reminders += 1;
      return acc;
    },
    { complete: 0, almost: 0, urgent: 0, reminders: 0 }
  );
}

export function filterOverviewItems(overviewItems, overviewFilter) {
  if (overviewFilter === "all") return overviewItems || [];
  return (overviewItems || []).filter((item) => {
    if (overviewFilter === "complete") return item.statusKey === "complete";
    if (overviewFilter === "almost") return item.statusKey === "almost";
    if (overviewFilter === "urgent") {
      return (
        item.statusKey !== "complete" &&
        (item.urgencyKey === "overdue" || item.urgencyKey === "urgent")
      );
    }
    if (overviewFilter === "reminders") return item.needsReminder;
    return true;
  });
}
