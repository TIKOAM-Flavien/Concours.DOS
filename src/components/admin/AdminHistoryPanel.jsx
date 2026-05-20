import { activityKindLabel, activityToneClassName } from "../../lib/adminActivityPresentation.js";
import { formatBytes, formatDateTime } from "../../lib/files.js";

export default function AdminHistoryPanel({
  selectedProject,
  activityItems = [],
  activityLoading = false,
  activityError = "",
  onRefreshActivity,
}) {
  const count = activityItems.length;

  return (
    <section className="admin-panel">
      <div className="admin-panel__header">
        <div>
          <p className="section-kicker">Historique</p>
          <h2 className="admin-panel__title">Journal des actions</h2>
          <p className="admin-panel__subtitle">
            Depots, validations, invitations, relances et operations admin du projet.
          </p>
        </div>
        <div className="admin-panel__header-actions">
          <span className="admin-panel__meta">
            {selectedProject?.dossierId || "Aucun dossier"}
            {selectedProject ? ` · ${count} evenement${count > 1 ? "s" : ""}` : ""}
          </span>
          {selectedProject && onRefreshActivity ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={onRefreshActivity}
              disabled={activityLoading}
            >
              {activityLoading ? "Chargement…" : "Actualiser"}
            </button>
          ) : null}
        </div>
      </div>

      {!selectedProject ? (
        <div className="empty-state admin-empty">
          Ouvrez un projet pour consulter le journal complet.
        </div>
      ) : activityError ? (
        <div className="empty-state admin-empty admin-empty--error">{activityError}</div>
      ) : activityLoading && !count ? (
        <div className="empty-state admin-empty">Chargement du journal…</div>
      ) : !count ? (
        <div className="empty-state admin-empty">
          Aucune action enregistree pour ce projet.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table data-table--activity">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Evenement</th>
                <th>Entreprise</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {activityItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.at ? formatDateTime(item.at) : "n.c."}</td>
                  <td>
                    <span className="activity-kind">{activityKindLabel(item.kind)}</span>
                  </td>
                  <td>
                    <span className={activityToneClassName(item.tone)}>{item.label}</span>
                  </td>
                  <td>{item.companyName || "—"}</td>
                  <td className="activity-detail">
                    {item.documentType ? (
                      <span className="activity-detail__piece">{item.documentType}</span>
                    ) : null}
                    {item.fileName ? (
                      <span>
                        {item.fileName}
                        {item.sizeBytes ? (
                          <span className="muted-inline"> ({formatBytes(item.sizeBytes)})</span>
                        ) : null}
                      </span>
                    ) : null}
                    {item.detail && item.detail !== item.fileName ? (
                      <span
                        className={
                          item.documentType || item.fileName ? "muted-inline" : ""
                        }
                      >
                        {item.detail}
                      </span>
                    ) : null}
                    {!item.documentType && !item.fileName && !item.detail ? "—" : null}
                    {item.actor ? (
                      <span className="muted-inline activity-detail__actor">
                        {item.actor === "admin" ? " · admin" : ` · ${item.actor}`}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
