export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "n.c.";
  if (bytes === 0) return "0 o";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${bytes} o`;
}

export function formatDateTime(value) {
  if (!value) return "n.c.";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildAcceptAttribute(acceptedFormats) {
  return (acceptedFormats || [])
    .map((format) => {
      const sanitized = String(format || "")
        .trim()
        .replace(/^\./, "")
        .toLowerCase();
      return sanitized ? `.${sanitized}` : "";
    })
    .filter(Boolean)
    .join(",");
}

export function fileMatchesAcceptedFormats(fileName, acceptedFormats) {
  const formats = (acceptedFormats || [])
    .map((format) =>
      String(format || "")
        .trim()
        .replace(/^\./, "")
        .toLowerCase()
    )
    .filter(Boolean);

  if (!formats.length) return true;

  const extension = String(fileName || "")
    .trim()
    .split(".")
    .pop()
    .toLowerCase();

  return formats.includes(extension);
}

export function formatAcceptedFormats(acceptedFormats) {
  const formats = (acceptedFormats || [])
    .map((format) =>
      String(format || "")
        .trim()
        .replace(/^\./, "")
        .toUpperCase()
    )
    .filter(Boolean);

  return formats.length ? formats.join(", ") : "format autorise";
}

export function isPreviewableFileName(fileName) {
  const extension = String(fileName || "")
    .trim()
    .split(".")
    .pop()
    .toLowerCase();

  return ["pdf", "png", "jpg", "jpeg", "gif", "webp"].includes(extension);
}
