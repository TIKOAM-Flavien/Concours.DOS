import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import StatusBanner from "../components/StatusBanner";
import { getAvailableDocuments, resolveDocumentList } from "../config/documentCatalog";
import { portalEnv } from "../config/env";
import { formatDateTime } from "../lib/files";
import { createPowerAutomateClient } from "../lib/powerAutomateClient";
import {
  buildDocumentState,
  normalizeSharePointRecords,
} from "../lib/sharePointDocuments";
import * as api from "../lib/adminApi";

const DOCUMENT_OPTIONS = getAvailableDocuments();
const DEFAULT_EXPECTED_DOCUMENTS = DOCUMENT_OPTIONS.slice(0, 4).map(
  (document) => document.id
);
// Matches the category that the server forces on every custom project document
// in `normalizeCustomProjectDocuments`. Used to anchor the inline "add piece
// specifique" form to the right group in the company modal.
const CUSTOM_DOC_CATEGORY = "Pieces specifiques";
const TRACKING_STATUS_OPTIONS = [
  { value: "all", label: "Tous les statuts" },
  { value: "todo", label: "A demarrer" },
  { value: "progress", label: "En cours" },
  { value: "complete", label: "Complet" },
];

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function confirmByTyping({ title, expectedText, confirmLabel = "SUPPRIMER" }) {
  const expected = String(expectedText || "").trim();
  if (!expected) return false;

  const message = [
    title || "Action destructive",
    "",
    `Pour confirmer, saisissez exactement :`,
    expected,
    "",
    `Ou tapez "${confirmLabel}" pour annuler.`,
  ].join("\n");

  const input = window.prompt(message, "");
  if (input == null) return false;
  const typed = String(input).trim();
  if (typed.toUpperCase() === String(confirmLabel || "").toUpperCase()) return false;
  return typed === expected;
}

function uniqueSuffix() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().slice(0, 8);
  }

  return Date.now().toString(36);
}

function dedupe(values) {
  return Array.from(
    new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))
  );
}

function hydrateExpectedDocuments(expectedDocumentIds, customDocuments) {
  const customById = new Map(
    (customDocuments || [])
      .filter((doc) => doc && typeof doc === "object" && doc.id)
      .map((doc) => [doc.id, doc])
  );
  return (expectedDocumentIds || []).map((id) => customById.get(id) || id);
}

function createEmptyProjectForm(defaultFolderPath = "") {
  return {
    id: "",
    name: "",
    dossierId: "",
    folderPath: defaultFolderPath,
    deadline: "",
    customDocumentsText: "",
  };
}

function createEmptyCompanyForm() {
  return {
    id: "",
    companyName: "",
    companyId: "",
    contactName: "",
    companyEmail: "",
    submissionId: "",
    expectedDocuments: [...DEFAULT_EXPECTED_DOCUMENTS],
  };
}

function toProjectForm(project) {
  return {
    id: project.id,
    name: project.name || "",
    dossierId: project.dossierId || "",
    folderPath: project.folderPath || "",
    deadline: project.deadline || "",
    customDocumentsText: Array.isArray(project.customDocuments)
      ? project.customDocuments
          .map((doc) => String(doc?.label || "").trim())
          .filter(Boolean)
          .join("\n")
      : "",
  };
}

function toCompanyForm(company) {
  return {
    id: company.id,
    companyName: company.companyName || "",
    companyId: company.companyId || "",
    contactName: company.contactName || "",
    companyEmail: company.companyEmail || "",
    submissionId: company.submissionId || "",
    expectedDocuments: [...(company.expectedDocuments || [])],
  };
}


function buildProjectId(projectForm) {
  const base = slugify(projectForm.dossierId || projectForm.name);
  return base ? `project-${base}` : `project-${uniqueSuffix()}`;
}

function buildCompanyId(companyForm) {
  const base = slugify(companyForm.companyId || companyForm.companyName).toUpperCase();
  return base ? `ENT-${base}` : `ENT-${uniqueSuffix().toUpperCase()}`;
}

function buildSubmissionId(project, company) {
  const projectToken = slugify(project.dossierId || project.name).slice(0, 20) || "projet";
  const companyToken =
    slugify(company.companyId || company.companyName).slice(0, 20) || "entreprise";
  return `inv-${projectToken}-${companyToken}`;
}

function directoryKey(company) {
  return String(
    company?.companyId || company?.companyEmail || company?.companyName || ""
  )
    .trim()
    .toLowerCase();
}

function matchCompanyRecords(company, records) {
  return records.filter((record) => {
    if (company.submissionId && record.submissionId) {
      return normalizeKey(record.submissionId) === normalizeKey(company.submissionId);
    }
    if (company.companyId && record.companyId) {
      return normalizeKey(record.companyId) === normalizeKey(company.companyId);
    }
    return normalizeKey(record.companyName) === normalizeKey(company.companyName);
  });
}

function trackingStatusClassName(statusKey) {
  if (statusKey === "complete") return "status-pill status-pill--success";
  if (statusKey === "progress") return "status-pill status-pill--warning";
  return "status-pill";
}

function documentSyncClassName(record) {
  if (!record) return "admin-doc-pill admin-doc-pill--missing";
  if (record.syncStatus === "sync_failed") return "admin-doc-pill admin-doc-pill--error";
  if (record.syncStatus === "sync_pending" || record.syncStatus === "syncing") {
    return "admin-doc-pill admin-doc-pill--pending";
  }
  return "admin-doc-pill admin-doc-pill--done";
}

function documentSyncLabel(record) {
  if (!record) return "";
  if (record.syncStatus === "sync_failed") return " - erreur sync";
  if (record.syncStatus === "syncing") return " - sync en cours";
  if (record.syncStatus === "sync_pending") return " - sync en attente";
  if (record.syncStatus === "synced") return " - synchronise";
  return "";
}

const OVERVIEW_STATUS_LABELS = {
  complete: "Complet",
  almost: "Presque complet",
  progress: "En cours",
  todo: "A demarrer",
  empty: "Sans piece",
  unknown: "Etat inconnu",
};

function overviewStatusClassName(statusKey) {
  if (statusKey === "complete") return "status-pill status-pill--success";
  if (statusKey === "almost") return "status-pill status-pill--info";
  if (statusKey === "progress") return "status-pill status-pill--warning";
  if (statusKey === "todo") return "status-pill status-pill--neutral";
  return "status-pill";
}

function overviewUrgencyMeta(urgencyKey, daysUntilDeadline) {
  if (urgencyKey === "overdue") {
    const overdueBy = Math.abs(daysUntilDeadline ?? 0);
    return {
      label: overdueBy ? `Echeance depassee (${overdueBy} j)` : "Echeance depassee",
      className: "overview-urgency overview-urgency--overdue",
    };
  }
  if (urgencyKey === "urgent") {
    return {
      label: `Urgent : ${daysUntilDeadline} j`,
      className: "overview-urgency overview-urgency--urgent",
    };
  }
  if (urgencyKey === "soon") {
    return {
      label: `Bientot : ${daysUntilDeadline} j`,
      className: "overview-urgency overview-urgency--soon",
    };
  }
  if (urgencyKey === "done") {
    return {
      label: "Echeance respectee",
      className: "overview-urgency overview-urgency--done",
    };
  }
  if (urgencyKey === "normal") {
    return {
      label: `${daysUntilDeadline} j restants`,
      className: "overview-urgency",
    };
  }
  return {
    label: "Sans echeance",
    className: "overview-urgency overview-urgency--muted",
  };
}

