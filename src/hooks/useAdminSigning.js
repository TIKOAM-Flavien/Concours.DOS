import { useEffect, useState } from "react";

import * as api from "../lib/adminApi.js";

export function useAdminSigning({ onError } = {}) {
  const [signingState, setSigningState] = useState({
    status: "loading",
    flows: {},
  });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    api
      .fetchSecurityStatus({ signal: controller.signal })
      .then((security) => {
        if (!active) return;
        setSigningState({
          status: security.signingEnabled ? "enabled" : "disabled",
          flows: security.flows || {},
        });
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        if (!active) return;
        setSigningState({ status: "disabled", flows: {} });
        onError?.(error);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [onError]);

  return {
    signingState,
    secureLinkEnabled: signingState.status === "enabled",
  };
}
