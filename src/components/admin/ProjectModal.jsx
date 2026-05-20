export default function ProjectModal({
  open,
  projectForm,
  projects,
  selectedProjectId,
  showArchived,
  onClose,
  onNewProject,
  onFieldChange,
  onSubmit,
  onSelectProject,
  onArchiveProject,
  onUnarchiveProject,
  onDeleteProject,
  onShowArchivedChange,
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
        aria-labelledby="project-modal-title"
      >
        <header className="modal-header">
          <div>
            <p className="section-kicker">Projet</p>
            <h2 className="modal-title" id="project-modal-title">
              Configuration du projet
            </h2>
            <p className="admin-sidebar__hint">Creez, mettez a jour et ouvrez vos projets.</p>
          </div>
          <div className="admin-inline-actions">
            <button type="button" className="btn btn--ghost" onClick={onNewProject}>
              Nouveau projet
            </button>
            <button type="button" className="modal-close" onClick={onClose} aria-label="Fermer">
              x
            </button>
          </div>
        </header>

        <div className="modal-body modal-body--padded">
          <form className="admin-form" onSubmit={onSubmit}>
            <div className="admin-form-grid">
              <label className="field">
                <span className="field__label">Nom du projet</span>
                <input
                  type="text"
                  value={projectForm.name}
                  onChange={(event) => onFieldChange("name", event.target.value)}
                  placeholder="Concours groupe scolaire"
                  required
                />
              </label>
              <label className="field">
                <span className="field__label">Dossier / code projet</span>
                <input
                  type="text"
                  value={projectForm.dossierId}
                  onChange={(event) => onFieldChange("dossierId", event.target.value)}
                  placeholder="concours-groupe-scolaire"
                  required
                />
              </label>
              <label className="field field--wide">
                <span className="field__label">Chemin dossier (metadata)</span>
                <input
                  type="text"
                  value={projectForm.folderPath}
                  onChange={(event) => onFieldChange("folderPath", event.target.value)}
                  placeholder="/sites/DEPOTS/projet-groupe-scolaire"
                  required
                />
              </label>
              <label className="field field--wide">
                <span className="field__label">Date limite</span>
                <input
                  type="datetime-local"
                  value={projectForm.deadline}
                  onChange={(event) => onFieldChange("deadline", event.target.value)}
                />
              </label>
              <label className="field field--wide">
                <span className="field__label">Pieces specifiques (une par ligne)</span>
                <textarea
                  rows={4}
                  value={projectForm.customDocumentsText}
                  onChange={(event) => onFieldChange("customDocumentsText", event.target.value)}
                  placeholder={"Ex: Attestation URSSAF\nEx: Note methodologie (optionnelle)"}
                />
              </label>
            </div>
            <div className="admin-form__actions">
              <button type="submit" className="btn btn--primary">
                {projectForm.id ? "Mettre a jour le projet" : "Creer le projet"}
              </button>
            </div>
          </form>

          <div className="admin-project-list">
            <label className="admin-filter-toggle">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) => onShowArchivedChange(event.target.checked)}
              />
              <span>Afficher les projets archives</span>
            </label>
            {!projects.length ? (
              <div className="empty-state admin-empty">Aucun projet configure.</div>
            ) : (
              projects.map((project) => {
                const isArchived = Boolean(project.archivedAt);
                return (
                  <article
                    key={project.id}
                    className={[
                      "admin-project-card",
                      project.id === selectedProjectId ? "admin-project-card--active" : "",
                      isArchived ? "admin-project-card--archived" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <div>
                      <strong>{project.name}</strong>
                      <p>
                        {project.dossierId}
                        {isArchived ? " - Archive" : ""}
                      </p>
                    </div>
                    <div className="admin-inline-actions">
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => onSelectProject(project.id)}
                        disabled={isArchived}
                        title={
                          isArchived
                            ? "Desarchivez le projet pour pouvoir l'ouvrir."
                            : undefined
                        }
                      >
                        Ouvrir
                      </button>
                      {isArchived ? (
                        <button
                          type="button"
                          className="btn btn--ghost"
                          onClick={() => onUnarchiveProject(project.id)}
                        >
                          Desarchiver
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--ghost"
                          onClick={() => onArchiveProject(project.id)}
                        >
                          Archiver
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn--danger-sm"
                        onClick={() => onDeleteProject(project.id)}
                      >
                        Supprimer
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
