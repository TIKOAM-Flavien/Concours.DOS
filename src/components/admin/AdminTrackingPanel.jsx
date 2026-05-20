import StatusBanner from "../StatusBanner.jsx";
import { TRACKING_STATUS_OPTIONS } from "../../lib/adminConstants.js";
import {
  documentSyncClassName,
  documentSyncLabel,
  invitationStatusClass,
  trackingStatusClassName,
} from "../../lib/adminPresentation.js";
import { formatDateTime } from "../../lib/files.js";
import { invitationStatusLabel } from "../../../shared/invitationStatus.js";

function TrackingInvitationBadges({ invitation }) {
  if (!invitation?.status) return null;
  const openCount = Number(invitation.openCount) || 0;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
      <span className={invitationStatusClass(invitation.status)}>
        {invitationStatusLabel(invitation.status)}
      </span>
      {Number.isFinite(Number(invitation.reminderCount)) && Number(invitation.sentCount) > 0 ? (
        <span className="status-pill status-pill--info">
          Relances: {Number(invitation.reminderCount)}
        </span>
      ) : null}
      <span
        className={
          openCount > 0
            ? "status-pill status-pill--success"
            : "status-pill status-pill--neutral"
        }
        title={
          invitation.lastOpenedAt
            ? `Derniere ouverture: ${formatDateTime(invitation.lastOpenedAt)}`
            : "Aucune ouverture tracee"
        }
      >
        {openCount > 0 ? `Ouvert ${openCount} fois` : "Jamais ouvert"}
      </span>
    </div>
  );
}

