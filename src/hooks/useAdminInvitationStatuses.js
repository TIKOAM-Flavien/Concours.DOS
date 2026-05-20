import { useCallback, useEffect, useRef, useState } from "react";

import * as api from "../lib/adminApi.js";

// Extracted from useAdminProjects.js so the per-project invitation polling has
// its own request-id + AbortController. The parent hook stays free of the
// concurrency bookkeeping that this side-channel needs.
export function useAdminInvitationStatuses(selectedProjectId) {
  const [invitationStatusByCompanyId, setInvitationStatusByCompanyId] = useState({});
  const requestIdRef = useRef(0);
  const abortRef = useRef(null);

  const refreshInvitationStatuses = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    if (!selectedProjectId) {
      setInvitationStatusByCompanyId({});
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const data = await api.fetchProjectInvitations(selectedProjectId, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      const map = {};
      for (const item of data.items || []) {
        if (item.companyId) map[item.companyId] = item;
      }
      setInvitationStatusByCompanyId(map);
    } catch (error) {
      if (error?.name === "AbortError" || requestId !== requestIdRef.current) return;
      console.warn("Failed to load invitation statuses:", error);
      setInvitationStatusByCompanyId({});
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [selectedProjectId]);

  useEffect(() => {
    refreshInvitationStatuses();
  }, [refreshInvitationStatuses]);

  return { invitationStatusByCompanyId, refreshInvitationStatuses };
}
