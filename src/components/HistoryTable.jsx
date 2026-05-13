import { formatBytes, formatDateTime } from "../lib/files";

export default function HistoryTable({
  records,
  context,
  coverage,
  searchValue,
  onSearchChange,
}) {
  return (
    <section className="history-panel">
      <div className="section-head">
        <div>
          <p className="eyebrow">SharePoint</p>
          <h2>Historique des fichiers deja presents</h2>
          <p className="section-copy">
            Cette vue permet de verifier les documents remontes par
            GET_DOCUMENTS pour l'entreprise courante.
          </p>
        </div>

        <div className="history-panel__tools">
          <input
            className="search-input"
            type="search"
            placeholder="Rechercher une piece, un nom ou un tag..."
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
      </div>

      <div className="history-panel__coverage">
        <span
          className={`coverage-pill ${
            coverage.hasDocumentType ? "coverage-pill--ok" : "coverage-pill--warn"
          }`}
        >
          {coverage.hasDocumentType
            ? "DocumentType visible"
            : "DocumentType absent"}
        </span>
        <span
          className={`coverage-pill ${
            coverage.hasCompanyScope || coverage.hasSubmissionScope
              ? "coverage-pill--ok"
              : "coverage-pill--warn"
          }`}
        >
          {coverage.hasCompanyScope || coverage.hasSubmissionScope
            ? "Scope entreprise visible"
            : "Scope entreprise absent"}
        </span>
      </div>

      {records.length ? (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Piece</th>
                <th>Fichier</th>
                <th>Entreprise</th>
                <th>Derniere modif</th>
                <th>Taille</th>
                <th>SharePoint</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.key}>
                  <td>{record.documentType || "Sans tag"}</td>
                  <td>{record.fileName || record.filePath || "Fichier sans nom"}</td>
                  <td>{record.companyName || context.companyName}</td>
                  <td>{formatDateTime(record.modifiedAt)}</td>
                  <td>{formatBytes(record.sizeBytes)}</td>
                  <td>
                    {record.link ? (
                      <a href={record.link} target="_blank" rel="noreferrer">
                        Ouvrir
                      </a>
                    ) : (
                      "n.c."
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          Aucun fichier SharePoint ne correspond encore a ce lien entreprise.
        </div>
      )}
    </section>
  );
}
