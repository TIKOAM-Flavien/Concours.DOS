import { useEffect, useRef } from "react";

// Subscribe to the admin SSE stream. The browser's EventSource auto-reconnects
// with backoff, so we just need to keep one open per AdminApp instance and
// surface events to the parent via callbacks.
//
// Callbacks are stored in a ref so the consumer can change them without
// tearing down the connection — useful because handlers usually depend on
// the current selectedProject id, which changes often.
export function useAdminLiveEvents({ enabled = true, onInvalidate } = {}) {
  const callbacksRef = useRef({ onInvalidate });
  callbacksRef.current.onInvalidate = onInvalidate;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;
    if (typeof window.EventSource !== "function") return undefined;

    // Same-origin: cookies are sent automatically; requireAdminAuth on the
    // server checks the session as for any other admin XHR.
    const source = new window.EventSource("/api/admin/events");

    function handleInvalidate(messageEvent) {
      let payload = null;
      try {
        payload = messageEvent.data ? JSON.parse(messageEvent.data) : null;
      } catch {
        return;
      }
      callbacksRef.current.onInvalidate?.(payload);
    }

    source.addEventListener("admin.invalidate", handleInvalidate);

    // Connection-level errors trigger native auto-reconnect. We log once so
    // diagnostics are visible in devtools without spamming on every retry.
    let warned = false;
    source.addEventListener("error", () => {
      if (warned) return;
      warned = true;
      console.warn("[live] SSE connection error, EventSource will retry");
    });
    source.addEventListener("open", () => {
      warned = false;
    });

    return () => {
      source.removeEventListener("admin.invalidate", handleInvalidate);
      source.close();
    };
  }, [enabled]);
}
