import { cleanString, parseStrictPositiveInt as parsePositiveInt } from "./lib/coercions.js";

const DEFAULT_FLOW_TIMEOUT_MS = 120000;

function getFlowTimeoutMs(env = process.env) {
  return parsePositiveInt(env.PORTAL_FLOW_TIMEOUT_MS, DEFAULT_FLOW_TIMEOUT_MS);
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

/** Power Automate: emailing only (invitations + relances). Documents stay on local VPS storage. */
export function getFlowConfig(env = process.env) {
  return {
    sendInvitationsUrl: cleanString(env.POWER_AUTOMATE_SEND_INVITATIONS_URL),
    sendRemindersUrl: cleanString(env.POWER_AUTOMATE_SEND_REMINDERS_URL),
  };
}

export function getFlowStatus(env = process.env) {
  const config = getFlowConfig(env);

  return {
    documentsEnabled: true,
    localStorageOnly: true,
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
