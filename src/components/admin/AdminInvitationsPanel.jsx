import { resolveDocumentList } from "../../config/documentCatalog.js";
import { invitationStatusClass } from "../../lib/adminPresentation.js";
import { formatDateTime } from "../../lib/files.js";
import { hydrateExpectedDocuments } from "../../lib/adminUtils.js";
import { invitationStatusLabel } from "../../../shared/invitationStatus.js";

function InvitationStatusCell({ invitation }) {
  if (!invitation?.status) {
    return <span className="status-pill status-pill--neutral">Aucune</span>;
  }
  const openCount = Number(invitation.openCount) || 0;
  return (
    <>
      <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
        >
          {openCount > 0
            ? `Ouvert ${openCount} fois`
            : "Jamais ouvert"}
        </span>
      </span>
      {invitation.lastOpenedAt ? (
        <span className="invitation-status-cell__submission">
          Derniere ouverture: {formatDateTime(invitation.lastOpenedAt)}
        </span>
      ) : null}
    </>
  );
}

export default function AdminInvitationsPanel({
  selectedProject,
  selectedProjectCustomDocs,
  selectedCompanyIds,
  invitationStatusByCompanyId,
  secureLinkEnabled,
  onToggleSelectAll,
  onToggleCompany,
  onEditCompany,
  onGenerateLink,
  onDeleteCompany,
  onRevokeCompanyLinks,
  onRevokeAllProjectLinks,
}) {
  const companies = selectedProject?.companies || [];
  const allSelected = companies.length > 0 && selectedCompanyIds.size === companies.length;
  const hasAnyActiveInvitation = companies.some((company) => {
    const status = invitationStatusByCompanyId[company.companyId]?.status;
    return status === "generated" || status === "sent";
  });

  return (
    <section className="admin-panel">
      <div className="admin-panel__header">
        <div>
          <p className="section-kicker">Invitations</p>
          <h2 className="admin-panel__title">Entreprises du projet actif</h2>
          {selectedProject && companies.length ? (
            <p className="admin-sidebar__hint">
              {selectedCompanyIds.size > 0
                ? `${selectedCompanyIds.size} entreprise(s) selectionnee(s). Les envois ne cibleront que la selection.`
                : "Aucune selection : les envois cibleront toutes les entreprises (relances = uniquement les dossiers incomplets)."}
            </p>
          ) : null}
        </div>
        <div className="admin-inline-actions">
          <span className="admin-panel__meta">
            {selectedProject ? selectedProject.name : "Aucun projet selectionne"}
          </span>
          {selectedProject && onRevokeAllProjectLinks ? (
            <button
              type="button"
              className={`btn ${hasAnyActiveInvitation ? "btn--danger-sm" : "btn--disabled"}`}
              onClick={() => onRevokeAllProjectLinks(selectedProject)}
              disabled={!hasAnyActiveInvitation}
              title={
                hasAnyActiveInvitation
                  ? "Revoquer tous les liens actifs de ce projet."
                  : "Aucun lien actif a revoquer."
              }
            >
              Revoquer tous les liens
            </button>
          ) : null}
        </div>
      </div>

      {!selectedProject ? (
        <div className="empty-state admin-empty">
          Creez ou ouvrez un projet pour rattacher des entreprises.
        </div>
      ) : !companies.length ? (
        <div className="empty-state admin-empty">Aucune entreprise rattachee a ce projet.</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: "2.5rem" }}>
                  <input
                    type="checkbox"
                    aria-label="Tout selectionner"
                    checked={allSelected}
                    onChange={onToggleSelectAll}
                  />
                </th>
                <th>Entreprise</th>
                <th>Contact</th>
                <th>Pieces attendues</th>
                <th>Invitation</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => {
                const invitationStatus =
                  invitationStatusByCompanyId[company.companyId]?.status;
                const hasActiveLink =
                  invitationStatus === "generated" || invitationStatus === "sent";
                return (
                <tr key={company.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Selectionner ${company.companyName}`}
                      checked={selectedCompanyIds.has(company.id)}
                      onChange={() => onToggleCompany(company.id)}
                    />
                  </td>
                  <td>
                    <strong>{company.companyName}</strong>
                    <span>{company.companyId}</span>
                  </td>
                  <td>
                    <strong>{company.contactName}</strong>
                    <span>{company.companyEmail}</span>
                  </td>
                  <td>
                    {resolveDocumentList(
                      hydrateExpectedDocuments(company.expectedDocuments, selectedProjectCustomDocs)
                    )
                      .map((document) => document.label)
                      .join(", ")}
                  </td>
                  <td>
                    <div className="invitation-status-cell">
                      <span className="invitation-status-cell__submission">
                        {company.submissionId}
                      </span>
                      <InvitationStatusCell
                        invitation={invitationStatusByCompanyId[company.companyId]}
                      />
                    </div>
                  </td>
                  <td>
                    <div className="admin-inline-actions">
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => onEditCompany(company)}
                      >
                        Editer
                      </button>
                      <button
                        type="button"
                        className={`btn ${secureLinkEnabled ? "btn--secondary" : "btn--disabled"}`}
                        onClick={() => onGenerateLink(company)}
                        disabled={!secureLinkEnabled}
                      >
                        Lien
                      </button>
                      {hasActiveLink && onRevokeCompanyLinks ? (
                        <button
                          type="button"
                          className="btn btn--danger-sm"
                          onClick={() => onRevokeCompanyLinks(company)}
                          title="Revoquer tous les liens actifs de cette entreprise."
                        >
                          Revoquer
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn--danger-sm"
                        onClick={() => onDeleteCompany(company.id)}
                      >
                        Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
