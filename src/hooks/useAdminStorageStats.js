import { useCallback, useEffect, useRef, useState } from "react";

import * as api from "../lib/adminApi.js";

const INITIAL_STATE = {
  status: "idle",
  storedBytes: 0,
  storedOnDiskBytes: 0,
  usedBytes: 0,
  quotaBytes: 0,
  totalBytes: 0,
  freeBytes: 0,
  filesOnPortalHost: false,
  error: "",
};

export function useAdminStorageStats({ pollIntervalMs = 60_000 } = {}) {
  const storageRequestIdRef = useRef(0);
  const storageAbortRef = useRef(null);
  const [storageStats, setStorageStats] = useState(INITIAL_STATE);

  const refreshStorageStats = useCallback(async () => {
    const requestId = storageRequestIdRef.current + 1;
    storageRequestIdRef.current = requestId;

    if (storageAbortRef.current) {
      storageAbortRef.current.abort();
    }
    const controller = new AbortController();
    storageAbortRef.current = controller;

    setStorageStats((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const data = await api.fetchStorageStats({ signal: controller.signal });
      if (controller.signal.aborted || requestId !== storageRequestIdRef.current) {
        return;
      }
      const storedBytes = Number(data?.storedBytes) || 0;
      const storedOnDiskBytes = Number(data?.storedOnDiskBytes) || 0;
      const quotaBytes = Number(data?.quotaBytes) || 0;
      const totalBytes = Number(data?.disk?.totalBytes) || 0;
      const freeBytes = Number(data?.disk?.freeBytes) || 0;
      const usedBytes =
        Number(data?.usedBytes) >= 0
          ? Number(data.usedBytes)
          : quotaBytes > 0
            ? Math.max(storedOnDiskBytes, storedBytes)
            : Math.max(0, totalBytes - freeBytes);

      setStorageStats({
        status: "ready",
        storedBytes,
        storedOnDiskBytes,
        usedBytes,
        quotaBytes,
        totalBytes,
        freeBytes,
        filesOnPortalHost: Boolean(data?.filesOnPortalHost),
        error: "",
      });
    } catch (error) {
      if (error?.name === "AbortError" || requestId !== storageRequestIdRef.current) {
        return;
      }
      setStorageStats({
        status: "error",
        storedBytes: 0,
        storedOnDiskBytes: 0,
        usedBytes: 0,
        quotaBytes: 0,
        totalBytes: 0,
        freeBytes: 0,
        filesOnPortalHost: false,
        error: error?.message || String(error),
      });
    } finally {
      if (storageAbortRef.current === controller) {
        storageAbortRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    refreshStorageStats();
    if (!pollIntervalMs) return undefined;
    const timer = window.setInterval(refreshStorageStats, pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [pollIntervalMs, refreshStorageStats]);

  useEffect(() => {
    return () => {
      if (storageAbortRef.current) {
        storageAbortRef.current.abort();
      }
    };
  }, []);

  return { storageStats, refreshStorageStats };
}
