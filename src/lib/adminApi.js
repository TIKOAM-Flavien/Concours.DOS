const API_BASE = "/api/admin";

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

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;

  let res;
  try {
    res = await fetch(url, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    if (isFetchNetworkFailure(err)) {
      throw new Error(
        "Impossible de joindre le serveur (pas de reponse HTTP). En local, utilisez `npm run dev` (API port 3001 + Vite avec proxy /api), pas seulement `vite`."
      );
    }
    throw err;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data && typeof data === "object" && (data.success === false || data.ok === false)) {
    throw new Error(data.error || data.message || "Operation refusee.");
  }
  return data;
}

export function fetchAuthSession() {
  return request("/auth/session");
}

export function logoutAdminSession() {
  return request("/auth/logout", { method: "POST" });
}

export function fetchProjects({ includeArchived = false } = {}, options = {}) {
  return request(`/projects${includeArchived ? "?includeArchived=1" : ""}`, options);
}

export function archiveProject(id) {
  return request(`/projects/${encodeURIComponent(id)}/archive`, {
    method: "POST",
  });
}

export function unarchiveProject(id) {
  return request(`/projects/${encodeURIComponent(id)}/unarchive`, {
    method: "POST",
  });
}

export function fetchProject(id) {
  return request(`/projects/${encodeURIComponent(id)}`);
}

export function fetchProjectActivity(projectId, { limit = 80 } = {}, options = {}) {
  const params = new URLSearchParams();
  if (limit) params.set("limit", String(limit));
  const query = params.toString();
  return request(
    `/projects/${encodeURIComponent(projectId)}/activity${query ? `?${query}` : ""}`,
    options
  );
}

export function saveProject({ id, name, dossierId, folderPath, deadline, customDocuments }) {
  return request(`/projects/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ name, dossierId, folderPath, deadline, customDocuments }),
  });
}

export function deleteProject(id) {
  return request(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function saveCompany(projectId, company) {
  return request(
    `/projects/${encodeURIComponent(projectId)}/companies/${encodeURIComponent(company.id)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        companyName: company.companyName,
        companyId: company.companyId,
        contactName: company.contactName,
        companyEmail: company.companyEmail,
        submissionId: company.submissionId,
        expectedDocuments: company.expectedDocuments,
      }),
    }
  );
}

export function deleteCompany(companyId) {
  return request(`/companies/${encodeURIComponent(companyId)}`, { method: "DELETE" });
}

export function fetchSecurityStatus(options = {}) {
  return request("/security", options);
}

export function fetchOverview(options = {}) {
  return request("/overview", options);
}

export function generateSignedInvitationLink({ context, ttlMinutes } = {}) {
  return request("/invitations/sign", {
    method: "POST",
    body: JSON.stringify({ context, ttlMinutes }),
  });
}

export function fetchProjectInvitations(projectId, options = {}) {
  return request(`/projects/${encodeURIComponent(projectId)}/invitations`, options);
}

export function fetchStorageStats(options = {}) {
  return request("/storage/stats", options);
}

export function sendInvitationEmails(projectId, companyIds) {
  return request(
    `/projects/${encodeURIComponent(projectId)}/send-invitations`,
    {
      method: "POST",
      body: JSON.stringify({ companyIds }),
    }
  );
}

export function sendReminderEmails(projectId, companyIds) {
  return request(
    `/projects/${encodeURIComponent(projectId)}/send-reminders`,
    {
      method: "POST",
      body: JSON.stringify({ companyIds }),
    }
  );
}

export function revokeSignedInvitation(payload) {
  return request("/invitations/revoke", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function revokeAllProjectInvitations(projectId, { reason = "" } = {}) {
  return request(
    `/projects/${encodeURIComponent(projectId)}/invitations/revoke-all`,
    {
      method: "POST",
      body: JSON.stringify({ reason }),
    }
  );
}

export function revokeAllCompanyInvitations(projectId, companyId, { reason = "" } = {}) {
  return request(
    `/projects/${encodeURIComponent(projectId)}/companies/${encodeURIComponent(companyId)}/invitations/revoke-all`,
    {
      method: "POST",
      body: JSON.stringify({ reason }),
    }
  );
}

export function fetchRevokedInvitations(limit = 50) {
  return request(`/invitations/revoked?limit=${encodeURIComponent(limit)}`);
}

export function runMaintenanceCleanup() {
  return request("/maintenance/cleanup", { method: "POST" });
}

// Downloads stream the raw file body now; we surface metadata via response
// headers so the caller doesn't have to round-trip through JSON+base64.
export async function downloadAdminDocument(recordId) {
  const url = `${API_BASE}/documents/${encodeURIComponent(recordId)}/download`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      credentials: "include",
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    if (isFetchNetworkFailure(err)) {
      throw new Error(
        "Impossible de joindre le serveur (pas de reponse HTTP). En local, utilisez `npm run dev`."
      );
    }
    throw err;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const encodedName = res.headers.get("X-File-Name") || "";
  let fileName = "document";
  try {
    fileName = decodeURIComponent(encodedName) || fileName;
  } catch {
    fileName = encodedName || fileName;
  }
  return {
    success: true,
    blob,
    fileName,
    mimeType: res.headers.get("Content-Type") || blob.type || "application/octet-stream",
    reviewStatus: res.headers.get("X-Review-Status") || "pending",
  };
}

export function reviewAdminDocument(recordId, { reviewStatus, reviewComment = "" } = {}) {
  return request(`/documents/${encodeURIComponent(recordId)}/review`, {
    method: "PATCH",
    body: JSON.stringify({ reviewStatus, reviewComment }),
  });
}
