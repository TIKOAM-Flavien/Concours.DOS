import {
  buildAcceptAttribute,
  formatBytes,
  formatDateTime,
} from "../lib/files";
function displayFileName(record) {
  if (!record) return "";
  return record.fileName || record.filePath || "Fichier depose";
}

function syncStatusLabel(record) {
  const reviewStatus = String(record?.reviewStatus || "").trim();
  if (reviewStatus === "rejected") return "Piece refusee";
  if (reviewStatus === "accepted") return "Piece validee";
  if (reviewStatus === "pending" && record) return "En attente de validation";

  const status = String(record?.syncStatus || "").trim();
  if (status === "syncing") return "Synchronisation en cours";
  if (status === "synced") return "Synchronise";
  if (status === "sync_failed") return "Erreur de synchronisation";
  if (status === "deleted") return "Supprime";
  if (status === "superseded") return "Remplace";
  if (status === "sync_pending" || status === "local_received") {
    return "Recu localement";
  }
  return record ? "Document disponible" : "Depot attendu";
}

function flagClassName(record) {
  if (!record) return "doc-flag";
  const reviewStatus = String(record.reviewStatus || "pending").trim();
  if (reviewStatus === "rejected") return "doc-flag doc-flag--error";
  if (reviewStatus === "accepted") return "doc-flag doc-flag--done";
  if (reviewStatus === "pending") return "doc-flag doc-flag--pending";
  if (record.syncStatus === "sync_failed") return "doc-flag doc-flag--error";
  if (record.syncStatus === "syncing" || record.syncStatus === "sync_pending") {
    return "doc-flag doc-flag--pending";
  }
  return "doc-flag doc-flag--done";
}

function flagLabel(record) {
  if (!record) return "Attendu";
  const reviewStatus = String(record.reviewStatus || "pending").trim();
  if (reviewStatus === "rejected") return "Refusee";
  if (reviewStatus === "accepted") return "Validee";
  if (reviewStatus === "pending") return "En attente de validation";
  return "Recu";
}

export default function DocumentCard({
  document,
  record,
  rejectionNotice = null,
  busy,
  primaryDisabled,
  canDelete,
  canPreview,
  onFileSelected,
  onDelete,
  onPreview,
  index,
}) {
  const rejected = Boolean(rejectionNotice);
  const displayRecord = rejected ? null : record;
  const hasActiveDeposit = Boolean(displayRecord);
  const canReplace = hasActiveDeposit;
  const inputId = `piece-${document.id}`;

  return (
    <article
      className={`doc-card ${hasActiveDeposit ? "doc-card--done" : ""} ${rejected ? "doc-card--rejected" : ""} ${busy ? "doc-card--busy" : ""}`}
      style={{ "--card-accent": document.accent, "--delay": `${index * 24}ms` }}
    >
      <div className="doc-card__eyebrow">
        <span className={flagClassName(displayRecord)}>
          {rejected ? "A redeposer" : flagLabel(displayRecord)}
        </span>
        <span className="doc-card__category">{document.category || "Pieces"}</span>
      </div>

      <div className="doc-card__top">
        <div className="doc-card__info">
          <strong className="doc-card__label">{document.label}</strong>
          <span className="doc-card__summary">{document.summary}</span>
        </div>
      </div>

      {rejected ? (
        <p className="doc-card__rejection-notice">
          {rejectionNotice?.comment
            ? `Piece refusee : ${rejectionNotice.comment}`
            : "Piece refusee. Merci de deposer une nouvelle version."}
        </p>
      ) : null}

      <dl className="doc-card__details">
        <div>
          <dt>Formats</dt>
          <dd>{document.acceptedFormats.join(", ")}</dd>
        </div>
        {!rejected ? (
          <div>
            <dt>Statut</dt>
            <dd>{syncStatusLabel(displayRecord)}</dd>
          </div>
        ) : null}
        {displayRecord ? (
          <>
            <div className="doc-card__details--wide">
              <dt>Fichier</dt>
              <dd>{displayFileName(displayRecord)}</dd>
            </div>
            {displayRecord.modifiedAt ? (
              <div>
                <dt>Mis a jour</dt>
                <dd>{formatDateTime(displayRecord.modifiedAt)}</dd>
              </div>
            ) : null}
            {displayRecord.sizeBytes ? (
              <div>
                <dt>Taille</dt>
                <dd>{formatBytes(displayRecord.sizeBytes)}</dd>
              </div>
            ) : null}
            {displayRecord.syncError ? (
              <div className="doc-card__details--wide">
                <dt>Erreur</dt>
                <dd>{displayRecord.syncError}</dd>
              </div>
            ) : null}
          </>
        ) : null}
      </dl>

      <div className="doc-card__actions">
        <label
          className={`btn ${canReplace ? "btn--ghost" : "btn--primary"} ${primaryDisabled ? "btn--disabled" : ""}`}
          htmlFor={inputId}
          aria-busy={busy || undefined}
        >
          {busy ? (
            <>
              <span className="spinner spinner--sm" aria-hidden="true" />
              Traitement...
            </>
          ) : canReplace ? (
            "Remplacer"
          ) : rejected ? (
            "Re-deposer"
          ) : (
            "Deposer"
          )}
        </label>
        <input
          id={inputId}
          className="sr-only"
          type="file"
          accept={buildAcceptAttribute(document.acceptedFormats)}
          disabled={primaryDisabled || busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onFileSelected(document, file);
          }}
        />

        {canPreview ? (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => onPreview(document, record)}
            disabled={busy}
          >
            Visualiser
          </button>
        ) : null}

        {canDelete ? (
          <button
            type="button"
            className="btn btn--danger-sm"
            onClick={() => onDelete(document)}
            disabled={busy}
          >
            Supprimer
          </button>
        ) : null}
      </div>
    </article>
  );
}
