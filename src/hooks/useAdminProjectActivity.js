import { useCallback, useEffect, useRef, useState } from "react";
import { fetchProjectActivity } from "../lib/adminApi.js";

export function useAdminProjectActivity({ projectId, refreshKey = 0 }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef(null);

  const reload = useCallback(async () => {
    if (!projectId) {
      setItems([]);
      setError("");
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError("");
    try {
      const data = await fetchProjectActivity(
        projectId,
        { limit: 80 },
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      if (controller.signal.aborted || err?.name === "AbortError") return;
      setItems([]);
      setError(err?.message || "Impossible de charger l'historique.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    reload();
    return () => abortRef.current?.abort();
  }, [reload, refreshKey]);

  return { items, loading, error, reload };
}
