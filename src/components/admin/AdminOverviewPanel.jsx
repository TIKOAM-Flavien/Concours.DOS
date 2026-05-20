import StatusBanner from "../StatusBanner.jsx";
import { OVERVIEW_STATUS_LABELS } from "../../lib/adminConstants.js";
import { overviewStatusClassName, overviewUrgencyMeta } from "../../lib/adminPresentation.js";
import { formatDateTime } from "../../lib/files.js";

export default function AdminOverviewPanel({
  overviewState,
  overviewVisible,
  overviewFilter,
  overviewItems,
  overviewSummary,
  filteredOverviewItems,
  selectedProjectId,
  onRefresh,
  onToggleVisible,
  onFilterChange,
  onSwitchProject,
}) {
  return (
    <section className="admin-panel admin-overview">
      <div className="admin-panel__header">
        <div>
          <p className="section-kicker">Vue d'ensemble</p>
          <h2 className="admin-panel__title">Tous les projets en un coup d'oeil</h2>
          <p className="admin-sidebar__hint">
            {!overviewVisible
              ? "Vue masquee. Cliquez sur Afficher pour la reouvrir."
              : overviewState.status === "loading"
              ? "Chargement en cours..."
              : overviewState.status === "error"
              ? overviewState.error || "Chargement impossible."
              : !overviewState.synced && overviewState.status === "ready"
              ? "Vue d'ensemble degradee : stockage local indisponible."
              : overviewState.generatedAt
              ? `Mise a jour : ${formatDateTime(overviewState.generatedAt)}`
              : "Cliquez sur Actualiser pour charger l'etat des projets."}
          </p>
        </div>
        <div className="admin-inline-actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onRefresh}
            disabled={!overviewVisible || overviewState.status === "loading"}
          >
            {overviewState.status === "loading" ? "Actualisation..." : "Actualiser"}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onToggleVisible}
            aria-expanded={overviewVisible}
            aria-controls="admin-overview-body"
          >
            {overviewVisible ? "Masquer" : "Afficher"}
          </button>
        </div>
      </div>

      {overviewVisible ? (
        <div id="admin-overview-body">
          <div className="admin-overview__summary">
            <div className="summary-card summary-card--minor">
              <span className="summary-card__label">Projets suivis</span>
              <strong className="summary-card__value summary-card__value--small">
                {overviewItems.length}
              </strong>
            </div>
            <div className="summary-card summary-card--minor">
              <span className="summary-card__label">Complets</span>
              <strong className="summary-card__value summary-card__value--small">
                {overviewSummary.complete}
              </strong>
            </div>
            <div className="summary-card summary-card--minor">
              <span className="summary-card__label">Presque complets</span>
              <strong className="summary-card__value summary-card__value--small">
                {overviewSummary.almost}
              </strong>
            </div>
            <div className="summary-card summary-card--minor">
              <span className="summary-card__label">Urgents a rendre</span>
              <strong className="summary-card__value summary-card__value--small">
                {overviewSummary.urgent}
              </strong>
            </div>
            <div className="summary-card summary-card--minor">
              <span className="summary-card__label">A relancer</span>
              <strong className="summary-card__value summary-card__value--small">
                {overviewSummary.reminders}
              </strong>
            </div>
          </div>

          <div className="admin-overview__filters">
            {[
              { key: "all", label: `Tous (${overviewItems.length})` },
              { key: "complete", label: `Complets (${overviewSummary.complete})` },
              { key: "almost", label: `Presque (${overviewSummary.almost})` },
              { key: "urgent", label: `Urgents (${overviewSummary.urgent})` },
              { key: "reminders", label: `A relancer (${overviewSummary.reminders})` },
            ].map((option) => (
              <button
                type="button"
                key={option.key}
                className={
                  overviewFilter === option.key
                    ? "admin-overview__chip admin-overview__chip--active"
                    : "admin-overview__chip"
                }
                onClick={() => onFilterChange(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>

          {overviewState.status === "error" ? (
            <StatusBanner tone="error" title="Vue d'ensemble indisponible">
              <p>{overviewState.error}</p>
            </StatusBanner>
          ) : null}

          {!overviewItems.length ? (
            <div className="empty-state admin-empty">
              {overviewState.status === "loading"
                ? "Chargement de l'etat des projets..."
                : "Aucun projet a afficher."}
            </div>
          ) : !filteredOverviewItems.length ? (
            <div className="empty-state admin-empty">Aucun projet ne correspond a ce filtre.</div>
          ) : (
            <div className="admin-overview__grid">
              {filteredOverviewItems.map((item) => {
                const urgency = overviewUrgencyMeta(item.urgencyKey, item.daysUntilDeadline);
                const statusLabel = OVERVIEW_STATUS_LABELS[item.statusKey] || "Etat inconnu";
                const isActive = item.id === selectedProjectId;
                return (
                  <article
                    key={item.id}
                    className={
                      isActive
                        ? "admin-overview__card admin-overview__card--active"
                        : "admin-overview__card"
                    }
                  >
                    <header className="admin-overview__card-header">
                      <div>
                        <strong className="admin-overview__card-title">
                          {item.name || item.dossierId || "Projet sans nom"}
                        </strong>
                        <p className="admin-overview__card-meta">
                          {item.dossierId || "Sans dossier"} - {item.companyCount} entreprise
                          {item.companyCount > 1 ? "s" : ""}
                        </p>
                      </div>
                      <span className={overviewStatusClassName(item.statusKey)}>{statusLabel}</span>
                    </header>
                    <div className="admin-overview__progress-meta">
                      <strong>
                        {item.receivedCount} / {item.expectedCount} pieces
                      </strong>
                      <span>{item.completionRate}%</span>
                    </div>
                    <div className="admin-track-progress">
                      <span style={{ width: `${item.completionRate}%` }} />
                    </div>
                    <div className="admin-overview__tags">
                      <span className={urgency.className}>{urgency.label}</span>
                      {item.needsReminder ? (
                        <span className="overview-urgency overview-urgency--remind">
                          {item.incompleteCompanies} entreprise
                          {item.incompleteCompanies > 1 ? "s" : ""} a relancer
                        </span>
                      ) : null}
                      {item.syncError ? (
                        <span
                          className="overview-urgency overview-urgency--error"
                          title={item.syncError}
                        >
                          Erreur depot
                        </span>
                      ) : null}
                    </div>
                    <footer className="admin-overview__card-footer">
                      <span>
                        Dernier depot :{" "}
                        {item.lastReceptionAt
                          ? formatDateTime(item.lastReceptionAt)
                          : "Aucun"}
                      </span>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => onSwitchProject(item.id)}
                        disabled={isActive}
                      >
                        {isActive ? "Projet actif" : "Ouvrir"}
                      </button>
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
