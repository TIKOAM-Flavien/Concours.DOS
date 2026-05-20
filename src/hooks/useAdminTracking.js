import { useEffect, useMemo, useRef, useState } from "react";

import { resolveDocumentList } from "../config/documentCatalog.js";
import { DOCUMENT_OPTIONS } from "../lib/adminConstants.js";
import { dedupe, hydrateExpectedDocuments } from "../lib/adminUtils.js";
import {
  buildCompanyTracking,
  buildFilteredTrackingSummary,
  filterCompanyTracking,
  hasActiveTrackingFilters,
} from "../lib/adminTrackingLogic.js";
import { normalizeDocumentRecords } from "../lib/documentRecords.js";

export function useAdminTracking({
  client,
  selectedProject,
  selectedProjectCustomDocs,
  documentsEnabled,
  onTrackingRefresh,
}) {
  const [syncState, setSyncState] = useState({
    status: "idle",
    records: [],
    error: "",
  });
  const [trackingSearch, setTrackingSearch] = useState("");
  const [trackingStatusFilter, setTrackingStatusFilter] = useState("all");
  const [trackingDocumentFilter, setTrackingDocumentFilter] = useState("all");
  const [trackingDocumentStateFilter, setTrackingDocumentStateFilter] = useState("all");
  const [trackingOnlyMissing, setTrackingOnlyMissing] = useState(false);
  const [trackingView, setTrackingView] = useState("cards");
  const [trackingRefreshKey, setTrackingRefreshKey] = useState(0);
  const [trackingManualBusy, setTrackingManualBusy] = useState(false);
  const trackingRefreshModeRef = useRef("initial");
  const onTrackingRefreshRef = useRef(onTrackingRefresh);

  useEffect(() => {
    onTrackingRefreshRef.current = onTrackingRefresh;
  }, [onTrackingRefresh]);

  const allTrackableDocuments = useMemo(
    () => resolveDocumentList(DOCUMENT_OPTIONS.map((document) => document.id)),
    []
  );

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function loadTracking() {
      if (!selectedProject || !documentsEnabled) {
        setTrackingManualBusy(false);
        setSyncState({ status: "idle", records: [], error: "" });
        return;
      }

      const refreshMode = trackingRefreshModeRef.current;
      trackingRefreshModeRef.current = "initial";
      setSyncState((current) => ({ ...current, status: "loading", error: "" }));

      try {
        const rows = await client.listDocuments(
          {
            projectId: selectedProject.id,
            dossierId: selectedProject.dossierId,
            companyId: "",
            companyName: "",
            submissionId: "",
          },
          { signal: controller.signal }
        );
        if (!active) return;

        setSyncState({
          status: "ready",
          records: normalizeDocumentRecords(rows, {
            documents: allTrackableDocuments,
            companyId: "",
            companyName: "",
            submissionId: "",
          }),
          error: "",
        });

        if (refreshMode === "manual") {
          await onTrackingRefreshRef.current?.();
        }
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (!active) return;
        setSyncState({
          status: "error",
          records: [],
          error: error.message || "Lecture du stockage local impossible.",
        });
      } finally {
        if (active && refreshMode === "manual") {
          setTrackingManualBusy(false);
        }
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
    documentsEnabled,
    selectedProject,
    trackingRefreshKey,
  ]);

  const companyTracking = useMemo(
    () =>
      buildCompanyTracking({
        selectedProject,
        selectedProjectCustomDocs,
        records: syncState.records,
      }),
    [selectedProject, selectedProjectCustomDocs, syncState.records]
  );

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

  const filteredCompanyTracking = useMemo(
    () =>
      filterCompanyTracking(companyTracking, {
        trackingSearch,
        trackingStatusFilter,
        trackingDocumentFilter,
        trackingDocumentStateFilter,
        trackingOnlyMissing,
      }),
    [
      companyTracking,
      trackingDocumentFilter,
      trackingDocumentStateFilter,
      trackingOnlyMissing,
      trackingSearch,
      trackingStatusFilter,
    ]
  );

  const filteredTrackingSummary = useMemo(
    () => buildFilteredTrackingSummary(filteredCompanyTracking),
    [filteredCompanyTracking]
  );

  const hasTrackingFilters = hasActiveTrackingFilters({
    trackingSearch,
    trackingStatusFilter,
    trackingDocumentFilter,
    trackingDocumentStateFilter,
    trackingOnlyMissing,
  });

  const recentDeposits = useMemo(() => syncState.records.slice(0, 12), [syncState.records]);

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

  function refreshTrackingManual() {
    trackingRefreshModeRef.current = "manual";
    setTrackingManualBusy(true);
    setTrackingRefreshKey((current) => current + 1);
  }

  function resetTrackingFilters() {
    setTrackingSearch("");
    setTrackingStatusFilter("all");
    setTrackingDocumentFilter("all");
    setTrackingDocumentStateFilter("all");
    setTrackingOnlyMissing(false);
  }

  return {
    syncState,
    companyTracking,
    filteredCompanyTracking,
    filteredTrackingSummary,
    trackingDocumentOptions,
    recentDeposits,
    trackingSearch,
    setTrackingSearch,
    trackingStatusFilter,
    setTrackingStatusFilter,
    trackingDocumentFilter,
    setTrackingDocumentFilter,
    trackingDocumentStateFilter,
    setTrackingDocumentStateFilter,
    trackingOnlyMissing,
    setTrackingOnlyMissing,
    trackingView,
    setTrackingView,
    trackingManualBusy,
    trackingRefreshKey,
    hasTrackingFilters,
    refreshTrackingManual,
    resetTrackingFilters,
  };
}
