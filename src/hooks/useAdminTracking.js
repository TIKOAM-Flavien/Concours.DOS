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

const TRACKING_POLL_MS = 30_000;

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
      const silentRefresh = refreshMode === "silent";

      if (!silentRefresh) {
        setSyncState((current) => ({ ...current, status: "loading", error: "" }));
      }

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

        if (refreshMode === "manual" || refreshMode === "silent") {
          await onTrackingRefreshRef.current?.();
        }
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (!active) return;
        if (silentRefresh) return;
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

  const trackingPollDelayMs =
    selectedProject && documentsEnabled ? TRACKING_POLL_MS : 0;
  const [trackingPollProgress, setTrackingPollProgress] = useState(0);

  useEffect(() => {
    if (!trackingPollDelayMs || typeof window === "undefined") {
      setTrackingPollProgress(0);
      return undefined;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setTrackingPollProgress(100);
      return undefined;
    }

    let cancelled = false;
    let rafId = 0;
    const cycleStart = Date.now();

    function frame() {
      if (cancelled) return;
      const elapsed = Date.now() - cycleStart;
      const ratio = Math.min(1, elapsed / trackingPollDelayMs);
      setTrackingPollProgress(Math.round(ratio * 100));
      if (ratio < 1) {
        rafId = window.requestAnimationFrame(frame);
      }
    }

    setTrackingPollProgress(0);
    rafId = window.requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
    };
  }, [trackingPollDelayMs, trackingRefreshKey]);

  useEffect(() => {
    if (!selectedProject || !documentsEnabled || !trackingPollDelayMs) return undefined;

    let cancelled = false;
    let timer = null;
    const startedAt = Date.now();
    const maxRunMs = 60 * 60 * 1000;

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
        schedule(trackingPollDelayMs);
        return;
      }
      trackingRefreshModeRef.current = "silent";
      setTrackingRefreshKey((current) => current + 1);
      schedule(trackingPollDelayMs);
    }

    function onVisibility() {
      if (cancelled) return;
      if (!isHidden()) {
        if (timer) window.clearTimeout(timer);
        tick();
      }
    }

    document.addEventListener("visibilitychange", onVisibility);
    schedule(trackingPollDelayMs);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [documentsEnabled, selectedProject, trackingPollDelayMs]);

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
    trackingPollProgress,
    trackingPollDelayMs,
    trackingRefreshKey,
    hasTrackingFilters,
    refreshTrackingManual,
    resetTrackingFilters,
  };
}
