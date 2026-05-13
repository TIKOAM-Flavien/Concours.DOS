import {
  buildAcceptAttribute,
  formatBytes,
  formatDateTime,
} from "../lib/files";

function displayFileName(record) {
  if (!record) return "";
  return record.fileName || record.filePath || "Fichier depose";
}

export default function DocumentCard({
  document,
  record,
  busy,
  primaryDisabled,
  canDelete,
  canPreview,
  onFileSelected,
  onDelete,
  onPreview,
  index,
}) {
  const inputId = `piece-${document.id}`;
  const done = Boolean(record);

  return (
    <article
      className={`doc-card ${done ? "doc-card--done" : ""} ${busy ? "doc-card--busy" : ""}`}
      style={{ "--card-accent": document.accent, "--delay": `${index * 24}ms` }}
    >
      <div className="doc-card__eyebrow">
        <span className={done ? "doc-flag doc-flag--done" : "doc-flag"}>
          {done ? "Recu" : "Attendu"}
        </span>
        <span className="doc-card__category">{document.category || "Pieces"}</span>
      </div>

      <div className="doc-card__top">
        <div className="doc-card__info">
          <strong className="doc-card__label">{document.label}</strong>
          <span className="doc-card__summary">{document.summary}</span>
        </div>
      </div>

      <dl className="doc-card__details">
        <div>
          <dt>Formats</dt>
          <dd>{document.acceptedFormats.join(", ")}</dd>
        </div>
        <div>
          <dt>Statut</dt>
          <dd>{done ? "Document disponible" : "Depot attendu"}</dd>
        </div>
        {done ? (
          <>
            <div className="doc-card__details--wide">
              <dt>Fichier</dt>
              <dd>{displayFileName(record)}</dd>
            </div>
            {record.modifiedAt ? (
              <div>
                <dt>Mis a jour</dt>
                <dd>{formatDateTime(record.modifiedAt)}</dd>
              </div>
            ) : null}
            {record.sizeBytes ? (
              <div>
                <dt>Taille</dt>
                <dd>{formatBytes(record.sizeBytes)}</dd>
              </div>
            ) : null}
          </>
        ) : null}
      </dl>

      <div className="doc-card__actions">
        <label
          className={`btn ${done ? "btn--ghost" : "btn--primary"} ${primaryDisabled ? "btn--disabled" : ""}`}
          htmlFor={inputId}
        >
          {busy ? "Traitement..." : done ? "Remplacer" : "Deposer"}
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
