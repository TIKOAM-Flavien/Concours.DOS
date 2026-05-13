import { useEffect } from "react";

function mimeFromName(fileName) {
  const ext = String(fileName || "").split(".").pop().toLowerCase();
  const map = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  };
  return map[ext] || "application/octet-stream";
}

export default function FilePreviewModal({
  fileName,
  blobUrl,
  loading,
  error,
  onClose,
}) {
  const mime = mimeFromName(fileName);
  const isImage = mime.startsWith("image/");
  const isPdf = mime === "application/pdf";

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title" id="preview-modal-title">
            {fileName || "Apercu"}
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Fermer"
          >
            &times;
          </button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="modal-placeholder">Chargement...</div>
          ) : error ? (
            <div className="modal-placeholder modal-placeholder--error">
              {error}
            </div>
          ) : isImage && blobUrl ? (
            <img className="modal-image" src={blobUrl} alt={fileName} />
          ) : isPdf && blobUrl ? (
            <iframe className="modal-iframe" title={fileName || "Apercu PDF"} src={blobUrl} />
          ) : (
            <div className="modal-placeholder">
              Apercu securise indisponible pour ce format.
              {blobUrl ? (
                <p style={{ marginTop: 12 }}>
                  <a href={blobUrl} target="_blank" rel="noreferrer">
                    Ouvrir le fichier
                  </a>
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
