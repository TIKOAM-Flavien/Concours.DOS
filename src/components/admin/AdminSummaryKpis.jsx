import { formatBytes } from "../../lib/files.js";

export default function AdminSummaryKpis({
  projects,
  selectedProject,
  selectedProjectReceived,
  selectedProjectExpected,
  selectedProjectIsComplete,
  selectedProjectCompanyCount,
  totalCompanies,
  totalExpectedPieces,
  storageStats,
  onOpenProjectModal,
  onOpenCompanyModal,
}) {
  return (
    <section className="admin-summary-grid" aria-label="Vue d'ensemble administration">
      <article className="summary-card summary-card--projects summary-card--admin-kpi">
        <header className="summary-card__kpi-head">
          <span className="summary-card__label">Projets configures</span>
        </header>
        <div className="summary-card__kpi-metric" aria-label={`${projects.length} projets configures`}>
          <span className="summary-card__kpi-number">{projects.length}</span>
          <span className="summary-card__kpi-unit">projets</span>
        </div>
        <footer className="summary-card__kpi-foot">
          <button
            type="button"
            className="btn btn--secondary btn--sm summary-card__kpi-action"
            onClick={onOpenProjectModal}
          >
            Gerer les projets
          </button>
        </footer>
      </article>
      <article className="summary-card summary-card--admin-kpi summary-card--kpi-active">
        <header className="summary-card__kpi-head">
          <span className="summary-card__label">Projet actif</span>
        </header>
        {selectedProject ? (
          <div className="summary-card__kpi-active-body">
            <p className="summary-card__kpi-title">{selectedProject.name}</p>
            <div className="summary-card__kpi-meta-row">
              <span className="summary-card__kpi-progress">
                {selectedProjectReceived} / {selectedProjectExpected} pieces recues
              </span>
              <span
                className={
                  selectedProjectIsComplete
                    ? "summary-card__status-chip summary-card__status-chip--ok"
                    : "summary-card__status-chip summary-card__status-chip--pending"
                }
              >
                {selectedProjectIsComplete ? "Dossier complet" : "En cours"}
              </span>
            </div>
          </div>
        ) : (
          <p className="summary-card__kpi-empty">
            Aucun projet selectionne. Ouvrez la gestion des projets pour en choisir un.
          </p>
        )}
      </article>
      <article className="summary-card summary-card--entreprises summary-card--admin-kpi">
        <header className="summary-card__kpi-head">
          <span className="summary-card__label">Entreprises rattachees</span>
        </header>
        <div className="summary-card__kpi-metric" aria-label={`${totalCompanies} entreprises au total`}>
          <span className="summary-card__kpi-number">{totalCompanies}</span>
          <span className="summary-card__kpi-unit">total</span>
        </div>
        <p className="summary-card__kpi-sub" title="Entreprises rattachees au projet actuellement ouvert">
          {selectedProject != null ? (
            <>
              <strong className="summary-card__kpi-sub-num">{selectedProjectCompanyCount}</strong>
              {" sur le projet actif"}
            </>
          ) : (
            <span className="summary-card__kpi-sub-muted">
              Selectionnez un projet pour rattacher des entreprises
            </span>
          )}
        </p>
        <footer className="summary-card__kpi-foot">
          <button
            type="button"
            className="btn btn--secondary btn--sm summary-card__kpi-action"
            onClick={onOpenCompanyModal}
            disabled={!selectedProject}
            title={
              selectedProject
                ? "Ouvrir la fenetre d'ajout d'entreprise"
                : "Creez ou ouvrez un projet avant d'ajouter une entreprise"
            }
          >
            Ajouter une entreprise
          </button>
        </footer>
      </article>
      <article className="summary-card summary-card--admin-kpi summary-card--kpi-docs">
        <header className="summary-card__kpi-head">
          <span className="summary-card__label">Pieces attendues</span>
        </header>
        <div
          className="summary-card__kpi-metric"
          aria-label={`${totalExpectedPieces} pieces attendues sur l'ensemble des projets`}
        >
          <span className="summary-card__kpi-number">{totalExpectedPieces}</span>
          <span className="summary-card__kpi-unit">pieces</span>
        </div>
        <p className="summary-card__kpi-hint">
          Somme des pieces attendues pour toutes les entreprises (tous projets).
        </p>
      </article>
      <article className="summary-card summary-card--admin-kpi summary-card--kpi-storage">
        <header className="summary-card__kpi-head">
          <span className="summary-card__label">Espace disque</span>
        </header>
        <div
          className="summary-card__kpi-metric summary-card__kpi-metric--storage"
          aria-label="Espace disque utilise sur le volume de depot"
        >
          <strong className="summary-card__value summary-card__value--small">
            {storageStats.status === "ready" &&
            (storageStats.quotaBytes > 0 || storageStats.totalBytes > 0) ? (
              <>
                {formatBytes(storageStats.usedBytes)}{" "}
                /{" "}
                {formatBytes(
                  storageStats.quotaBytes > 0 ? storageStats.quotaBytes : storageStats.totalBytes
                )}
              </>
            ) : storageStats.status === "error" ? (
              "Erreur"
            ) : (
              "..."
            )}
          </strong>
        </div>
        <p className="summary-card__kpi-hint">
          {storageStats.status === "ready" ? (
            <>
              Fichiers: {formatBytes(storageStats.usedBytes)}{" "}
              {storageStats.filesOnPortalHost
                ? "(somme base, heberges sur portal)"
                : storageStats.quotaBytes > 0
                  ? "(volume local)"
                  : "(somme base)"}
            </>
          ) : storageStats.status === "error" ? (
            storageStats.error
          ) : (
            "Calcul..."
          )}
        </p>
      </article>
    </section>
  );
}
