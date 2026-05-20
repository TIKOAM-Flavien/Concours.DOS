function unwrapBody(value) {
  if (value && typeof value === "object" && value.body !== undefined) {
    return value.body;
  }

  return value;
}

/** Firefox: "NetworkError when attempting to fetch resource." Chrome: "Failed to fetch" */
function isFetchNetworkFailure(err) {
  if (!err || typeof err !== "object") return false;
  const name = String(err.name || "");
  const msg = String(err.message || "");
  if (name === "AbortError" || name === "NetworkError" || name === "SecurityError") {
    return true;
  }
  return (
    name === "TypeError" &&
    (/networkerror|failed to fetch|load failed|fetch/i.test(msg) || msg.length === 0)
  );
}

function rethrowFetchNetworkFailure(label, err) {
  if (err?.name === "AbortError") throw err;
  if (!isFetchNetworkFailure(err)) throw err;
  throw new Error(
    `${label}: impossible de joindre le serveur (pas de reponse HTTP). En local, lancez \`npm run dev\` pour demarrer l'API (port 3001) et Vite, puis ouvrez l'app via l'URL affichee par Vite (le proxy /api). Verifiez aussi VPN / pare-feu et que vous n'ouvrez pas les fichiers build en file://.`
  );
}

function getFailureMessage(data) {
  if (!data || typeof data !== "object") return "";
  return data.error || data.message || data.statusMessage || "";
}

function assertSuccessPayload(label, data) {
  if (!data || typeof data !== "object") return;
  if (data.success === false || data.ok === false) {
    throw new Error(`${label}: ${getFailureMessage(data) || "operation refusee."}`);
  }
}

function base64ToBytes(base64, label) {
  const clean = String(base64).replace(/^data:.*?;base64,/, "").replace(/\s/g, "");
  let bin;
  try {
    bin = atob(clean);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${label}: reponse illisible (base64 invalide). ${message}`);
  }

  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function requestJson(label, path, payload, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      ...options,
    });
  } catch (err) {
    rethrowFetchNetworkFailure(label, err);
  }

  const rawText = await response.text();
  let parsed = rawText;

  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = rawText || null;
  }

  const data = unwrapBody(parsed);

  if (!response.ok) {
    const message =
      (data && typeof data === "object" && data.error) ||
      (data && typeof data === "object" && data.message) ||
      rawText ||
      `${response.status} ${response.statusText}`;
    throw new Error(`${label}: ${message}`);
  }

  assertSuccessPayload(label, data);

  return data;
}

async function requestMultipart(label, path, formData, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      method: "POST",
      body: formData,
      ...options,
    });
  } catch (err) {
    rethrowFetchNetworkFailure(label, err);
  }

  const rawText = await response.text();
  let parsed = rawText;

  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = rawText || null;
  }

  const data = unwrapBody(parsed);

  if (!response.ok) {
    const message =
      (data && typeof data === "object" && data.error) ||
      (data && typeof data === "object" && data.message) ||
      rawText ||
      `${response.status} ${response.statusText}`;
    throw new Error(`${label}: ${message}`);
  }

  assertSuccessPayload(label, data);

  return data;
}

function buildSignedLinkPayload(context) {
  const payload = {
    inv: context.link?.inv,
    sig: context.link?.sig,
    alg: context.link?.alg,
  };
  if (context.link?.source) {
    payload.source = context.link.source;
  }
  return payload;
}

function buildSignedLinkFormData(context) {
  const formData = new FormData();
  const signed = buildSignedLinkPayload(context);
  formData.append("inv", signed.inv || "");
  formData.append("sig", signed.sig || "");
  formData.append("alg", signed.alg || "HS256");
  if (signed.source) {
    formData.append("source", signed.source);
  }
  return formData;
}

export function createPowerAutomateClient() {
  return {
    async verifyInvitation(context, options) {
      return await requestJson(
        "VERIFY_INVITATION",
        "/api/portal/verify",
        buildSignedLinkPayload(context),
        options
      );
    },

    async downloadDocument({ context, record }, options) {
      const data = await requestJson(
        "DOWNLOAD_FILE",
        "/api/portal/download",
        {
          ...buildSignedLinkPayload(context),
          filePath: record.filePath,
          fileIdentifier: record.fileIdentifier || "",
        },
        options
      );

      if (data && typeof data === "object" && data.fileContent) {
        const name = data.fileName || record.fileName;
        const ext = String(name || "").split(".").pop().toLowerCase();
        const mimeMap = {
          pdf: "application/pdf",
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          webp: "image/webp",
          doc: "application/msword",
          docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          xls: "application/vnd.ms-excel",
          xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        };
        const mime = mimeMap[ext] || "application/octet-stream";
        const bytes = base64ToBytes(data.fileContent, "DOWNLOAD_FILE");
        const blob = new Blob([bytes], { type: mime });
        return { blobUrl: URL.createObjectURL(blob), fileName: name };
      }

      if (typeof data === "string" && data.length > 0) {
        const ext = String(record.fileName || "").split(".").pop().toLowerCase();
        const mime =
          { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" }[
            ext
          ] || "application/octet-stream";
        const bytes = base64ToBytes(data, "DOWNLOAD_FILE");
        const blob = new Blob([bytes], { type: mime });
        return { blobUrl: URL.createObjectURL(blob), fileName: record.fileName };
      }

      throw new Error("DOWNLOAD_FILE: reponse sans contenu exploitable.");
    },

    async listDocuments(context, options) {
      const isPortalRequest = Boolean(context.link?.inv);
      const path = isPortalRequest ? "/api/portal/documents" : "/api/admin/documents";
      const payload = isPortalRequest
        ? buildSignedLinkPayload(context)
        : {
            projectId: context.projectId || "",
            dossierId: context.dossierId,
            companyId: context.companyId || "",
            companyName: context.companyName || "",
            submissionId: context.submissionId || "",
          };

      const data = await requestJson("LIST_DOCUMENTS", path, payload, options);
      return Array.isArray(data) ? data : [];
    },

    async uploadDocument({ context, document, file }, options) {
      const formData = buildSignedLinkFormData(context);
      formData.append("documentId", document.id);
      formData.append("file", file, file.name);
      return await requestMultipart(
        "UPLOAD_FILE",
        "/api/portal/upload",
        formData,
        options
      );
    },

    async updateDocument({ context, document, file, record }, options) {
      const formData = buildSignedLinkFormData(context);
      formData.append("documentId", document.id);
      formData.append("fileIdentifier", record.fileIdentifier || "");
      formData.append("filePath", record.filePath || "");
      formData.append("file", file, file.name);
      return await requestMultipart(
        "UPDATE_FILE",
        "/api/portal/update",
        formData,
        options
      );
    },

    async deleteDocument({ context, document, record }, options) {
      return await requestJson(
        "DELETE_FILE",
        "/api/portal/delete",
        {
          ...buildSignedLinkPayload(context),
          documentId: document.id,
          fileIdentifier: record.fileIdentifier,
          filePath: record.filePath,
        },
        options
      );
    },
  };
}
