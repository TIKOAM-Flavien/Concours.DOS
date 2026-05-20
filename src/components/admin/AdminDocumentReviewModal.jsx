import { useEffect, useState } from "react";

import { documentReviewLabel } from "../../../shared/documentReview.js";
import { formatDateTime } from "../../lib/files.js";

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

export default function AdminDocumentReviewModal({
  open,
  companyName,
  documentLabel,
  fileName,
  reviewStatus,
  reviewComment,
  reviewedAt,
  reviewedBy,
  blobUrl,
  loading,
  error,
  saving,
  onClose,
  onAccept,
  onReject,
}) {
  const [rejectComment, setRejectComment] = useState("");
  const [showRejectComment, setShowRejectComment] = useState(false);

  useEffect(() => {
    if (!open) {
      setRejectComment("");
      setShowRejectComment(false);
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape" && !saving) onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, saving]);

  if (!open) return null;

  const mime = mimeFromName(fileName);
  const isImage = mime.startsWith("image/");
  const isPdf = mime === "application/pdf";
  const currentReviewLabel = documentReviewLabel(reviewStatus || "pending");

  async function handleRejectClick() {
    if (!showRejectComment) {
      setShowRejectComment(true);
      return;
    }
    await onReject(rejectComment.trim());
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={saving ? undefined : onClose}>
      <div
        className="modal-panel modal-panel--document-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-review-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header modal-header--document-review">
          <div className="admin-document-review__header-bar">
            <div className="admin-document-review__header-col">
              <div className="admin-document-review__header-line">
                <span className="admin-document-review__header-kicker">Validation</span>
                <h2 className="modal-title" id="document-review-title">
                  {documentLabel || "Piece"}
                </h2>
              </div>
              <p className="admin-document-review__header-meta">
                {companyName}
                {fileName ? ` · ${fileName}` : ""}
                {reviewedAt ? (
                  <>
                    {" · "}
                    <span className="admin-document-review__reviewed-at">
                      {reviewedBy ? `${reviewedBy} · ` : ""}
                      {formatDateTime(reviewedAt)}
                    </span>
                  </>
                ) : null}
              </p>
            </div>
          </div>
          <div className="admin-document-review__header-actions">
            <span className="status-pill status-pill--info">{currentReviewLabel}</span>
            <button
              type="button"
              className="modal-close modal-close--compact"
              onClick={onClose}
              disabled={saving}
              aria-label="Fermer"
            >
              &times;
            </button>
          </div>
        </div>

        <div
          className={`modal-body modal-body--padded admin-document-review__body${
            showRejectComment ? " admin-document-review__body--split" : ""
          }`}
        >
          {reviewComment && !showRejectComment ? (
            <StatusNote
              title={
                reviewStatus === "rejected" ? "Motif du refus" : "Commentaire de validation"
              }
            >
              {reviewComment}
            </StatusNote>
          ) : null}

          <div className="admin-document-review__preview-wrap">
            <div className="admin-document-review__preview">
            {loading ? (
              <div className="modal-placeholder">Chargement du fichier...</div>
            ) : error ? (
              <div className="modal-placeholder modal-placeholder--error">{error}</div>
            ) : isImage && blobUrl ? (
              <img className="modal-image" src={blobUrl} alt={fileName} />
            ) : isPdf && blobUrl ? (
              <iframe className="modal-iframe" title={fileName || "Apercu PDF"} src={blobUrl} />
            ) : (
              <div className="modal-placeholder">
                Apercu indisponible pour ce format.
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

          {showRejectComment ? (
            <label className="field admin-document-review__reject-field">
              <span className="field__label">Motif du refus (optionnel)</span>
              <textarea
                rows={4}
                value={rejectComment}
                onChange={(event) => setRejectComment(event.target.value)}
                placeholder="Precisez ce qui doit etre corrige..."
                disabled={saving}
              />
            </label>
          ) : null}
        </div>

        <footer className="modal-footer admin-document-review__footer">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={saving}>
            Fermer
          </button>
          <button
            type="button"
            className="btn btn--danger-sm"
            onClick={handleRejectClick}
            disabled={saving || loading || Boolean(error && !blobUrl)}
          >
            {showRejectComment ? (saving ? "Refus..." : "Confirmer le refus") : "Refuser"}
          </button>
          {!showRejectComment ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onAccept("")}
              disabled={saving || loading || Boolean(error && !blobUrl)}
            >
              {saving ? "Validation..." : "Accepter"}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

function StatusNote({ title, children }) {
  return (
    <div className="admin-document-review__note">
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}
