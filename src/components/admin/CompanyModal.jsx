import { CUSTOM_DOC_CATEGORY } from "../../lib/adminConstants.js";

function submitButtonLabel({ companyForm, companySaveStatus }) {
  const mode =
    companySaveStatus.phase === "idle"
      ? companyForm.id
        ? "update"
        : "create"
      : companySaveStatus.mode;
  if (companySaveStatus.phase === "saving") {
    return mode === "update" ? "Mise a jour..." : "Ajout en cours...";
  }
  if (companySaveStatus.phase === "saved") {
    return mode === "update" ? "Entreprise mise a jour" : "Entreprise ajoutée";
  }
  return mode === "update" ? "Mettre a jour l'entreprise" : "Ajouter l'entreprise";
}

export default function CompanyModal({
  open,
  selectedProject,
  companyForm,
  companySaveStatus,
  companyDirectory,
  directorySearch,
  directorySearchResults,
  companyDocumentOptions,
  companyDocumentGroups,
  companyDocumentSearch,
  customDocInput,
  customDocSaving,
  onClose,
  onReset,
  onSubmit,
  onFieldChange,
  onDirectorySearchChange,
  onSelectFromDirectory,
  onDocumentSearchChange,
  onDocumentToggle,
  onDocumentsBulk,
  onCustomDocInputChange,
  onAddCustomDocument,
}) {
  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal-panel modal-panel--company"
        role="dialog"
        aria-modal="true"
        aria-labelledby="company-modal-title"
      >
        <header className="modal-header">
          <div>
            <p className="section-kicker">Entreprise</p>
            <h2 className="modal-title" id="company-modal-title">
              {companyForm.id ? "Modifier l'entreprise" : "Ajouter une entreprise"}
            </h2>
            <p className="admin-sidebar__hint">
              {selectedProject
                ? `Projet actif : ${selectedProject.name}`
                : "Aucun projet actif. Creez un projet avant ajout."}
            </p>
          </div>
          <div className="admin-inline-actions">
            <button type="button" className="btn btn--ghost" onClick={onReset}>
              Nouvelle entreprise
            </button>
            <button type="button" className="modal-close" onClick={onClose} aria-label="Fermer">
              &times;
            </button>
          </div>
        </header>

        <div className="modal-body modal-body--padded">
          <form id="company-modal-form" className="admin-form admin-form--split" onSubmit={onSubmit}>
            <div className="admin-form__column">
              {companyDirectory.length > 0 ? (
                <div className="admin-directory">
                  <div className="admin-directory__header">
                    <span className="field__label">Reutiliser une entreprise existante</span>
                    <small className="admin-sidebar__hint">
                      {companyDirectory.length} entreprise(s) en base
                    </small>
                  </div>
                  <input
                    type="search"
                    className="admin-directory__search"
                    value={directorySearch}
                    onChange={(event) => onDirectorySearchChange(event.target.value)}
                    placeholder="Rechercher : nom, contact, email, identifiant..."
                    aria-label="Rechercher une entreprise existante"
                  />
                  {directorySearch.trim() ? (
                    directorySearchResults.length === 0 ? (
                      <p className="admin-directory__empty">Aucune entreprise correspondante.</p>
                    ) : (
                      <ul className="admin-directory__list">
                        {directorySearchResults.slice(0, 12).map((entry) => (
                          <li key={entry.key}>
                            <button
                              type="button"
                              className={
                                entry.alreadyAttached
                                  ? "admin-directory__item admin-directory__item--disabled"
                                  : "admin-directory__item"
                              }
                              onClick={() => onSelectFromDirectory(entry)}
                              disabled={entry.alreadyAttached}
                              title={
                                entry.alreadyAttached
                                  ? "Deja rattachee a ce projet"
                                  : `Pre-remplir le formulaire avec ${entry.companyName}`
                              }
                            >
                              <span className="admin-directory__primary">
                                {entry.companyName || entry.companyEmail || entry.companyId}
                              </span>
                              <span className="admin-directory__meta">
                                {[
                                  entry.contactName || entry.companyEmail || "",
                                  entry.companyId,
                                  entry.lastProjectName ? `vu sur ${entry.lastProjectName}` : "",
                                  entry.alreadyAttached ? "Deja rattachee" : "",
                                ]
                                  .filter(Boolean)
                                  .join(" - ")}
                              </span>
                            </button>
                          </li>
                        ))}
                        {directorySearchResults.length > 12 ? (
                          <li className="admin-directory__more">
                            + {directorySearchResults.length - 12} autres resultats. Affinez la
                            recherche.
                          </li>
                        ) : null}
                      </ul>
                    )
                  ) : (
                    <p className="admin-sidebar__hint admin-directory__intro">
                      Tapez quelques lettres pour retrouver une entreprise deja saisie sur un autre
                      projet, puis cliquez pour pre-remplir le formulaire.
                    </p>
                  )}
                </div>
              ) : null}

              <div className="admin-form-grid">
                <label className="field">
                  <span className="field__label">Entreprise</span>
                  <input
                    type="text"
                    value={companyForm.companyName}
                    onChange={(event) => onFieldChange("companyName", event.target.value)}
                    placeholder="Entreprise Martin"
                    required
                  />
                </label>
                <label className="field">
                  <span className="field__label">Identifiant entreprise</span>
                  <input
                    type="text"
                    value={companyForm.companyId}
                    onChange={(event) => onFieldChange("companyId", event.target.value)}
                    placeholder="ENT-MARTIN"
                  />
                </label>
                <label className="field">
                  <span className="field__label">Contact</span>
                  <input
                    type="text"
                    value={companyForm.contactName}
                    onChange={(event) => onFieldChange("contactName", event.target.value)}
                    placeholder="Marie Martin"
                    required
                  />
                </label>
                <label className="field">
                  <span className="field__label">Email</span>
                  <input
                    type="email"
                    value={companyForm.companyEmail}
                    onChange={(event) => onFieldChange("companyEmail", event.target.value)}
                    placeholder="contact@entreprise.fr"
                    required
                  />
                </label>
              </div>
            </div>

            <div className="admin-documents">
              <div className="admin-documents__head">
                <span className="field__label">Pieces attendues</span>
                <span className="admin-documents__count">
                  {companyForm.expectedDocuments.length}
                  {" / "}
                  {companyDocumentOptions.length}
                  {" selectionnees"}
                </span>
              </div>
              <div className="admin-documents__toolbar">
                <input
                  type="search"
                  className="admin-documents__search"
                  value={companyDocumentSearch}
                  onChange={(event) => onDocumentSearchChange(event.target.value)}
                  placeholder="Rechercher une piece..."
                />
                <div className="admin-documents__bulk">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() =>
                      onDocumentsBulk(
                        companyDocumentOptions.map((doc) => doc.id),
                        true
                      )
                    }
                  >
                    Tout cocher
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() =>
                      onDocumentsBulk(
                        companyDocumentOptions.map((doc) => doc.id),
                        false
                      )
                    }
                  >
                    Tout decocher
                  </button>
                </div>
              </div>
              <div className="admin-documents__list">
                {companyDocumentGroups.length === 0 ? (
                  <p className="admin-documents__empty">
                    {companyDocumentSearch.trim()
                      ? "Aucune piece ne correspond a la recherche."
                      : "Aucune piece disponible."}
                  </p>
                ) : (
                  companyDocumentGroups.map((group) => {
                    const groupIds = group.items.map((doc) => doc.id);
                    const selectedInGroup = groupIds.filter((id) =>
                      companyForm.expectedDocuments.includes(id)
                    ).length;
                    const allSelected =
                      groupIds.length > 0 && selectedInGroup === groupIds.length;
                    return (
                      <div key={group.category} className="admin-documents__group">
                        <div className="admin-documents__group-head">
                          <span className="admin-documents__group-title">{group.category}</span>
                          <div className="admin-documents__group-meta">
                            <span className="admin-documents__group-count">
                              {selectedInGroup}/{groupIds.length}
                            </span>
                            <button
                              type="button"
                              className="admin-documents__group-toggle"
                              onClick={() => onDocumentsBulk(groupIds, !allSelected)}
                            >
                              {allSelected ? "Tout decocher" : "Tout cocher"}
                            </button>
                          </div>
                        </div>
                        <div className="admin-documents__group-items">
                          {group.items.map((document) => (
                            <label key={document.id} className="admin-doc-row">
                              <input
                                type="checkbox"
                                checked={companyForm.expectedDocuments.includes(document.id)}
                                onChange={() => onDocumentToggle(document.id)}
                              />
                              <span className="admin-doc-row__label">{document.label}</span>
                            </label>
                          ))}
                          {group.category === CUSTOM_DOC_CATEGORY ? (
                            <div className="admin-documents__group-add">
                              <input
                                type="text"
                                className="admin-documents__group-add-input"
                                value={customDocInput}
                                onChange={(event) => onCustomDocInputChange(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    onAddCustomDocument();
                                  }
                                }}
                                placeholder="Nouvelle piece specifique (libelle)"
                                disabled={!selectedProject || customDocSaving}
                                aria-label="Libelle de la piece specifique a ajouter"
                              />
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={onAddCustomDocument}
                                disabled={
                                  !selectedProject || customDocSaving || !customDocInput.trim()
                                }
                              >
                                {customDocSaving ? "Ajout..." : "Ajouter"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </form>
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Annuler
          </button>
          <button
            type="submit"
            form="company-modal-form"
            className={
              companySaveStatus.phase === "saved" ? "btn btn--success" : "btn btn--primary"
            }
            disabled={companySaveStatus.phase === "saving"}
            aria-busy={companySaveStatus.phase === "saving"}
          >
            {companySaveStatus.phase === "saving" ? (
              <>
                <span className="spinner spinner--sm" aria-hidden="true" />
                {submitButtonLabel({ companyForm, companySaveStatus })}
              </>
            ) : (
              submitButtonLabel({ companyForm, companySaveStatus })
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