export default function AdminApp() {
  const [client] = useState(() => createPowerAutomateClient());
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectForm, setProjectForm] = useState(() =>
    createEmptyProjectForm(portalEnv.defaultFolderPath)
  );
  const [companyForm, setCompanyForm] = useState(() => createEmptyCompanyForm());
  const [notice, setNotice] = useState(null);
  const [dbLoading, setDbLoading] = useState(true);
  const [syncState, setSyncState] = useState({
    status: "idle",
    records: [],
    error: "",
  });
  const [signingState, setSigningState] = useState({
    status: "loading",
    flows: {},
  });
  const [trackingSearch, setTrackingSearch] = useState("");
  const [trackingStatusFilter, setTrackingStatusFilter] = useState("all");
  const [trackingDocumentFilter, setTrackingDocumentFilter] = useState("all");
  const [trackingDocumentStateFilter, setTrackingDocumentStateFilter] = useState("all");
  const [trackingOnlyMissing, setTrackingOnlyMissing] = useState(false);
  const [trackingView, setTrackingView] = useState("cards");
  const [trackingRefreshKey, setTrackingRefreshKey] = useState(0);
  const [companyDocumentSearch, setCompanyDocumentSearch] = useState("");
  const [customDocInput, setCustomDocInput] = useState("");
  const [customDocSaving, setCustomDocSaving] = useState(false);
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [companySaveStatus, setCompanySaveStatus] = useState({
    phase: "idle",
    mode: "create",
  });
  const companySaveTimerRef = useRef(null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState(() => new Set());
  const [emailSending, setEmailSending] = useState(null);
  const [directorySearch, setDirectorySearch] = useState("");
  const [overviewState, setOverviewState] = useState({
    status: "idle",
    projects: [],
    generatedAt: "",
    synced: false,
    error: "",
  });
  const [overviewFilter, setOverviewFilter] = useState("all");
  const [overviewVisible, setOverviewVisible] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem("admin.overviewVisible");
    return stored === null ? true : stored === "1";
  });
  const [showArchived, setShowArchived] = useState(false);
  const [ribbonStuck, setRibbonStuck] = useState(false);
  /** Dark / bold ribbon only when the bar is flush with the viewport top (sticky), not when it sits mid-page with scrollY === 0. */
  const [ribbonDockedTop, setRibbonDockedTop] = useState(false);
  const adminShellRef = useRef(null);
  const ribbonSentinelRef = useRef(null);
  const ribbonNavRef = useRef(null);
  const ribbonTrackRef = useRef(null);

  const refreshProjects = useCallback(async () => {
    try {
      const data = await api.fetchProjects({ includeArchived: showArchived });
      setProjects(data);
      return data;
    } catch (err) {
      console.error("Failed to load projects from DB:", err);
      setNotice({ tone: "error", title: "Erreur base de donnees", message: err.message });
      return [];
    }
  }, [showArchived]);

  const refreshOverview = useCallback(async () => {
    setOverviewState((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const data = await api.fetchOverview();
      setOverviewState({
        status: "ready",
        projects: Array.isArray(data?.projects) ? data.projects : [],
        generatedAt: data?.generatedAt || "",
        synced: Boolean(data?.synced),
        error: "",
      });
    } catch (err) {
      console.error("Failed to load overview:", err);
      setOverviewState((current) => ({
        ...current,
        status: "error",
        error: err.message || "Impossible de charger la vue d'ensemble.",
      }));
    }
  }, []);

  const allTrackableDocuments = useMemo(
    () => resolveDocumentList(DOCUMENT_OPTIONS.map((document) => document.id)),
    []
  );
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );
  const selectedProjectCustomDocs = useMemo(
    () => (Array.isArray(selectedProject?.customDocuments) ? selectedProject.customDocuments : []),
    [selectedProject]
  );
  const companyDocumentOptions = useMemo(() => {
    const merged = [...DOCUMENT_OPTIONS, ...selectedProjectCustomDocs];
    const seen = new Set();
    return merged.filter((doc) => {
      const id = String(doc?.id || "").trim();
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [selectedProjectCustomDocs]);
  const companyDocumentGroups = useMemo(() => {
    const needle = String(companyDocumentSearch || "")
      .toLowerCase()
      .trim();
    const filtered = needle
      ? companyDocumentOptions.filter((doc) => {
          const haystack = `${doc.label || ""} ${doc.category || ""} ${doc.summary || ""}`.toLowerCase();
          return haystack.includes(needle);
        })
      : companyDocumentOptions;

    const map = new Map();
    for (const doc of filtered) {
      const category = String(doc.category || "Autres").trim() || "Autres";
      if (!map.has(category)) map.set(category, []);
      map.get(category).push(doc);
    }
    const groups = Array.from(map.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([category, items]) => ({ category, items }));

    // When not actively searching, always surface the "Pieces specifiques"
    // group so users can add a custom piece even when the project has none yet.
    if (!needle && !groups.some((group) => group.category === CUSTOM_DOC_CATEGORY)) {
      groups.push({ category: CUSTOM_DOC_CATEGORY, items: [] });
    }
    return groups;
  }, [companyDocumentOptions, companyDocumentSearch]);
  const companyDirectory = useMemo(() => {
    const map = new Map();
    for (const project of projects) {
      for (const company of project.companies || []) {
        const key = directoryKey(company);
        if (!key) continue;
        const existing = map.get(key);
        if (existing) {
          existing.usageCount += 1;
          continue;
        }
        map.set(key, {
          key,
          companyId: company.companyId || "",
          companyName: company.companyName || "",
          contactName: company.contactName || "",
          companyEmail: company.companyEmail || "",
          expectedDocuments: Array.isArray(company.expectedDocuments)
            ? company.expectedDocuments
            : [],
          lastProjectId: project.id,
          lastProjectName: project.name || "",
          usageCount: 1,
        });
      }
    }
    return Array.from(map.values()).sort((left, right) =>
      left.companyName.localeCompare(right.companyName, "fr", {
        sensitivity: "base",
      })
    );
  }, [projects]);
  const directorySearchResults = useMemo(() => {
    const attachedKeys = new Set(
      (selectedProject?.companies || []).map(directoryKey)
    );
    const decorated = companyDirectory.map((entry) => ({
      ...entry,
      alreadyAttached: attachedKeys.has(entry.key),
    }));
    const needle = normalizeKey(directorySearch);
    if (!needle) return decorated;
    return decorated.filter((entry) =>
      [
        entry.companyName,
        entry.companyId,
        entry.contactName,
        entry.companyEmail,
        entry.lastProjectName,
      ].some((value) => normalizeKey(value).includes(needle))
    );
  }, [companyDirectory, directorySearch, selectedProject]);
  const secureLinkEnabled = signingState.status === "enabled";
  const signingStatusLabel =
    signingState.status === "loading"
      ? "Verification..."
      : secureLinkEnabled
      ? "Signature active"
      : "Secret serveur manquant";

  const firstLoadRef = useRef(true);
  useEffect(() => {
    refreshProjects().then((data) => {
      if (!firstLoadRef.current) return;
      firstLoadRef.current = false;
      setDbLoading(false);
      if (data.length) {
        setSelectedProjectId(data[0].id);
        setProjectForm(toProjectForm(data[0]));
        refreshOverview();
      }
    });
  }, [refreshOverview, refreshProjects]);

  useEffect(() => {
    let active = true;

    api
      .fetchSecurityStatus()
      .then((security) => {
        if (!active) return;
        setSigningState({
          status: security.signingEnabled ? "enabled" : "disabled",
          flows: security.flows || {},
        });
      })
      .catch((error) => {
        if (!active) return;
        setSigningState({ status: "disabled", flows: {} });
        setNotice({
          tone: "error",
          title: "Signature indisponible",
          message:
            error.message ||
            "Impossible de verifier la configuration de signature serveur.",
        });
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "admin.overviewVisible",
      overviewVisible ? "1" : "0"
    );
  }, [overviewVisible]);

  useEffect(() => {
    if (!projects.length) {
      setSelectedProjectId("");
      setProjectForm(createEmptyProjectForm(portalEnv.defaultFolderPath));
      return;
    }
    // If the user intentionally cleared the selection (e.g. creating a new project),
    // don't force-select the first project.
    if (!selectedProjectId) return;

    if (projects.some((project) => project.id === selectedProjectId)) {
      return;
    }
    const project = projects[0];
    setSelectedProjectId(project.id);
    setProjectForm(toProjectForm(project));
  }, [projects, selectedProjectId]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function loadTracking() {
      if (!selectedProject || !signingState.flows.documentsEnabled) {
        setSyncState({ status: "idle", records: [], error: "" });
        return;
      }

      setSyncState((current) => ({ ...current, status: "loading", error: "" }));

      try {
        const rows = await client.listDocuments({
          projectId: selectedProject.id,
          dossierId: selectedProject.dossierId,
          companyId: "",
          companyName: "",
          submissionId: "",
        }, { signal: controller.signal });
        if (!active) return;

        setSyncState({
          status: "ready",
          records: normalizeSharePointRecords(rows, {
            documents: allTrackableDocuments,
            companyId: "",
            companyName: "",
            submissionId: "",
          }),
          error: "",
        });
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (!active) return;
        setSyncState({
          status: "error",
          records: [],
          error: error.message || "Lecture du stockage local impossible.",
        });
      }
    }

    loadTracking();
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    allTrackableDocuments,
    client,
    selectedProject,
    signingState.flows.documentsEnabled,
    trackingRefreshKey,
  ]);

  // Auto-refresh the tracking section while at least one record is still
  // mid-sync. The worker uploads asynchronously after the portal ACKs the
  // file, so without this the admin must click "Actualiser" to see when
  // `syncing` / `sync_pending` flips to `synced`. Backoff + visibility
  // gating mirror the portal-side polling for the same reasons.
  const hasInFlightAdminSync = useMemo(
    () =>
      syncState.records.some((record) =>
        ["sync_pending", "syncing"].includes(record.syncStatus)
      ),
    [syncState.records]
  );
  useEffect(() => {
    if (!hasInFlightAdminSync) return undefined;
    if (!selectedProject) return undefined;
    if (typeof window === "undefined") return undefined;

    let cancelled = false;
    let timer = null;
    let delay = 5000;
    const maxDelay = 60000;
    const startedAt = Date.now();
    const maxRunMs = 15 * 60 * 1000;

    const isHidden = () =>
      typeof document !== "undefined" && document.visibilityState === "hidden";

    function schedule(ms) {
      if (cancelled) return;
      timer = window.setTimeout(tick, ms);
    }

    function tick() {
      if (cancelled) return;
      if (Date.now() - startedAt > maxRunMs) {
        cancelled = true;
        return;
      }
      if (isHidden()) {
        schedule(delay);
        return;
      }
      setTrackingRefreshKey((current) => current + 1);
      delay = Math.min(maxDelay, delay * 2);
      schedule(delay);
    }

    function onVisibility() {
      if (cancelled) return;
      if (!isHidden()) {
        if (timer) window.clearTimeout(timer);
        delay = 5000;
        tick();
      }
    }

    document.addEventListener("visibilitychange", onVisibility);
    schedule(delay);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hasInFlightAdminSync, selectedProject]);

  const companyTracking = useMemo(() => {
    if (!selectedProject) return [];

    return (selectedProject.companies || [])
      .map((company) => {
        const expectedDocuments = resolveDocumentList(
          hydrateExpectedDocuments(company.expectedDocuments, selectedProjectCustomDocs)
        );
        const companyRecords = matchCompanyRecords(company, syncState.records);
        const documentState = buildDocumentState(expectedDocuments, companyRecords);
        const receivedCount = documentState.filter((item) => item.latest).length;
        const expectedCount = expectedDocuments.length;
        const missingLabels = documentState
          .filter((item) => !item.latest)
          .map((item) => item.document.label);
        const lastRecord = companyRecords[0] || null;
        let status = "A demarrer";
        let statusKey = "todo";

        if (expectedCount > 0 && receivedCount === expectedCount) {
          status = "Complet";
          statusKey = "complete";
        } else if (receivedCount > 0) {
          status = "En cours";
          statusKey = "progress";
        }

        return {
          ...company,
          expectedCount,
          receivedCount,
          status,
          statusKey,
          completionRate: expectedCount
            ? Math.round((receivedCount / expectedCount) * 100)
            : 0,
          documentState,
          missingSummary: missingLabels.length ? missingLabels.join(", ") : "Aucune",
          lastReceptionAt: lastRecord?.modifiedAt || "",
        };
      })
      .sort((left, right) => left.companyName.localeCompare(right.companyName));
  }, [selectedProject, selectedProjectCustomDocs, syncState.records]);

  const totalExpectedPieces = useMemo(
    () =>
      projects.reduce(
        (sum, project) =>
          sum +
          (project.companies || []).reduce(
            (companySum, company) =>
              companySum + (company.expectedDocuments || []).length,
            0
          ),
        0
      ),
    [projects]
  );
  const totalCompanies = useMemo(
    () => projects.reduce((sum, project) => sum + (project.companies || []).length, 0),
    [projects]
  );
  const selectedProjectCompanyCount = useMemo(() => {
    if (!selectedProject) return null;
    return (selectedProject.companies || []).length;
  }, [selectedProject]);
  const selectedProjectReceived = useMemo(
    () => companyTracking.reduce((sum, company) => sum + company.receivedCount, 0),
    [companyTracking]
  );
  const selectedProjectExpected = useMemo(
    () => companyTracking.reduce((sum, company) => sum + company.expectedCount, 0),
    [companyTracking]
  );
  const selectedProjectIsComplete = useMemo(() => {
    if (!selectedProject || !companyTracking.length) return false;
    return companyTracking.every(
      (company) => company.expectedCount > 0 && company.receivedCount >= company.expectedCount
    );
  }, [companyTracking, selectedProject]);
  const overviewItems = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    return overviewState.projects.map((entry) => {
      let urgencyKey = "none";
      let daysUntilDeadline = null;
      if (entry.deadline) {
        const parsed = Date.parse(entry.deadline);
        if (!Number.isNaN(parsed)) {
          daysUntilDeadline = Math.ceil((parsed - now) / dayMs);
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
  }, [overviewState.projects]);
  const overviewSummary = useMemo(() => {
    return overviewItems.reduce(
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
  }, [overviewItems]);
  const filteredOverviewItems = useMemo(() => {
    if (overviewFilter === "all") return overviewItems;
    return overviewItems.filter((item) => {
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
  }, [overviewItems, overviewFilter]);
  const unfinishedProjects = useMemo(
    () =>
      projects.filter((project) => {
        if (project.id === selectedProjectId) {
          return !selectedProjectIsComplete;
        }
        return true;
      }),
    [projects, selectedProjectId, selectedProjectIsComplete]
  );

  // Detect when the .admin-project-ribbon becomes "stuck" against the top of the
  // viewport via a zero-height sentinel placed just above it. As soon as the
  // sentinel leaves the viewport (scrolled past), the sticky nav is glued to
  // the top and we toggle the --stuck modifier so the CSS can show a stronger
  // shadow while keeping the same border in both states.
  useEffect(() => {
    const sentinel = ribbonSentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => setRibbonStuck(!entry.isIntersecting),
      { threshold: [0], rootMargin: "0px 0px 0px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [unfinishedProjects.length]);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (unfinishedProjects.length === 0) return undefined;
    const nav = ribbonNavRef.current;
    if (!nav) return undefined;

    const thresholdPx = 2;
    const sync = () => {
      setRibbonDockedTop(nav.getBoundingClientRect().top <= thresholdPx);
    };

    window.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync, { passive: true });
    const shell = adminShellRef.current;
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => sync()) : null;
    if (ro) {
      ro.observe(nav);
      if (shell) ro.observe(shell);
    }
    sync();
    requestAnimationFrame(sync);

    return () => {
      window.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      ro?.disconnect();
    };
  }, [unfinishedProjects.length, overviewVisible]);

  // Convert vertical wheel input into horizontal scrolling on the project track
  // (so users can browse projects with a regular mouse wheel) and consume the
  // event only when the track actually has room to scroll, otherwise the page
  // keeps scrolling normally. The listener is attached to the whole nav so that
  // wheeling anywhere over the ribbon (including the left "Projets en cours"
  // label) scrolls the project list. addEventListener with passive: false is
  // required to call preventDefault; React's onWheel is passive by default.
  useEffect(() => {
    const nav = ribbonNavRef.current;
    if (!nav) return undefined;

    function handleWheel(event) {
      const track = ribbonTrackRef.current;
      if (!track) return;
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      if (delta === 0) return;
      const canScrollLeft = track.scrollLeft > 0 && delta < 0;
      const canScrollRight =
        track.scrollLeft + track.clientWidth < track.scrollWidth - 1 &&
        delta > 0;
      if (!canScrollLeft && !canScrollRight) return;
      event.preventDefault();
      track.scrollLeft += delta;
    }

    nav.addEventListener("wheel", handleWheel, { passive: false });
    return () => nav.removeEventListener("wheel", handleWheel);
  }, [unfinishedProjects.length]);

  const recentDeposits = useMemo(() => syncState.records.slice(0, 12), [syncState.records]);
  const trackingDocumentOptions = useMemo(() => {
    if (!selectedProject) return [];

    const expectedDocumentIds = dedupe(
      (selectedProject.companies || []).flatMap(
        (company) => company.expectedDocuments || []
      )
    );
    return resolveDocumentList(
      hydrateExpectedDocuments(expectedDocumentIds, selectedProjectCustomDocs)
    );
  }, [selectedProject, selectedProjectCustomDocs]);
  const filteredCompanyTracking = useMemo(() => {
    const searchNeedle = normalizeKey(trackingSearch);

    return companyTracking.filter((company) => {
      const searchableFields = [
        company.companyName,
        company.companyId,
        company.contactName,
        company.companyEmail,
        company.submissionId,
        company.missingSummary,
      ];
      const matchesSearch =
        !searchNeedle ||
        searchableFields.some((value) => normalizeKey(value).includes(searchNeedle));
      const matchesStatus =
        trackingStatusFilter === "all" || company.statusKey === trackingStatusFilter;
      const matchesMissing =
        !trackingOnlyMissing || company.receivedCount < company.expectedCount;

      if (trackingDocumentFilter === "all") {
        return matchesSearch && matchesStatus && matchesMissing;
      }

      const trackedDocument = company.documentState.find(
        (item) => item.document.id === trackingDocumentFilter
      );
      if (!trackedDocument) return false;

      const matchesDocumentState =
        trackingDocumentStateFilter === "all" ||
        (trackingDocumentStateFilter === "received" && Boolean(trackedDocument.latest)) ||
        (trackingDocumentStateFilter === "missing" && !trackedDocument.latest);

      return matchesSearch && matchesStatus && matchesMissing && matchesDocumentState;
    });
  }, [
    companyTracking,
    trackingDocumentFilter,
    trackingDocumentStateFilter,
    trackingOnlyMissing,
    trackingSearch,
    trackingStatusFilter,
  ]);
  const filteredTrackingSummary = useMemo(
    () => ({
      total: filteredCompanyTracking.length,
      complete: filteredCompanyTracking.filter((company) => company.statusKey === "complete")
        .length,
      progress: filteredCompanyTracking.filter((company) => company.statusKey === "progress")
        .length,
      todo: filteredCompanyTracking.filter((company) => company.statusKey === "todo").length,
    }),
    [filteredCompanyTracking]
  );
  const hasTrackingFilters =
    Boolean(trackingSearch.trim()) ||
    trackingStatusFilter !== "all" ||
    trackingDocumentFilter !== "all" ||
    trackingDocumentStateFilter !== "all" ||
    trackingOnlyMissing;

  useEffect(() => {
    if (trackingDocumentFilter === "all") return;
    if (trackingDocumentOptions.some((document) => document.id === trackingDocumentFilter)) {
      return;
    }
    setTrackingDocumentFilter("all");
  }, [trackingDocumentFilter, trackingDocumentOptions]);

  useEffect(() => {
    if (trackingDocumentFilter !== "all") return;
    if (trackingDocumentStateFilter === "all") return;
    setTrackingDocumentStateFilter("all");
  }, [trackingDocumentFilter, trackingDocumentStateFilter]);

  useEffect(() => {
    const validIds = new Set(
      (selectedProject?.companies || []).map((company) => company.id)
    );
    setSelectedCompanyIds((current) => {
      if (!current.size) return current;
      const next = new Set(
        Array.from(current).filter((companyId) => validIds.has(companyId))
      );
      return next.size === current.size ? current : next;
    });
  }, [selectedProject]);

  useEffect(() => {
    if (!companyModalOpen) return;
    function handleKey(event) {
      if (event.key === "Escape") setCompanyModalOpen(false);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [companyModalOpen]);

  useEffect(() => {
    if (!companyModalOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [companyModalOpen]);

  useEffect(() => {
    if (companyModalOpen) return;
    if (companySaveTimerRef.current) {
      clearTimeout(companySaveTimerRef.current);
      companySaveTimerRef.current = null;
    }
    setCompanySaveStatus({ phase: "idle", mode: "create" });
  }, [companyModalOpen]);

  useEffect(() => {
    return () => {
      if (companySaveTimerRef.current) {
        clearTimeout(companySaveTimerRef.current);
        companySaveTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!projectModalOpen) return;
    function handleKey(event) {
      if (event.key === "Escape") setProjectModalOpen(false);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [projectModalOpen]);

  useEffect(() => {
    if (!projectModalOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [projectModalOpen]);

  function handleProjectFieldChange(field, value) {
    setProjectForm((current) => ({ ...current, [field]: value }));
  }

  function handleCompanyFieldChange(field, value) {
    setCompanyForm((current) => ({ ...current, [field]: value }));
  }

  function handleCompanyDocumentToggle(documentId) {
    setCompanyForm((current) => {
      const next = new Set(current.expectedDocuments || []);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return { ...current, expectedDocuments: Array.from(next) };
    });
  }

  function handleCompanyDocumentsBulk(documentIds, shouldSelect) {
    const ids = Array.from(documentIds || []);
    if (!ids.length) return;
    setCompanyForm((current) => {
      const next = new Set(current.expectedDocuments || []);
      if (shouldSelect) {
        for (const id of ids) next.add(id);
      } else {
        for (const id of ids) next.delete(id);
      }
      return { ...current, expectedDocuments: Array.from(next) };
    });
  }

  // Append a new "piece specifique" to the current project's customDocuments
  // and auto-check it for the company being edited. The server normalizes the
  // label into a deterministic id and forces the "Pieces specifiques" category,
  // so resending the full list keeps existing custom pieces intact.
  async function handleAddCustomDocument() {
    const label = String(customDocInput || "").trim();
    if (!label || customDocSaving) return;
    if (!selectedProject) {
      setNotice({
        tone: "warning",
        title: "Projet requis",
        message: "Selectionnez un projet avant d'ajouter une piece specifique.",
      });
      return;
    }

    setCustomDocSaving(true);
    try {
      const existing = Array.isArray(selectedProject.customDocuments)
        ? selectedProject.customDocuments
        : [];
      const nextCustomDocs = [
        ...existing.map((doc) => ({
          label: String(doc?.label || "").trim(),
          category: doc?.category || CUSTOM_DOC_CATEGORY,
        })),
        { label, category: CUSTOM_DOC_CATEGORY },
      ];

      const saved = await api.saveProject({
        id: selectedProject.id,
        name: selectedProject.name || "",
        dossierId: selectedProject.dossierId || "",
        folderPath: selectedProject.folderPath || "",
        deadline: selectedProject.deadline || "",
        customDocuments: nextCustomDocs,
      });
      await refreshProjects();

      const newDoc = (saved.customDocuments || []).find(
        (doc) => String(doc?.label || "").trim().toLowerCase() === label.toLowerCase()
      );
      if (newDoc?.id) {
        setCompanyForm((current) => {
          const set = new Set(current.expectedDocuments || []);
          set.add(newDoc.id);
          return { ...current, expectedDocuments: Array.from(set) };
        });
      }
      setCustomDocInput("");
    } catch (err) {
      setNotice({ tone: "error", title: "Erreur", message: err.message });
    } finally {
      setCustomDocSaving(false);
    }
  }

  function handleSwitchProject(projectId) {
    const project = projects.find((entry) => entry.id === projectId);
    if (!project) return;

    setSelectedProjectId(project.id);
    setProjectForm(toProjectForm(project));
    setCompanyForm(createEmptyCompanyForm());
    setSelectedCompanyIds(new Set());
  }

  function handleSelectProject(projectId) {
    handleSwitchProject(projectId);
    setProjectModalOpen(true);
  }

  function handleNewProject() {
    setSelectedProjectId("");
    setProjectForm(createEmptyProjectForm(portalEnv.defaultFolderPath));
    setCompanyForm(createEmptyCompanyForm());
    setSelectedCompanyIds(new Set());
    setProjectModalOpen(true);
  }

  function toggleCompanySelection(companyId) {
    setSelectedCompanyIds((current) => {
      const next = new Set(current);
      if (next.has(companyId)) next.delete(companyId);
      else next.add(companyId);
      return next;
    });
  }

  function toggleSelectAllCompanies() {
    if (!selectedProject) return;
    const companies = selectedProject.companies || [];
    setSelectedCompanyIds((current) => {
      if (current.size === companies.length && companies.length > 0) {
        return new Set();
      }
      return new Set(companies.map((company) => company.id));
    });
  }

  async function handleSendInvitations() {
    if (!selectedProject) return;
    if (!secureLinkEnabled) {
      setNotice({
        tone: "warning",
        title: "Signature inactive",
        message: "Configurez PORTAL_LINK_SECRET avant l'envoi des invitations.",
      });
      return;
    }
    if (!signingState.flows.sendInvitationsEnabled) {
      setNotice({
        tone: "warning",
        title: "Flow absent",
        message:
          "Configurez POWER_AUTOMATE_SEND_INVITATIONS_URL cote serveur pour envoyer les invitations par email.",
      });
      return;
    }

    const companies = selectedProject.companies || [];
    const selected = Array.from(selectedCompanyIds);
    const hasSelection = selected.length > 0;
    const targets = hasSelection ? selected : companies.map((c) => c.id);

    if (!targets.length) {
      setNotice({
        tone: "warning",
        title: "Aucune entreprise",
        message: "Ajoutez au moins une entreprise avant l'envoi.",
      });
      return;
    }

    const scopeLabel = hasSelection
      ? `${targets.length} entreprise(s) selectionnee(s)`
      : `les ${targets.length} entreprises du projet`;
    if (
      !window.confirm(
        `Envoyer par email le lien securise a ${scopeLabel} du projet "${selectedProject.name}" ?`
      )
    ) {
      return;
    }

    setEmailSending("invitations");
    try {
      const result = await api.sendInvitationEmails(selectedProject.id, targets);
      setNotice({
        tone: "success",
        title: "Invitations envoyees",
        message: `${result.count || 0} email(s) transmis au flow Power Automate.`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        title: "Envoi impossible",
        message: error.message || "Impossible d'envoyer les invitations.",
      });
    } finally {
      setEmailSending(null);
    }
  }

  async function handleSendReminders() {
    if (!selectedProject) return;
    if (!secureLinkEnabled) {
      setNotice({
        tone: "warning",
        title: "Signature inactive",
        message: "Configurez PORTAL_LINK_SECRET avant l'envoi des relances.",
      });
      return;
    }
    if (!signingState.flows.sendRemindersEnabled) {
      setNotice({
        tone: "warning",
        title: "Flow absent",
        message:
          "Configurez POWER_AUTOMATE_SEND_REMINDERS_URL cote serveur pour envoyer les relances par email.",
      });
      return;
    }

    const selected = Array.from(selectedCompanyIds);
    const hasSelection = selected.length > 0;

    const scopeLabel = hasSelection
      ? `${selected.length} entreprise(s) selectionnee(s)`
      : "toutes les entreprises incompletes du projet";
    if (
      !window.confirm(
        `Envoyer une relance a ${scopeLabel} du projet "${selectedProject.name}" ?`
      )
    ) {
      return;
    }

    setEmailSending("reminders");
    try {
      const result = await api.sendReminderEmails(
        selectedProject.id,
        hasSelection ? selected : []
      );
      if (!result.count) {
        setNotice({
          tone: "success",
          title: "Aucune relance necessaire",
          message:
            result.message || "Toutes les entreprises ciblees ont deja depose leurs pieces.",
        });
      } else {
        setNotice({
          tone: "success",
          title: "Relances envoyees",
          message: `${result.count} relance(s) transmise(s) au flow Power Automate.`,
        });
      }
    } catch (error) {
      setNotice({
        tone: "error",
        title: "Envoi impossible",
        message: error.message || "Impossible d'envoyer les relances.",
      });
    } finally {
      setEmailSending(null);
    }
  }

  async function handleRetryDocumentSync(record) {
    if (!record?.localRecordId) return;
    try {
      await api.retryDocumentSync(record.localRecordId);
      setNotice({
        tone: "success",
        title: "Synchronisation relancee",
        message: `${record.fileName || "Document"} est remis dans la file worker.`,
      });
      setTrackingRefreshKey((current) => current + 1);
    } catch (error) {
      setNotice({
        tone: "error",
        title: "Relance impossible",
        message: error.message || "Impossible de relancer la synchronisation.",
      });
    }
  }

  async function handleProjectSubmit(event) {
    event.preventDefault();

    if (!projectForm.name.trim() || !projectForm.dossierId.trim() || !projectForm.folderPath.trim()) {
      setNotice({
        tone: "warning",
        title: "Projet incomplet",
        message: "Renseignez le nom, le dossier et le folderPath du projet.",
      });
      return;
    }

    const isUpdate = Boolean(projectForm.id);
    const projectId = projectForm.id || buildProjectId(projectForm);

    try {
      const saved = await api.saveProject({
        id: projectId,
        name: projectForm.name.trim(),
        dossierId: projectForm.dossierId.trim(),
        folderPath: projectForm.folderPath.trim(),
        deadline: projectForm.deadline ? projectForm.deadline.trim() : "",
        customDocuments: projectForm.customDocumentsText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      });
      await refreshProjects();
      await refreshOverview();
      setSelectedProjectId(saved.id);
      setProjectForm(toProjectForm(saved));
      setProjectModalOpen(true);
      setNotice({
        tone: "success",
        title: isUpdate ? "Projet mis a jour" : "Projet cree",
        message: `${saved.name} est disponible dans le tableau d'administration.`,
      });
    } catch (err) {
      setNotice({ tone: "error", title: "Erreur", message: err.message });
    }
  }

  async function handleDeleteProject(projectId) {
    const project = projects.find((entry) => entry.id === projectId);
    if (!project) return;
    const ok = confirmByTyping({
      title: `Suppression du projet "${project.name}"`,
      expectedText: project.name,
    });
    if (!ok) {
      setNotice({
        tone: "warning",
        title: "Suppression annulee",
        message: "La confirmation saisie ne correspond pas au nom du projet.",
      });
      return;
    }

    try {
      await api.deleteProject(projectId);
      await refreshProjects();
      await refreshOverview();
      setCompanyForm(createEmptyCompanyForm());
      setNotice({
        tone: "success",
        title: "Projet supprime",
        message: `${project.name} a ete retire du tableau.`,
      });
    } catch (err) {
      setNotice({ tone: "error", title: "Erreur", message: err.message });
    }
  }

  async function handleArchiveProject(projectId) {
    const project = projects.find((entry) => entry.id === projectId);
    if (!project) return;
    if (
      !window.confirm(
        `Archiver le projet "${project.name}" ? Il sera masque de l'interface mais conserve en base.`
      )
    ) {
      return;
    }
    try {
      await api.archiveProject(projectId);
      if (selectedProjectId === projectId) {
        setSelectedProjectId("");
        setProjectForm(createEmptyProjectForm(portalEnv.defaultFolderPath));
        setCompanyForm(createEmptyCompanyForm());
      }
      await refreshProjects();
      await refreshOverview();
      setNotice({
        tone: "success",
        title: "Projet archive",
        message: `${project.name} a ete archive et masque de l'interface.`,
      });
    } catch (err) {
      setNotice({ tone: "error", title: "Erreur", message: err.message });
    }
  }

  async function handleUnarchiveProject(projectId) {
    const project = projects.find((entry) => entry.id === projectId);
    if (!project) return;
    try {
      await api.unarchiveProject(projectId);
      await refreshProjects();
      await refreshOverview();
      setNotice({
        tone: "success",
        title: "Projet desarchive",
        message: `${project.name} est de nouveau visible dans l'interface.`,
      });
    } catch (err) {
      setNotice({ tone: "error", title: "Erreur", message: err.message });
    }
  }

  async function handleCompanySubmit(event) {
    event.preventDefault();

    if (!selectedProject) {
      setNotice({
        tone: "warning",
        title: "Projet requis",
        message: "Creez ou ouvrez un projet avant d'ajouter une entreprise.",
      });
      return;
    }

    if (
      !companyForm.companyName.trim() ||
      !companyForm.contactName.trim() ||
      !companyForm.companyEmail.trim() ||
      !companyForm.expectedDocuments.length
    ) {
      setNotice({
        tone: "warning",
        title: "Entreprise incomplete",
        message:
          "Renseignez l'entreprise, le contact, l'email et au moins une piece attendue.",
      });
      return;
    }

    const companyId = companyForm.companyId.trim() || buildCompanyId(companyForm);
    const nextCompany = {
      id: companyForm.id || `company-${slugify(companyId)}-${uniqueSuffix()}`,
      companyId,
      companyName: companyForm.companyName.trim(),
      contactName: companyForm.contactName.trim(),
      companyEmail: companyForm.companyEmail.trim(),
      submissionId:
        companyForm.submissionId.trim() || buildSubmissionId(selectedProject, companyForm),
      expectedDocuments: dedupe(companyForm.expectedDocuments),
    };

    const mode = companyForm.id ? "update" : "create";

    if (companySaveTimerRef.current) {
      clearTimeout(companySaveTimerRef.current);
      companySaveTimerRef.current = null;
    }
    setCompanySaveStatus({ phase: "saving", mode });

    try {
      await api.saveCompany(selectedProject.id, nextCompany);
      await refreshProjects();
      await refreshOverview();
      setNotice({
        tone: "success",
        title: mode === "update" ? "Entreprise mise à jour" : "Entreprise ajoutée",
        message: `${nextCompany.companyName} est rattachee au projet ${selectedProject.name}.`,
      });
      setCompanySaveStatus({ phase: "saved", mode });
      companySaveTimerRef.current = setTimeout(() => {
        companySaveTimerRef.current = null;
        setCompanyForm(createEmptyCompanyForm());
        setCompanyModalOpen(false);
      }, 1200);
    } catch (err) {
      setCompanySaveStatus({ phase: "idle", mode });
      setNotice({ tone: "error", title: "Erreur", message: err.message });
    }
  }

  function handleEditCompany(company) {
    setCompanyForm(toCompanyForm(company));
    setDirectorySearch("");
    setCompanyDocumentSearch("");
    setCustomDocInput("");
    setCompanyModalOpen(true);
  }

  function handleSelectFromDirectory(entry) {
    if (!entry || entry.alreadyAttached) return;
    const validDocIds = new Set(companyDocumentOptions.map((doc) => doc.id));
    const carriedDocs = (entry.expectedDocuments || []).filter((id) =>
      validDocIds.has(id)
    );
    setCompanyForm({
      id: "",
      companyName: entry.companyName,
      companyId: entry.companyId,
      contactName: entry.contactName,
      companyEmail: entry.companyEmail,
      submissionId: "",
      expectedDocuments: carriedDocs.length
        ? carriedDocs
        : [...DEFAULT_EXPECTED_DOCUMENTS],
    });
    setDirectorySearch("");
    setCompanyModalOpen(true);
  }

  function handleResetCompanyForm() {
    setCompanyForm(createEmptyCompanyForm());
    setDirectorySearch("");
    setCompanyDocumentSearch("");
    setCustomDocInput("");
    setCompanyModalOpen(true);
  }

  function handleOpenCompanyModal() {
    if (!companyForm.id) {
      setCompanyForm(createEmptyCompanyForm());
    }
    setDirectorySearch("");
    setCompanyDocumentSearch("");
    setCustomDocInput("");
    setCompanyModalOpen(true);
  }

  function handleCloseCompanyModal() {
    setDirectorySearch("");
    setCompanyDocumentSearch("");
    setCustomDocInput("");
    setCompanyModalOpen(false);
  }

  function handleOpenProjectModal() {
    setProjectModalOpen(true);
  }

  function handleCloseProjectModal() {
    setProjectModalOpen(false);
  }

  async function handleDeleteCompany(companyId) {
    if (!selectedProject) return;

    const company = (selectedProject.companies || []).find((entry) => entry.id === companyId);
    if (!company) return;
    const ok = confirmByTyping({
      title: `Suppression de l'entreprise "${company.companyName}"`,
      expectedText: company.companyName,
    });
    if (!ok) {
      setNotice({
        tone: "warning",
        title: "Suppression annulee",
        message: "La confirmation saisie ne correspond pas au nom de l'entreprise.",
      });
      return;
    }

    try {
      await api.deleteCompany(companyId);
      setSelectedCompanyIds((current) => {
        if (!current.has(companyId)) return current;
        const next = new Set(current);
        next.delete(companyId);
        return next;
      });
      await refreshProjects();
      await refreshOverview();
      setCompanyForm(createEmptyCompanyForm());
      setNotice({
        tone: "success",
        title: "Entreprise supprimee",
        message: `${company.companyName} a ete retiree du projet.`,
      });
    } catch (err) {
      setNotice({ tone: "error", title: "Erreur", message: err.message });
    }
  }

  async function handleGenerateLink(company) {
    if (!selectedProject) return;

    if (!secureLinkEnabled) {
      setNotice({
        tone: "warning",
        title: "Signature inactive",
        message:
          "Configurez PORTAL_LINK_SECRET cote serveur pour generer un lien securise.",
      });
      return;
    }

    try {
      const customById = new Map(
        (selectedProjectCustomDocs || [])
          .filter((doc) => doc && typeof doc === "object" && doc.id)
          .map((doc) => [doc.id, doc])
      );
      const invitationDocuments = dedupe(company.expectedDocuments).map(
        (documentId) => customById.get(documentId) || documentId
      );
      const result = await api.generateSignedInvitationLink({
        context: {
          companyId: company.companyId,
          companyName: company.companyName,
          companyEmail: company.companyEmail,
          contactName: company.contactName,
          submissionId: company.submissionId,
          contestName: selectedProject.name,
          dossierId: selectedProject.dossierId,
          folderPath: selectedProject.folderPath,
          deadline: selectedProject.deadline,
          supportEmail: portalEnv.supportEmail,
          supportPhone: portalEnv.supportPhone,
          websiteUrl: portalEnv.websiteUrl,
          documents: invitationDocuments,
        },
      });

      // Attempt auto-copy first; prompt with the URL if clipboard access is unavailable.
      try {
        await navigator.clipboard.writeText(result.url);
        setNotice({
          tone: "success",
          title: "Lien copie",
          message: `Le lien signe de ${company.companyName} a ete copie dans le presse-papiers.`,
        });
      } catch {
        window.prompt(
          `Copiez le lien signe de ${company.companyName}`,
          result.url
        );
        setNotice({
          tone: "success",
          title: "Lien genere",
          message: `Le lien signe de ${company.companyName} est pret.`,
        });
      }
    } catch (error) {
      setNotice({
        tone: "error",
        title: "Generation impossible",
        message: error.message || "Le lien securise n'a pas pu etre genere.",
      });
    }
  }

  function syncTone() {
    if (syncState.status === "error") return "error";
    if (!signingState.flows.documentsEnabled) return "warning";
    if (syncState.status === "loading") return "warning";
    return "success";
  }

  if (dbLoading) {
    return (
      <div className="admin-shell" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <p>Chargement depuis la base de donnees...</p>
      </div>
    );
  }

  return (
    <div className="admin-shell" ref={adminShellRef}>
      <header className="admin-header">
        <div className="admin-header__main">
          <span className="portal-brand">{portalEnv.brandName}</span>
          <h1 className="portal-title">Tableau d'administration concours</h1>
          <p className="admin-header__copy">
            Creez les projets, rattachez les entreprises invitees, definissez les
            pieces attendues et suivez la reception des depots.
          </p>
        </div>
        <div className="admin-header__status">
          <div className="summary-card">
            <span className="summary-card__label">Liens securises</span>
            <strong className="summary-card__value summary-card__value--small">
              {signingStatusLabel}
            </strong>
          </div>
          <div className="summary-card">
            <span className="summary-card__label">Stockage VPS</span>
            <strong className="summary-card__value summary-card__value--small">
              {signingState.flows.documentsEnabled
                ? "Source locale active"
                : "Indisponible"}
            </strong>
          </div>
        </div>
      </header>

      <section className="admin-summary-grid" aria-label="Vue d'ensemble administration">
        <article className="summary-card summary-card--projects summary-card--admin-kpi">
          <header className="summary-card__kpi-head">
            <span className="summary-card__label">Projets configures</span>
          </header>
          <div className="summary-card__kpi-metric" aria-label={`${projects.length} projets configures`}>
            <span className="summary-card__kpi-number">{projects.length}</span>
            <span className="summary-card__kpi-unit">projets</span>
          </div>
          <footer className="summary-card__kpi-foot">
            <button
              type="button"
              className="btn btn--secondary btn--sm summary-card__kpi-action"
              onClick={handleOpenProjectModal}
            >
              Gerer les projets
            </button>
          </footer>
        </article>
        <article className="summary-card summary-card--admin-kpi summary-card--kpi-active">
          <header className="summary-card__kpi-head">
            <span className="summary-card__label">Projet actif</span>
          </header>
          {selectedProject ? (
            <div className="summary-card__kpi-active-body">
              <p className="summary-card__kpi-title">{selectedProject.name}</p>
              <div className="summary-card__kpi-meta-row">
                <span className="summary-card__kpi-progress">
                  {selectedProjectReceived} / {selectedProjectExpected} pieces recues
                </span>
                <span
                  className={
                    selectedProjectIsComplete
                      ? "summary-card__status-chip summary-card__status-chip--ok"
                      : "summary-card__status-chip summary-card__status-chip--pending"
                  }
                >
                  {selectedProjectIsComplete ? "Dossier complet" : "En cours"}
                </span>
              </div>
            </div>
          ) : (
            <p className="summary-card__kpi-empty">Aucun projet selectionne. Ouvrez la gestion des projets pour en choisir un.</p>
          )}
        </article>
        <article className="summary-card summary-card--entreprises summary-card--admin-kpi">
          <header className="summary-card__kpi-head">
            <span className="summary-card__label">Entreprises rattachees</span>
          </header>
          <div className="summary-card__kpi-metric" aria-label={`${totalCompanies} entreprises au total`}>
            <span className="summary-card__kpi-number">{totalCompanies}</span>
            <span className="summary-card__kpi-unit">total</span>
          </div>
          <p
            className="summary-card__kpi-sub"
            title="Entreprises rattachees au projet actuellement ouvert"
          >
            {selectedProject != null ? (
              <>
                <strong className="summary-card__kpi-sub-num">{selectedProjectCompanyCount}</strong>
                {` sur le projet actif`}
              </>
            ) : (
              <span className="summary-card__kpi-sub-muted">Selectionnez un projet pour rattacher des entreprises</span>
            )}
          </p>
          <footer className="summary-card__kpi-foot">
            <button
              type="button"
              className="btn btn--secondary btn--sm summary-card__kpi-action"
              onClick={handleOpenCompanyModal}
              disabled={!selectedProject}
              title={
                selectedProject
                  ? "Ouvrir la fenetre d'ajout d'entreprise"
                  : "Creez ou ouvrez un projet avant d'ajouter une entreprise"
              }
            >
              Ajouter une entreprise
            </button>
          </footer>
        </article>
        <article className="summary-card summary-card--admin-kpi summary-card--kpi-docs">
          <header className="summary-card__kpi-head">
            <span className="summary-card__label">Pieces attendues</span>
          </header>
          <div className="summary-card__kpi-metric" aria-label={`${totalExpectedPieces} pieces attendues sur l'ensemble des projets`}>
            <span className="summary-card__kpi-number">{totalExpectedPieces}</span>
            <span className="summary-card__kpi-unit">pieces</span>
          </div>
          <p className="summary-card__kpi-hint">Somme des pieces attendues pour toutes les entreprises (tous projets).</p>
        </article>
      </section>

      {signingState.status === "disabled" ? (
        <StatusBanner tone="warning" title="Lien securise indisponible">
          <p>
            Configurez <code>PORTAL_LINK_SECRET</code> cote serveur pour signer les
            invitations generees depuis cette page.
          </p>
        </StatusBanner>
      ) : null}

      {notice ? (
        <StatusBanner tone={notice.tone} title={notice.title}>
          <p>{notice.message}</p>
        </StatusBanner>
      ) : null}

      {unfinishedProjects.length > 0 ? (
        <>
          <div
            ref={ribbonSentinelRef}
            className="admin-project-ribbon__sentinel"
            aria-hidden="true"
          />
          <nav
            ref={ribbonNavRef}
            className={[
              "admin-project-ribbon",
              ribbonStuck && "admin-project-ribbon--stuck",
              ribbonDockedTop && "admin-project-ribbon--page-top",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-label="Navigation entre les projets non termines"
          >
          <span className="admin-project-ribbon__label">
            Projets en cours
            <strong className="admin-project-ribbon__count">
              {unfinishedProjects.length}
            </strong>
          </span>
          <div className="admin-project-ribbon__track" ref={ribbonTrackRef}>
            {unfinishedProjects.map((project) => {
              const isActive = project.id === selectedProjectId;
              const companyCount = (project.companies || []).length;
              return (
                <button
                  type="button"
                  key={project.id}
                  className={
                    isActive
                      ? "admin-project-ribbon__item admin-project-ribbon__item--active"
                      : "admin-project-ribbon__item"
                  }
                  onClick={() => handleSwitchProject(project.id)}
                  title={`${project.name}${
                    project.dossierId ? ` - ${project.dossierId}` : ""
                  }`}
                >
                  <span className="admin-project-ribbon__name">
                    {project.name || project.dossierId || "Projet sans nom"}
                  </span>
                  <span className="admin-project-ribbon__meta">
                    {companyCount} entreprise{companyCount > 1 ? "s" : ""}
                    {project.dossierId ? ` - ${project.dossierId}` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
        </>
      ) : null}

      <main className="admin-layout admin-layout--single">

        <div className="admin-content">
          <section className="admin-panel admin-overview">
            <div className="admin-panel__header">
              <div>
                <p className="section-kicker">Vue d'ensemble</p>
                <h2 className="admin-panel__title">Tous les projets en un coup d'oeil</h2>
                <p className="admin-sidebar__hint">
                  {!overviewVisible
                    ? "Vue masquee. Cliquez sur Afficher pour la reouvrir."
                    : overviewState.status === "loading"
                    ? "Synchronisation en cours..."
                    : overviewState.status === "error"
                    ? overviewState.error || "Synchronisation impossible."
                    : !overviewState.synced && overviewState.status === "ready"
                    ? "Vue d'ensemble degradee : stockage local indisponible."
                    : overviewState.generatedAt
                    ? `Mise a jour : ${formatDateTime(overviewState.generatedAt)}`
                    : "Cliquez sur Actualiser pour charger l'etat des projets."}
                </p>
              </div>
              <div className="admin-inline-actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={refreshOverview}
                  disabled={
                    !overviewVisible || overviewState.status === "loading"
                  }
                >
                  {overviewState.status === "loading"
                    ? "Actualisation..."
                    : "Actualiser"}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setOverviewVisible((current) => !current)}
                  aria-expanded={overviewVisible}
                  aria-controls="admin-overview-body"
                >
                  {overviewVisible ? "Masquer" : "Afficher"}
                </button>
              </div>
            </div>

            {overviewVisible ? (
            <div id="admin-overview-body">
            <div className="admin-overview__summary">
              <div className="summary-card summary-card--minor">
                <span className="summary-card__label">Projets suivis</span>
                <strong className="summary-card__value summary-card__value--small">
                  {overviewItems.length}
                </strong>
              </div>
              <div className="summary-card summary-card--minor">
                <span className="summary-card__label">Complets</span>
                <strong className="summary-card__value summary-card__value--small">
                  {overviewSummary.complete}
                </strong>
              </div>
              <div className="summary-card summary-card--minor">
                <span className="summary-card__label">Presque complets</span>
                <strong className="summary-card__value summary-card__value--small">
                  {overviewSummary.almost}
                </strong>
              </div>
              <div className="summary-card summary-card--minor">
                <span className="summary-card__label">Urgents a rendre</span>
                <strong className="summary-card__value summary-card__value--small">
                  {overviewSummary.urgent}
                </strong>
              </div>
              <div className="summary-card summary-card--minor">
                <span className="summary-card__label">A relancer</span>
                <strong className="summary-card__value summary-card__value--small">
                  {overviewSummary.reminders}
                </strong>
              </div>
            </div>

            <div className="admin-overview__filters">
              {[
                { key: "all", label: `Tous (${overviewItems.length})` },
                { key: "complete", label: `Complets (${overviewSummary.complete})` },
                { key: "almost", label: `Presque (${overviewSummary.almost})` },
                { key: "urgent", label: `Urgents (${overviewSummary.urgent})` },
                { key: "reminders", label: `A relancer (${overviewSummary.reminders})` },
              ].map((option) => (
                <button
                  type="button"
                  key={option.key}
                  className={
                    overviewFilter === option.key
                      ? "admin-overview__chip admin-overview__chip--active"
                      : "admin-overview__chip"
                  }
                  onClick={() => setOverviewFilter(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {overviewState.status === "error" ? (
              <StatusBanner tone="error" title="Vue d'ensemble indisponible">
                <p>{overviewState.error}</p>
              </StatusBanner>
            ) : null}

            {!overviewItems.length ? (
              <div className="empty-state admin-empty">
                {overviewState.status === "loading"
                  ? "Chargement de l'etat des projets..."
                  : "Aucun projet a afficher."}
              </div>
            ) : !filteredOverviewItems.length ? (
              <div className="empty-state admin-empty">
                Aucun projet ne correspond a ce filtre.
              </div>
            ) : (
              <div className="admin-overview__grid">
                {filteredOverviewItems.map((item) => {
                  const urgency = overviewUrgencyMeta(
                    item.urgencyKey,
                    item.daysUntilDeadline
                  );
                  const statusLabel =
                    OVERVIEW_STATUS_LABELS[item.statusKey] || "Etat inconnu";
                  const isActive = item.id === selectedProjectId;
                  return (
                    <article
                      key={item.id}
                      className={
                        isActive
                          ? "admin-overview__card admin-overview__card--active"
                          : "admin-overview__card"
                      }
                    >
                      <header className="admin-overview__card-header">
                        <div>
                          <strong className="admin-overview__card-title">
                            {item.name || item.dossierId || "Projet sans nom"}
                          </strong>
                          <p className="admin-overview__card-meta">
                            {item.dossierId || "Sans dossier"} -{" "}
                            {item.companyCount} entreprise
                            {item.companyCount > 1 ? "s" : ""}
                          </p>
                        </div>
                        <span className={overviewStatusClassName(item.statusKey)}>
                          {statusLabel}
                        </span>
                      </header>
                      <div className="admin-overview__progress-meta">
                        <strong>
                          {item.receivedCount} / {item.expectedCount} pieces
                        </strong>
                        <span>{item.completionRate}%</span>
                      </div>
                      <div className="admin-track-progress">
                        <span style={{ width: `${item.completionRate}%` }} />
                      </div>
                      <div className="admin-overview__tags">
                        <span className={urgency.className}>{urgency.label}</span>
                        {item.needsReminder ? (
                          <span className="overview-urgency overview-urgency--remind">
                            {item.incompleteCompanies} entreprise
                            {item.incompleteCompanies > 1 ? "s" : ""} a relancer
                          </span>
                        ) : null}
                        {item.syncError ? (
                          <span
                            className="overview-urgency overview-urgency--error"
                            title={item.syncError}
                          >
                            Synchronisation echouee
                          </span>
                        ) : null}
                      </div>
                      <footer className="admin-overview__card-footer">
                        <span>
                          Dernier depot :{" "}
                          {item.lastReceptionAt
                            ? formatDateTime(item.lastReceptionAt)
                            : "Aucun"}
                        </span>
                        <button
                          type="button"
                          className="btn btn--ghost"
                          onClick={() => handleSwitchProject(item.id)}
                          disabled={isActive}
                        >
                          {isActive ? "Projet actif" : "Ouvrir"}
                        </button>
                      </footer>
                    </article>
                  );
                })}
              </div>
            )}
            </div>
            ) : null}
          </section>

          <section className="admin-panel">
            <div className="admin-panel__header">
              <div>
                <p className="section-kicker">Invitations</p>
                <h2 className="admin-panel__title">Entreprises du projet actif</h2>
                {selectedProject && (selectedProject.companies || []).length ? (
                  <p className="admin-sidebar__hint">
                    {selectedCompanyIds.size > 0
                      ? `${selectedCompanyIds.size} entreprise(s) selectionnee(s). Les envois ne cibleront que la selection.`
                      : "Aucune selection : les envois cibleront toutes les entreprises (relances = uniquement les dossiers incomplets)."}
                  </p>
                ) : null}
              </div>
              <div className="admin-inline-actions">
                <span className="admin-panel__meta">
                  {selectedProject ? selectedProject.name : "Aucun projet selectionne"}
                </span>
              </div>
            </div>

            {!selectedProject ? (
              <div className="empty-state admin-empty">
                Creez ou ouvrez un projet pour rattacher des entreprises.
              </div>
            ) : !(selectedProject.companies || []).length ? (
              <div className="empty-state admin-empty">
                Aucune entreprise rattachee a ce projet.
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: "2.5rem" }}>
                        <input
                          type="checkbox"
                          aria-label="Tout selectionner"
                          checked={
                            (selectedProject.companies || []).length > 0 &&
                            selectedCompanyIds.size ===
                              (selectedProject.companies || []).length
                          }
                          onChange={toggleSelectAllCompanies}
                        />
                      </th>
                      <th>Entreprise</th>
                      <th>Contact</th>
                      <th>Pieces attendues</th>
                      <th>Invitation</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedProject.companies.map((company) => (
                      <tr key={company.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Selectionner ${company.companyName}`}
                            checked={selectedCompanyIds.has(company.id)}
                            onChange={() => toggleCompanySelection(company.id)}
                          />
                        </td>
                        <td>
                          <strong>{company.companyName}</strong>
                          <span>{company.companyId}</span>
                        </td>
                        <td>
                          <strong>{company.contactName}</strong>
                          <span>{company.companyEmail}</span>
                        </td>
                        <td>
                          {resolveDocumentList(
                            hydrateExpectedDocuments(company.expectedDocuments, selectedProjectCustomDocs)
                          )
                            .map((document) => document.label)
                            .join(", ")}
                        </td>
                        <td>{company.submissionId}</td>
                        <td>
                          <div className="admin-inline-actions">
                            <button
                              type="button"
                              className="btn btn--ghost"
                              onClick={() => handleEditCompany(company)}
                            >
                              Editer
                            </button>
                            <button
                              type="button"
                              className={`btn ${secureLinkEnabled ? "btn--secondary" : "btn--disabled"}`}
                              onClick={() => handleGenerateLink(company)}
                              disabled={!secureLinkEnabled}
                            >
                              Lien
                            </button>
                            <button
                              type="button"
                              className="btn btn--danger-sm"
                              onClick={() => handleDeleteCompany(company.id)}
                            >
                              Supprimer
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="admin-panel">
            <div className="admin-panel__header">
              <div>
                <p className="section-kicker">Reception</p>
                <h2 className="admin-panel__title">Suivi visuel des pieces recues</h2>
              </div>
              <div className="admin-inline-actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={
                    !selectedProject ||
                    !(selectedProject.companies || []).length ||
                    emailSending !== null ||
                    !secureLinkEnabled ||
                    !signingState.flows.sendInvitationsEnabled
                  }
                  onClick={handleSendInvitations}
                  title={
                    !signingState.flows.sendInvitationsEnabled
                      ? "Configurez POWER_AUTOMATE_SEND_INVITATIONS_URL cote serveur."
                      : "Envoie un email avec le lien signe a chaque entreprise ciblee."
                  }
                >
                  {emailSending === "invitations"
                    ? "Envoi en cours..."
                    : "Envoyer invitations par mail"}
                </button>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={
                    !selectedProject ||
                    !(selectedProject.companies || []).length ||
                    emailSending !== null ||
                    !secureLinkEnabled ||
                    !signingState.flows.sendRemindersEnabled
                  }
                  onClick={handleSendReminders}
                  title={
                    !signingState.flows.sendRemindersEnabled
                      ? "Configurez POWER_AUTOMATE_SEND_REMINDERS_URL cote serveur."
                      : "Envoie une relance aux entreprises au dossier incomplet."
                  }
                >
                  {emailSending === "reminders"
                    ? "Envoi en cours..."
                    : "Envoyer relances"}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={
                    !selectedProject ||
                    syncState.status === "loading" ||
                    !signingState.flows.documentsEnabled
                  }
                  onClick={() => setTrackingRefreshKey((current) => current + 1)}
                  title={
                    !signingState.flows.documentsEnabled
                      ? "Stockage local indisponible."
                      : "Recharge l'etat local du projet actif."
                  }
                >
                  {syncState.status === "loading" ? "Actualisation..." : "Actualiser"}
                </button>
                <div className={`security-chip security-chip--${syncTone()}`}>
                  {syncState.status === "loading"
                    ? "Synchronisation..."
                    : syncState.status === "error"
                    ? "Erreur stockage local"
                    : signingState.flows.documentsEnabled
                    ? "Stockage local actif"
                    : "Stockage indisponible"}
                </div>
              </div>
            </div>

            {syncState.status === "error" ? (
              <StatusBanner tone="error" title="Erreur de synchronisation">
                <p>{syncState.error}</p>
              </StatusBanner>
            ) : null}

            {!selectedProject ? (
              <div className="empty-state admin-empty">
                Selectionnez un projet pour visualiser le suivi multi-entreprises.
              </div>
            ) : !companyTracking.length ? (
              <div className="empty-state admin-empty">
                Aucune entreprise configuree pour etablir le suivi de reception.
              </div>
            ) : (
              <>
                <div className="admin-tracking-toolbar">
                  <label className="field field--wide">
                    <span className="field__label">Recherche</span>
                    <input
                      type="search"
                      value={trackingSearch}
                      onChange={(event) => setTrackingSearch(event.target.value)}
                      placeholder="Entreprise, contact, email, piece manquante..."
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">Statut</span>
                    <select
                      value={trackingStatusFilter}
                      onChange={(event) => setTrackingStatusFilter(event.target.value)}
                    >
                      {TRACKING_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field__label">Piece</span>
                    <select
                      value={trackingDocumentFilter}
                      onChange={(event) => setTrackingDocumentFilter(event.target.value)}
                    >
                      <option value="all">Toutes les pieces</option>
                      {trackingDocumentOptions.map((document) => (
                        <option key={document.id} value={document.id}>
                          {document.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field__label">Etat piece</span>
                    <select
                      value={trackingDocumentStateFilter}
                      onChange={(event) => setTrackingDocumentStateFilter(event.target.value)}
                      disabled={trackingDocumentFilter === "all"}
                    >
                      <option value="all">Tous</option>
                      <option value="received">Recue</option>
                      <option value="missing">Manquante</option>
                    </select>
                  </label>
                </div>

                <div className="admin-tracking-actions">
                  <label className="admin-filter-toggle">
                    <input
                      type="checkbox"
                      checked={trackingOnlyMissing}
                      onChange={(event) => setTrackingOnlyMissing(event.target.checked)}
                    />
                    <span>Uniquement les entreprises incompletes</span>
                  </label>
                  <div className="tabs admin-view-switch">
                    <button
                      type="button"
                      className={trackingView === "cards" ? "tab tab--active" : "tab"}
                      onClick={() => setTrackingView("cards")}
                    >
                      Vue cartes
                    </button>
                    <button
                      type="button"
                      className={trackingView === "table" ? "tab tab--active" : "tab"}
                      onClick={() => setTrackingView("table")}
                    >
                      Vue tableau
                    </button>
                  </div>
                  {hasTrackingFilters ? (
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => {
                        setTrackingSearch("");
                        setTrackingStatusFilter("all");
                        setTrackingDocumentFilter("all");
                        setTrackingDocumentStateFilter("all");
                        setTrackingOnlyMissing(false);
                      }}
                    >
                      Reinitialiser filtres
                    </button>
                  ) : null}
                </div>

                <div className="admin-tracking-summary">
                  <div className="summary-card summary-card--minor">
                    <span className="summary-card__label">Entreprises visibles</span>
                    <strong className="summary-card__value summary-card__value--small">
                      {filteredTrackingSummary.total} / {companyTracking.length}
                    </strong>
                  </div>
                  <div className="summary-card summary-card--minor">
                    <span className="summary-card__label">Completes</span>
                    <strong className="summary-card__value summary-card__value--small">
                      {filteredTrackingSummary.complete}
                    </strong>
                  </div>
                  <div className="summary-card summary-card--minor">
                    <span className="summary-card__label">En cours</span>
                    <strong className="summary-card__value summary-card__value--small">
                      {filteredTrackingSummary.progress}
                    </strong>
                  </div>
                  <div className="summary-card summary-card--minor">
                    <span className="summary-card__label">A demarrer</span>
                    <strong className="summary-card__value summary-card__value--small">
                      {filteredTrackingSummary.todo}
                    </strong>
                  </div>
                </div>

                {!filteredCompanyTracking.length ? (
                  <div className="empty-state admin-empty">
                    Aucun resultat avec les filtres actifs.
                  </div>
                ) : trackingView === "cards" ? (
                  <div className="admin-tracking-grid">
                    {filteredCompanyTracking.map((company) => (
                      <article key={company.id} className="admin-track-card">
                        <div className="admin-track-card__header">
                          <div>
                            <strong>{company.companyName}</strong>
                            <p>{company.contactName || company.companyEmail}</p>
                          </div>
                          <span className={trackingStatusClassName(company.statusKey)}>
                            {company.status}
                          </span>
                        </div>
                        <div className="admin-track-card__progress-meta">
                          <strong>
                            {company.receivedCount} / {company.expectedCount} pieces
                          </strong>
                          <span>{company.completionRate}% recu</span>
                        </div>
                        <div className="admin-track-progress">
                          <span style={{ width: `${company.completionRate}%` }} />
                        </div>
                        <div className="admin-doc-pill-grid">
                          {company.documentState.map((item) => (
                            <span
                              key={`${company.id}-${item.document.id}`}
                              className={documentSyncClassName(item.latest)}
                              title={item.latest?.syncError || ""}
                            >
                              {item.document.label}
                              {documentSyncLabel(item.latest)}
                            </span>
                          ))}
                        </div>
                        <p className="admin-track-card__footer">
                          Dernier depot:{" "}
                          {company.lastReceptionAt
                            ? formatDateTime(company.lastReceptionAt)
                            : "Aucun depot"}
                        </p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Entreprise</th>
                          <th>Statut</th>
                          <th>Avancement</th>
                          <th>Pieces manquantes</th>
                          <th>Dernier depot</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCompanyTracking.map((company) => (
                          <tr key={company.id}>
                            <td>
                              <strong>{company.companyName}</strong>
                              <span>{company.contactName}</span>
                            </td>
                            <td>
                              <span className={trackingStatusClassName(company.statusKey)}>
                                {company.status}
                              </span>
                            </td>
                            <td>
                              {company.receivedCount} / {company.expectedCount} (
                              {company.completionRate}%)
                            </td>
                            <td>{company.missingSummary}</td>
                            <td>
                              {company.lastReceptionAt
                                ? formatDateTime(company.lastReceptionAt)
                                : "Aucun depot"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="admin-panel">
            <div className="admin-panel__header">
              <div>
                <p className="section-kicker">Historique</p>
                <h2 className="admin-panel__title">Derniers depots detectes</h2>
              </div>
              <span className="admin-panel__meta">
                {selectedProject?.dossierId || "Aucun dossier"}
              </span>
            </div>

            {!selectedProject ? (
              <div className="empty-state admin-empty">
                Ouvrez un projet pour consulter les depots recents.
              </div>
            ) : !recentDeposits.length ? (
              <div className="empty-state admin-empty">
                Aucun depot remonte pour le projet actif.
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Entreprise</th>
                      <th>Piece</th>
                      <th>Fichier</th>
                      <th>Sync</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentDeposits.map((record) => (
                      <tr key={record.key}>
                        <td>{record.modifiedAt ? formatDateTime(record.modifiedAt) : "n.c."}</td>
                        <td>{record.companyName || record.companyId || "Entreprise non identifiee"}</td>
                        <td>{record.documentType || "Type non reconnu"}</td>
                        <td>{record.fileName || record.filePath || "Fichier non nomme"}</td>
                        <td>
                          <span className={
                            record.syncStatus === "sync_failed"
                              ? "status-pill status-pill--danger"
                              : record.syncStatus === "synced"
                              ? "status-pill status-pill--success"
                              : "status-pill status-pill--warning"
                          }>
                            {record.syncStatus === "sync_failed"
                              ? "Erreur"
                              : record.syncStatus === "synced"
                              ? "Synchronise"
                              : "En attente"}
                          </span>
                        </td>
                        <td>
                          {record.syncStatus === "sync_failed" ? (
                            <button
                              type="button"
                              className="btn btn--ghost"
                              onClick={() => handleRetryDocumentSync(record)}
                            >
                              Relancer
                            </button>
                          ) : (
                            "n.c."
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>

      {projectModalOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) handleCloseProjectModal();
          }}
        >
          <div
            className="modal-panel modal-panel--company"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-modal-title"
          >
            <header className="modal-header">
              <div>
                <p className="section-kicker">Projet</p>
                <h2 className="modal-title" id="project-modal-title">
                  Configuration du projet
                </h2>
                <p className="admin-sidebar__hint">
                  Creez, mettez a jour et ouvrez vos projets.
                </p>
              </div>
              <div className="admin-inline-actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={handleNewProject}
                >
                  Nouveau projet
                </button>
                <button
                  type="button"
                  className="modal-close"
                  onClick={handleCloseProjectModal}
                  aria-label="Fermer"
                >
                  x
                </button>
              </div>
            </header>

            <div className="modal-body modal-body--padded">
              <form className="admin-form" onSubmit={handleProjectSubmit}>
                <div className="admin-form-grid">
                  <label className="field">
                    <span className="field__label">Nom du projet</span>
                    <input
                      type="text"
                      value={projectForm.name}
                      onChange={(event) =>
                        handleProjectFieldChange("name", event.target.value)
                      }
                      placeholder="Concours groupe scolaire"
                      required
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">Dossier / code projet</span>
                    <input
                      type="text"
                      value={projectForm.dossierId}
                      onChange={(event) =>
                        handleProjectFieldChange("dossierId", event.target.value)
                      }
                      placeholder="concours-groupe-scolaire"
                      required
                    />
                  </label>
                  <label className="field field--wide">
                    <span className="field__label">FolderPath SharePoint</span>
                    <input
                      type="text"
                      value={projectForm.folderPath}
                      onChange={(event) =>
                        handleProjectFieldChange("folderPath", event.target.value)
                      }
                      placeholder="/sites/DEPOTS/projet-groupe-scolaire"
                      required
                    />
                  </label>
                  <label className="field field--wide">
                    <span className="field__label">Date limite</span>
                    <input
                      type="datetime-local"
                      value={projectForm.deadline}
                      onChange={(event) =>
                        handleProjectFieldChange("deadline", event.target.value)
                      }
                    />
                  </label>
                  <label className="field field--wide">
                    <span className="field__label">Pieces specifiques (une par ligne)</span>
                    <textarea
                      rows={4}
                      value={projectForm.customDocumentsText}
                      onChange={(event) =>
                        handleProjectFieldChange("customDocumentsText", event.target.value)
                      }
                      placeholder={`Ex: Attestation URSSAF\nEx: Note methodologie (optionnelle)`}
                    />
                  </label>
                </div>
                <div className="admin-form__actions">
                  <button type="submit" className="btn btn--primary">
                    {projectForm.id ? "Mettre a jour le projet" : "Creer le projet"}
                  </button>
                </div>
              </form>

              <div className="admin-project-list">
                <label className="admin-filter-toggle">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(event) => setShowArchived(event.target.checked)}
                  />
                  <span>Afficher les projets archives</span>
                </label>
                {!projects.length ? (
                  <div className="empty-state admin-empty">Aucun projet configure.</div>
                ) : (
                  projects.map((project) => {
                    const isArchived = Boolean(project.archivedAt);
                    return (
                      <article
                        key={project.id}
                        className={[
                          "admin-project-card",
                          project.id === selectedProjectId
                            ? "admin-project-card--active"
                            : "",
                          isArchived ? "admin-project-card--archived" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <div>
                          <strong>{project.name}</strong>
                          <p>
                            {project.dossierId}
                            {isArchived ? " - Archive" : ""}
                          </p>
                        </div>
                        <div className="admin-inline-actions">
                          <button
                            type="button"
                            className="btn btn--ghost"
                            onClick={() => handleSelectProject(project.id)}
                            disabled={isArchived}
                            title={
                              isArchived
                                ? "Desarchivez le projet pour pouvoir l'ouvrir."
                                : undefined
                            }
                          >
                            Ouvrir
                          </button>
                          {isArchived ? (
                            <button
                              type="button"
                              className="btn btn--ghost"
                              onClick={() => handleUnarchiveProject(project.id)}
                            >
                              Desarchiver
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn--ghost"
                              onClick={() => handleArchiveProject(project.id)}
                            >
                              Archiver
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn--danger-sm"
                            onClick={() => handleDeleteProject(project.id)}
                          >
                            Supprimer
                          </button>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {companyModalOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) handleCloseCompanyModal();
          }}
        >
          <div
            className="modal-panel modal-panel--company"
            role="dialog"
            aria-modal="true"
            aria-labelledby="company-modal-title"
          >
            <header className="modal-header">
              <div>
                <p className="section-kicker">Entreprise</p>
                <h2 className="modal-title" id="company-modal-title">
                  {companyForm.id
                    ? "Modifier l'entreprise"
                    : "Ajouter une entreprise"}
                </h2>
                <p className="admin-sidebar__hint">
                  {selectedProject
                    ? `Projet actif : ${selectedProject.name}`
                    : "Aucun projet actif. Creez un projet avant ajout."}
                </p>
              </div>
              <div className="admin-inline-actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={handleResetCompanyForm}
                >
                  Nouvelle entreprise
                </button>
                <button
                  type="button"
                  className="modal-close"
                  onClick={handleCloseCompanyModal}
                  aria-label="Fermer"
                >
                  x
                </button>
              </div>
            </header>

            <div className="modal-body modal-body--padded">
              <form
                id="company-modal-form"
                className="admin-form admin-form--split"
                onSubmit={handleCompanySubmit}
              >
                <div className="admin-form__column">
                  {companyDirectory.length > 0 ? (
                    <div className="admin-directory">
                      <div className="admin-directory__header">
                        <span className="field__label">
                          Reutiliser une entreprise existante
                        </span>
                        <small className="admin-sidebar__hint">
                          {companyDirectory.length} entreprise(s) en base
                        </small>
                      </div>
                      <input
                        type="search"
                        className="admin-directory__search"
                        value={directorySearch}
                        onChange={(event) =>
                          setDirectorySearch(event.target.value)
                        }
                        placeholder="Rechercher : nom, contact, email, identifiant..."
                        aria-label="Rechercher une entreprise existante"
                      />
                      {directorySearch.trim() ? (
                        directorySearchResults.length === 0 ? (
                          <p className="admin-directory__empty">
                            Aucune entreprise correspondante.
                          </p>
                        ) : (
                          <ul className="admin-directory__list">
                            {directorySearchResults.slice(0, 12).map((entry) => (
                              <li key={entry.key}>
                                <button
                                  type="button"
                                  className={
                                    entry.alreadyAttached
                                      ? "admin-directory__item admin-directory__item--disabled"
                                      : "admin-directory__item"
                                  }
                                  onClick={() =>
                                    handleSelectFromDirectory(entry)
                                  }
                                  disabled={entry.alreadyAttached}
                                  title={
                                    entry.alreadyAttached
                                      ? "Deja rattachee a ce projet"
                                      : `Pre-remplir le formulaire avec ${entry.companyName}`
                                  }
                                >
                                  <span className="admin-directory__primary">
                                    {entry.companyName ||
                                      entry.companyEmail ||
                                      entry.companyId}
                                  </span>
                                  <span className="admin-directory__meta">
                                    {[
                                      entry.contactName ||
                                        entry.companyEmail ||
                                        "",
                                      entry.companyId,
                                      entry.lastProjectName
                                        ? `vu sur ${entry.lastProjectName}`
                                        : "",
                                      entry.alreadyAttached
                                        ? "Deja rattachee"
                                        : "",
                                    ]
                                      .filter(Boolean)
                                      .join(" - ")}
                                  </span>
                                </button>
                              </li>
                            ))}
                            {directorySearchResults.length > 12 ? (
                              <li className="admin-directory__more">
                                + {directorySearchResults.length - 12} autres
                                resultats. Affinez la recherche.
                              </li>
                            ) : null}
                          </ul>
                        )
                      ) : (
                        <p className="admin-sidebar__hint admin-directory__intro">
                          Tapez quelques lettres pour retrouver une entreprise
                          deja saisie sur un autre projet, puis cliquez pour
                          pre-remplir le formulaire.
                        </p>
                      )}
                    </div>
                  ) : null}

                  <div className="admin-form-grid">
                  <label className="field">
                    <span className="field__label">Entreprise</span>
                    <input
                      type="text"
                      value={companyForm.companyName}
                      onChange={(event) =>
                        handleCompanyFieldChange(
                          "companyName",
                          event.target.value
                        )
                      }
                      placeholder="Entreprise Martin"
                      required
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">Identifiant entreprise</span>
                    <input
                      type="text"
                      value={companyForm.companyId}
                      onChange={(event) =>
                        handleCompanyFieldChange(
                          "companyId",
                          event.target.value
                        )
                      }
                      placeholder="ENT-MARTIN"
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">Contact</span>
                    <input
                      type="text"
                      value={companyForm.contactName}
                      onChange={(event) =>
                        handleCompanyFieldChange(
                          "contactName",
                          event.target.value
                        )
                      }
                      placeholder="Marie Martin"
                      required
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">Email</span>
                    <input
                      type="email"
                      value={companyForm.companyEmail}
                      onChange={(event) =>
                        handleCompanyFieldChange(
                          "companyEmail",
                          event.target.value
                        )
                      }
                      placeholder="contact@entreprise.fr"
                      required
                    />
                  </label>
                  </div>
                </div>

                <div className="admin-documents">
                  <div className="admin-documents__head">
                    <span className="field__label">Pieces attendues</span>
                    <span className="admin-documents__count">
                      {companyForm.expectedDocuments.length}
                      {" / "}
                      {companyDocumentOptions.length}
                      {" selectionnees"}
                    </span>
                  </div>
                  <div className="admin-documents__toolbar">
                    <input
                      type="search"
                      className="admin-documents__search"
                      value={companyDocumentSearch}
                      onChange={(event) =>
                        setCompanyDocumentSearch(event.target.value)
                      }
                      placeholder="Rechercher une piece..."
                    />
                    <div className="admin-documents__bulk">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() =>
                          handleCompanyDocumentsBulk(
                            companyDocumentOptions.map((doc) => doc.id),
                            true
                          )
                        }
                      >
                        Tout cocher
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() =>
                          handleCompanyDocumentsBulk(
                            companyDocumentOptions.map((doc) => doc.id),
                            false
                          )
                        }
                      >
                        Tout decocher
                      </button>
                    </div>
                  </div>
                  <div className="admin-documents__list">
                    {companyDocumentGroups.length === 0 ? (
                      <p className="admin-documents__empty">
                        Aucune piece ne correspond a la recherche.
                      </p>
                    ) : (
                      companyDocumentGroups.map((group) => {
                        const groupIds = group.items.map((doc) => doc.id);
                        const selectedInGroup = groupIds.filter((id) =>
                          companyForm.expectedDocuments.includes(id)
                        ).length;
                        const allSelected =
                          groupIds.length > 0 &&
                          selectedInGroup === groupIds.length;
                        return (
                          <div
                            key={group.category}
                            className="admin-documents__group"
                          >
                            <div className="admin-documents__group-head">
                              <span className="admin-documents__group-title">
                                {group.category}
                              </span>
                              <div className="admin-documents__group-meta">
                                <span className="admin-documents__group-count">
                                  {selectedInGroup}/{groupIds.length}
                                </span>
                                <button
                                  type="button"
                                  className="admin-documents__group-toggle"
                                  onClick={() =>
                                    handleCompanyDocumentsBulk(
                                      groupIds,
                                      !allSelected
                                    )
                                  }
                                >
                                  {allSelected ? "Tout decocher" : "Tout cocher"}
                                </button>
                              </div>
                            </div>
                            <div className="admin-documents__group-items">
                              {group.items.map((document) => (
                                <label
                                  key={document.id}
                                  className="admin-doc-row"
                                >
                                  <input
                                    type="checkbox"
                                    checked={companyForm.expectedDocuments.includes(
                                      document.id
                                    )}
                                    onChange={() =>
                                      handleCompanyDocumentToggle(document.id)
                                    }
                                  />
                                  <span className="admin-doc-row__label">
                                    {document.label}
                                  </span>
                                </label>
                              ))}
                              {group.category === CUSTOM_DOC_CATEGORY ? (
                                <div className="admin-documents__group-add">
                                  <input
                                    type="text"
                                    className="admin-documents__group-add-input"
                                    value={customDocInput}
                                    onChange={(event) =>
                                      setCustomDocInput(event.target.value)
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        handleAddCustomDocument();
                                      }
                                    }}
                                    placeholder="Nouvelle piece specifique (libelle)"
                                    disabled={
                                      !selectedProject || customDocSaving
                                    }
                                    aria-label="Libelle de la piece specifique a ajouter"
                                  />
                                  <button
                                    type="button"
                                    className="btn btn--ghost btn--sm"
                                    onClick={handleAddCustomDocument}
                                    disabled={
                                      !selectedProject ||
                                      customDocSaving ||
                                      !customDocInput.trim()
                                    }
                                  >
                                    {customDocSaving ? "Ajout..." : "Ajouter"}
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </form>
            </div>

            <footer className="modal-footer">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={handleCloseCompanyModal}
              >
                Annuler
              </button>
              <button
                type="submit"
                form="company-modal-form"
                className={
                  companySaveStatus.phase === "saved"
                    ? "btn btn--success"
                    : "btn btn--primary"
                }
                disabled={companySaveStatus.phase !== "idle"}
              >
                {(() => {
                  const mode =
                    companySaveStatus.phase === "idle"
                      ? companyForm.id
                        ? "update"
                        : "create"
                      : companySaveStatus.mode;
                  if (companySaveStatus.phase === "saving") {
                    return mode === "update" ? "Mise a jour..." : "Ajout en cours...";
                  }
                  if (companySaveStatus.phase === "saved") {
                    return mode === "update"
                      ? "Entreprise mise a jour"
                      : "Entreprise ajoutée";
                  }
                  return mode === "update"
                    ? "Mettre a jour l'entreprise"
                    : "Ajouter l'entreprise";
                })()}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
