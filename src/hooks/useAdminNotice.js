import { useEffect, useState } from "react";

export function useAdminNotice({ autoDismissMs = 5000 } = {}) {
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!notice || !autoDismissMs) return undefined;
    const timer = window.setTimeout(() => setNotice(null), autoDismissMs);
    return () => window.clearTimeout(timer);
  }, [autoDismissMs, notice]);

  return { notice, setNotice };
}
