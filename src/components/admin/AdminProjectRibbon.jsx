export default function AdminProjectRibbon({
  unfinishedProjects,
  selectedProjectId,
  ribbonSentinelRef,
  ribbonNavRef,
  ribbonTrackRef,
  ribbonStuck,
  ribbonDockedTop,
  onSwitchProject,
}) {
  if (!unfinishedProjects.length) return null;

  return (
    <>
      <div
        ref={ribbonSentinelRef}
        className="admin-project-ribbon__sentinel"
        aria-hidden="true"
      />
      <nav
        ref={ribbonNavRef}
        className={[
          "admin-project-ribbon",
          ribbonStuck && "admin-project-ribbon--stuck",
          ribbonDockedTop && "admin-project-ribbon--page-top",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label="Navigation entre les projets non termines"
      >
        <span className="admin-project-ribbon__label">
          Projets en cours
          <strong className="admin-project-ribbon__count">{unfinishedProjects.length}</strong>
        </span>
        <div className="admin-project-ribbon__track" ref={ribbonTrackRef}>
          {unfinishedProjects.map((project) => {
            const isActive = project.id === selectedProjectId;
            const companyCount = (project.companies || []).length;
            return (
              <button
                type="button"
                key={project.id}
                className={
                  isActive
                    ? "admin-project-ribbon__item admin-project-ribbon__item--active"
                    : "admin-project-ribbon__item"
                }
                onClick={() => onSwitchProject(project.id)}
                title={`${project.name}${project.dossierId ? ` - ${project.dossierId}` : ""}`}
              >
                <span className="admin-project-ribbon__name">
                  {project.name || project.dossierId || "Projet sans nom"}
                </span>
                <span className="admin-project-ribbon__meta">
                  {companyCount} entreprise{companyCount > 1 ? "s" : ""}
                  {project.dossierId ? ` - ${project.dossierId}` : ""}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
