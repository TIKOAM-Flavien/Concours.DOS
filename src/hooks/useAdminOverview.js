import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildOverviewSummary,
  enrichOverviewItems,
  filterOverviewItems,
} from "../lib/adminOverviewLogic.js";
import * as api from "../lib/adminApi.js";

export function useAdminOverview() {
  const overviewRequestIdRef = useRef(0);
  const overviewAbortRef = useRef(null);
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

  const refreshOverview = useCallback(async () => {
    const requestId = overviewRequestIdRef.current + 1;
    overviewRequestIdRef.current = requestId;

    if (overviewAbortRef.current) {
      overviewAbortRef.current.abort();
    }
    const controller = new AbortController();
    overviewAbortRef.current = controller;

    setOverviewState((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const data = await api.fetchOverview({ signal: controller.signal });
      if (controller.signal.aborted || requestId !== overviewRequestIdRef.current) {
        return;
      }
      setOverviewState({
        status: "ready",
        projects: Array.isArray(data?.projects) ? data.projects : [],
        generatedAt: data?.generatedAt || "",
        synced: Boolean(data?.synced),
        error: "",
      });
    } catch (err) {
      if (err?.name === "AbortError" || requestId !== overviewRequestIdRef.current) {
        return;
      }
      console.error("Failed to load overview:", err);
      setOverviewState((current) => ({
        ...current,
        status: "error",
        error: err.message || "Impossible de charger la vue d'ensemble.",
      }));
    } finally {
      if (overviewAbortRef.current === controller) {
        overviewAbortRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      if (overviewAbortRef.current) {
        overviewAbortRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "admin.overviewVisible",
      overviewVisible ? "1" : "0"
    );
  }, [overviewVisible]);

  const overviewItems = useMemo(
    () => enrichOverviewItems(overviewState.projects),
    [overviewState.projects]
  );

  const overviewSummary = useMemo(
    () => buildOverviewSummary(overviewItems),
    [overviewItems]
  );

  const filteredOverviewItems = useMemo(
    () => filterOverviewItems(overviewItems, overviewFilter),
    [overviewItems, overviewFilter]
  );

  return {
    overviewState,
    overviewFilter,
    setOverviewFilter,
    overviewVisible,
    setOverviewVisible,
    refreshOverview,
    overviewItems,
    overviewSummary,
    filteredOverviewItems,
  };
}
