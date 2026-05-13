function cleanString(value) {
  return String(value || "").trim();
}

const DEFAULT_FLOW_TIMEOUT_MS = 120000;

function parsePositiveInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getFlowTimeoutMs(env = process.env) {
  return parsePositiveInt(env.PORTAL_FLOW_TIMEOUT_MS, DEFAULT_FLOW_TIMEOUT_MS);
}

function fileNameFromPath(filePath) {
  return String(filePath || "")
    .split("/")
    .filter(Boolean)
    .pop() || "";
}

function unwrapBody(value) {
  if (value && typeof value === "object" && value.body !== undefined) {
    return value.body;
  }

  return value;
}

function getFlowFailureMessage(data) {
  if (!data || typeof data !== "object") return "";
  return data.error || data.message || data.statusMessage || "";
}

function assertFlowSuccess(label, data) {
  if (!data || typeof data !== "object") return;
  if (data.success === false || data.ok === false) {
    throw new Error(`${label}: ${getFlowFailureMessage(data) || "flow rejected the request."}`);
  }
}

export function getFlowConfig(env = process.env) {
  return {
    getDocumentsUrl: cleanString(env.POWER_AUTOMATE_GET_DOCUMENTS_URL),
    downloadUrl: cleanString(env.POWER_AUTOMATE_DOWNLOAD_FILE_URL),
    uploadUrl: cleanString(env.POWER_AUTOMATE_UPLOAD_FILE_URL),
    updateUrl: cleanString(env.POWER_AUTOMATE_UPDATE_FILE_URL),
    deleteUrl: cleanString(env.POWER_AUTOMATE_DELETE_FILE_URL),
    sendInvitationsUrl: cleanString(
      env.POWER_AUTOMATE_SEND_INVITATIONS_URL
    ),
    sendRemindersUrl: cleanString(
      env.POWER_AUTOMATE_SEND_REMINDERS_URL
    ),
  };
}

export function getFlowStatus(env = process.env) {
  const config = getFlowConfig(env);

  return {
    documentsEnabled: true,
    getDocumentsFlowEnabled: Boolean(config.getDocumentsUrl),
    downloadEnabled: Boolean(config.downloadUrl),
    uploadEnabled: Boolean(config.uploadUrl),
    updateEnabled: Boolean(config.updateUrl),
    deleteEnabled: Boolean(config.deleteUrl),
    sendInvitationsEnabled: Boolean(config.sendInvitationsUrl),
    sendRemindersEnabled: Boolean(config.sendRemindersUrl),
  };
}

async function postJsonWithTimeout(label, url, payload) {
  const timeoutMs = getFlowTimeoutMs();

  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw new Error(`${label}: delai d'appel Power Automate depasse (${timeoutMs} ms).`);
    }
    throw error;
  }
}

export async function callFlow(label, url, payload) {
  if (!url) {
    throw new Error(`${label}: URL de flow manquante.`);
  }

  const response = await postJsonWithTimeout(label, url, payload);

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
      (data && typeof data === "object" && data.message) ||
      rawText ||
      `${response.status} ${response.statusText}`;
    throw new Error(`${label}: ${message}`);
  }

  assertFlowSuccess(label, data);

  return data;
}

export async function callDownloadFlow(url, payload = {}) {
  if (!url) {
    throw new Error("DOWNLOAD_FILE: URL de flow manquante.");
  }

  const response = await postJsonWithTimeout("DOWNLOAD_FILE", url, payload);

  const contentType = (response.headers.get("content-type") || "").toLowerCase();

  if (!response.ok) {
    const rawText = await response.text();
    let parsed = rawText;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsed = rawText || null;
    }
    const data = unwrapBody(parsed);
    const message =
      (data && typeof data === "object" && data.message) ||
      rawText ||
      `${response.status} ${response.statusText}`;
    throw new Error(`DOWNLOAD_FILE: ${message}`);
  }

  if (contentType.includes("application/json") || contentType.startsWith("text/")) {
    const rawText = await response.text();
    let parsed = rawText;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsed = rawText || null;
    }
    const data = unwrapBody(parsed);

    if (data && typeof data === "object") {
      assertFlowSuccess("DOWNLOAD_FILE", data);
      return data;
    }

    if (typeof data === "string" && data.trim()) {
      return {
        success: true,
        fileContent: data,
        filePath: payload.filePath || "",
        fileName: fileNameFromPath(payload.filePath),
      };
    }

    return data;
  }

  // Flow returned raw binary content: re-encode to base64 for the browser client.
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    success: true,
    fileContent: buffer.toString("base64"),
    filePath: payload.filePath || "",
    fileName: fileNameFromPath(payload.filePath),
  };
}
