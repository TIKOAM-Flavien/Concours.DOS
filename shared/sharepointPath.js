// Shared SharePoint path normalizer.
//
// Used by the server (server/security.js) and the frontend (src/config/env.js)
// so that a folderPath baked into a signed invitation matches what the client
// displays and submits back.
//
// The canonical form:
//   - strips leading/trailing whitespace and any NUL characters,
//   - collapses a SharePoint document-library URL to its site-relative path
//     ("https://tenant.sharepoint.com/teams/X/Forms/..." → "/teams/X"),
//   - percent-decodes the path (so "/teams/Depots%20MOE" and "/teams/Depots MOE"
//     compare equal across client and server),
//   - drops trailing slashes.
//
// This module must stay pure ESM with no Node.js-only imports so it can be
// bundled by Vite for the browser.

function cleanString(value) {
  // Drop NUL and control characters that occasionally sneak in from Power
  // Automate responses or copy-pasted SharePoint URLs.
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .trim();
}

function safeDecodeUri(value) {
  const source = String(value || "");
  if (!source) return "";
  try {
    return decodeURIComponent(source);
  } catch {
    return source;
  }
}

export function normalizeSharePointFolderPath(value) {
  const raw = cleanString(value);
  if (!raw) return "";

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      let path = url.pathname || "";

      // SharePoint often emits "sharing" URLs whose path starts with:
      //   "/:x:/r/teams/..." or "/:f:/s/sites/..."
      // The "/:*/[rs]/" prefix is not part of the actual server-relative path.
      path = path.replace(/^\/:[a-z]:\/[rs]\//i, "/");

      const formsIndex = path.toLowerCase().indexOf("/forms/");
      if (formsIndex !== -1) path = path.slice(0, formsIndex);
      return safeDecodeUri(path).replace(/\/+$/g, "");
    } catch {
      return safeDecodeUri(raw).replace(/\/+$/g, "");
    }
  }

  return safeDecodeUri(raw).replace(/\/+$/g, "");
}
