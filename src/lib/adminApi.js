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
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch (err) {
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

export function fetchProjects({ includeArchived = false } = {}) {
  return request(`/projects${includeArchived ? "?includeArchived=1" : ""}`);
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

export function fetchSecurityStatus() {
  return request("/security");
}

export function fetchOverview() {
  return request("/overview");
}

export function generateSignedInvitationLink({ context, ttlMinutes } = {}) {
  return request("/invitations/sign", {
    method: "POST",
    body: JSON.stringify({ context, ttlMinutes }),
  });
}

export function sendInvitationEmails(projectId, companyIds) {
  return request(
    `/projects/${encodeURIComponent(projectId)}/send-invitations`,
    {
      method: "POST",
      body: JSON.stringify({ companyIds: Array.isArray(companyIds) ? companyIds : [] }),
    }
  );
}

export function sendReminderEmails(projectId, companyIds) {
  return request(
    `/projects/${encodeURIComponent(projectId)}/send-reminders`,
    {
      method: "POST",
      body: JSON.stringify({ companyIds: Array.isArray(companyIds) ? companyIds : [] }),
    }
  );
}

export function retryDocumentSync(recordId) {
  return request(`/document-records/${encodeURIComponent(recordId)}/retry`, {
    method: "POST",
  });
}