export default function AdminTrackingPanel({
  selectedProject,
  documentsEnabled,
  secureLinkEnabled,
  sendInvitationsEnabled,
  sendRemindersEnabled,
  emailSending,
  syncState,
  companyTracking,
  filteredCompanyTracking,
  filteredTrackingSummary,
  trackingDocumentOptions,
  trackingSearch,
  onTrackingSearchChange,
  trackingStatusFilter,
  onTrackingStatusFilterChange,
  trackingDocumentFilter,
  onTrackingDocumentFilterChange,
  trackingDocumentStateFilter,
  onTrackingDocumentStateFilterChange,
  trackingOnlyMissing,
  onTrackingOnlyMissingChange,
  trackingView,
  onTrackingViewChange,
  hasTrackingFilters,
  trackingManualBusy,
  trackingPollProgress,
  trackingPollDelayMs,
  invitationStatusByCompanyId,
  onSendInvitations,
  onSendReminders,
  onRefreshTracking,
  onResetFilters,
  onOpenDocumentReview,
}) {
  const hasCompanies = Boolean((selectedProject?.companies || []).length);

  return (
    <section className="admin-panel">
      <div className="admin-panel__header">
        <div>
          <p className="section-kicker">Reception</p>
          <h2 className="admin-panel__title">Suivi visuel des pieces recues</h2>
        </div>
        <div className="admin-inline-actions admin-inline-actions--tracking">
          <button
            type="button"
            className={`btn btn--secondary admin-tracking-action-btn admin-tracking-action-btn--invitations${
              emailSending === "invitations" ? " btn--busy" : ""
            }`}
            disabled={
              !selectedProject ||
              !hasCompanies ||
              emailSending !== null ||
              !secureLinkEnabled ||
              !sendInvitationsEnabled
            }
            onClick={onSendInvitations}
            aria-busy={emailSending === "invitations"}
            title={
              !sendInvitationsEnabled
                ? "Configurez POWER_AUTOMATE_SEND_INVITATIONS_URL cote serveur."
                : emailSending === "invitations"
                  ? "Envoi des invitations en cours."
                  : "Envoie un email avec le lien signe a chaque entreprise ciblee."
            }
          >
            <span className="admin-tracking-action-btn__label">Envoyer invitations par mail</span>
          </button>
          <button
            type="button"
            className={`btn btn--secondary admin-tracking-action-btn admin-tracking-action-btn--reminders${
              emailSending === "reminders" ? " btn--busy" : ""
            }`}
            disabled={
              !selectedProject ||
              !hasCompanies ||
              emailSending !== null ||
              !secureLinkEnabled ||
              !sendRemindersEnabled
            }
            onClick={onSendReminders}
            aria-busy={emailSending === "reminders"}
            title={
              !sendRemindersEnabled
                ? "Configurez POWER_AUTOMATE_SEND_REMINDERS_URL cote serveur."
                : emailSending === "reminders"
                  ? "Envoi des relances en cours."
                  : "Envoie une relance aux entreprises au dossier incomplet."
            }
          >
            <span className="admin-tracking-action-btn__label">Envoyer relances</span>
          </button>
          <button
            type="button"
            className={`btn btn--ghost admin-tracking-action-btn admin-tracking-action-btn--refresh${
              trackingManualBusy ? " btn--busy" : ""
            }`}
            disabled={!selectedProject || trackingManualBusy || !documentsEnabled}
            onClick={onRefreshTracking}
            aria-busy={trackingManualBusy}
            title={
              !documentsEnabled
                ? "Stockage local indisponible."
                : trackingManualBusy
                  ? "Actualisation en cours."
                  : "Recharge l'etat local du projet actif."
            }
          >
            <span className="admin-tracking-action-btn__label">Actualiser</span>
          </button>
        </div>
      </div>

      {selectedProject && documentsEnabled && trackingPollDelayMs > 0 ? (
        <div
          className="admin-tracking-poll"
          role="progressbar"
          aria-label="Prochaine actualisation automatique du suivi"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={trackingPollProgress}
          aria-valuetext={`Prochaine actualisation dans ${Math.max(
            0,
            Math.ceil(((100 - trackingPollProgress) / 100) * (trackingPollDelayMs / 1000))
          )} secondes`}
          title="Actualisation automatique toutes les 30 secondes"
        >
          <div
            className="admin-tracking-poll__bar"
            style={{ transform: `scaleX(${trackingPollProgress / 100})` }}
          />
          <span className="admin-tracking-poll__label">Actualisation auto · 30 s</span>
        </div>
      ) : null}

      {syncState.status === "error" ? (
        <StatusBanner tone="error" title="Erreur de chargement des depots">
          <p>{syncState.error}</p>
        </StatusBanner>
      ) : null}

      {!selectedProject ? (
        <div className="empty-state admin-empty">
          Selectionnez un projet pour visualiser le suivi multi-entreprises.
        </div>
      ) : !companyTracking.length ? (
        <div className="empty-state admin-empty">
          Aucune entreprise configuree pour etablir le suivi de reception.
        </div>
      ) : (
        <>
          <div className="admin-tracking-toolbar">
            <label className="field field--wide">
              <span className="field__label">Recherche</span>
              <input
                type="search"
                value={trackingSearch}
                onChange={(event) => onTrackingSearchChange(event.target.value)}
                placeholder="Entreprise, contact, email, piece manquante..."
              />
            </label>
            <label className="field">
              <span className="field__label">Statut</span>
              <select
                value={trackingStatusFilter}
                onChange={(event) => onTrackingStatusFilterChange(event.target.value)}
              >
                {TRACKING_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Piece</span>
              <select
                value={trackingDocumentFilter}
                onChange={(event) => onTrackingDocumentFilterChange(event.target.value)}
              >
                <option value="all">Toutes les pieces</option>
                {trackingDocumentOptions.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Etat piece</span>
              <select
                value={trackingDocumentStateFilter}
                onChange={(event) => onTrackingDocumentStateFilterChange(event.target.value)}
                disabled={trackingDocumentFilter === "all"}
              >
                <option value="all">Tous</option>
                <option value="received">Recue</option>
                <option value="missing">Manquante</option>
              </select>
            </label>
          </div>

          <div className="admin-tracking-actions">
            <label className="admin-filter-toggle">
              <input
                type="checkbox"
                checked={trackingOnlyMissing}
                onChange={(event) => onTrackingOnlyMissingChange(event.target.checked)}
              />
              <span>Uniquement les entreprises incompletes</span>
            </label>
            <div className="tabs admin-view-switch">
              <button
                type="button"
                className={trackingView === "cards" ? "tab tab--active" : "tab"}
                onClick={() => onTrackingViewChange("cards")}
              >
                Vue cartes
              </button>
              <button
                type="button"
                className={trackingView === "table" ? "tab tab--active" : "tab"}
                onClick={() => onTrackingViewChange("table")}
              >
                Vue tableau
              </button>
            </div>
            {hasTrackingFilters ? (
              <button type="button" className="btn btn--ghost" onClick={onResetFilters}>
                Reinitialiser filtres
              </button>
            ) : null}
          </div>

          <div className="admin-tracking-summary">
            <div className="summary-card summary-card--minor">
              <span className="summary-card__label">Entreprises visibles</span>
              <strong className="summary-card__value summary-card__value--small">
                {filteredTrackingSummary.total} / {companyTracking.length}
              </strong>
            </div>
            <div className="summary-card summary-card--minor">
              <span className="summary-card__label">Completes</span>
              <strong className="summary-card__value summary-card__value--small">
                {filteredTrackingSummary.complete}
              </strong>
            </div>
            <div className="summary-card summary-card--minor">
              <span className="summary-card__label">En cours</span>
              <strong className="summary-card__value summary-card__value--small">
                {filteredTrackingSummary.progress}
              </strong>
            </div>
            <div className="summary-card summary-card--minor">
              <span className="summary-card__label">A demarrer</span>
              <strong className="summary-card__value summary-card__value--small">
                {filteredTrackingSummary.todo}
              </strong>
            </div>
          </div>

          {!filteredCompanyTracking.length ? (
            <div className="empty-state admin-empty">Aucun resultat avec les filtres actifs.</div>
          ) : trackingView === "cards" ? (
            <div className="admin-tracking-grid">
              {filteredCompanyTracking.map((company) => (
                <article key={company.id} className="admin-track-card">
                  <div className="admin-track-card__header">
                    <div>
                      <strong>{company.companyName}</strong>
                      <p>{company.contactName || company.companyEmail}</p>
                      <TrackingInvitationBadges
                        invitation={invitationStatusByCompanyId[company.companyId]}
                      />
                    </div>
                    <span className={trackingStatusClassName(company.statusKey)}>
                      {company.status}
                    </span>
                  </div>
                  <div className="admin-track-card__progress-meta">
                    <strong>
                      {company.receivedCount} / {company.expectedCount} pieces
                    </strong>
                    <span>{company.completionRate}% recu</span>
                  </div>
                  <div className="admin-track-progress">
                    <span style={{ width: `${company.completionRate}%` }} />
                  </div>
                  <div className="admin-doc-pill-grid">
                    {company.documentState.map((item) => {
                      const record = item.latest;
                      const canOpen = Boolean(record?.filePath || record?.localRecordId);
                      const pillClass = documentSyncClassName(record);
                      const label = `${item.document.label}${documentSyncLabel(record)}`;

                      if (!canOpen) {
                        return (
                          <span
                            key={`${company.id}-${item.document.id}`}
                            className={pillClass}
                            title={record?.syncError || "Piece manquante"}
                          >
                            {label}
                          </span>
                        );
                      }

                      return (
                        <button
                          key={`${company.id}-${item.document.id}`}
                          type="button"
                          className={`${pillClass} admin-doc-pill--clickable`}
                          title="Ouvrir et valider la piece deposee"
                          onClick={() =>
                            onOpenDocumentReview?.({
                              item,
                              company,
                            })
                          }
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="admin-track-card__footer">
                    Dernier depot:{" "}
                    {company.lastReceptionAt
                      ? formatDateTime(company.lastReceptionAt)
                      : "Aucun depot"}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Entreprise</th>
                    <th>Statut</th>
                    <th>Avancement</th>
                    <th>Pieces manquantes</th>
                    <th>Dernier depot</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCompanyTracking.map((company) => (
                    <tr key={company.id}>
                      <td>
                        <strong>{company.companyName}</strong>
                        <span>{company.contactName}</span>
                      </td>
                      <td>
                        <span className={trackingStatusClassName(company.statusKey)}>
                          {company.status}
                        </span>
                      </td>
                      <td>
                        {company.receivedCount} / {company.expectedCount} ({company.completionRate}
                        %)
                      </td>
                      <td>{company.missingSummary}</td>
                      <td>
                        {company.lastReceptionAt
                          ? formatDateTime(company.lastReceptionAt)
                          : "Aucun depot"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
