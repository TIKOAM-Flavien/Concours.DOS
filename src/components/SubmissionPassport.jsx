function buildPassportRows(context) {
  return [
    { label: "Entreprise", value: context.companyName },
    { label: "Entreprise ID", value: context.companyId || "Non fourni" },
    { label: "Soumission", value: context.submissionId || "Non fournie" },
    { label: "Dossier", value: context.dossierId || "Non fourni" },
    { label: "Dossier cible", value: context.folderPath || "Non defini" },
  ];
}

export default function SubmissionPassport({
  context,
  completedCount,
  totalCount,
  historyCount,
  lastSync,
}) {
  const progress = totalCount
    ? Math.round((completedCount / totalCount) * 100)
    : 0;

  return (
    <aside className="passport">
      <p className="eyebrow eyebrow--dark">Passeport de depot</p>
      <h2 className="passport__title">Lien entreprise et metadonnees SharePoint</h2>
      <p className="passport__summary">
        Chaque document deverse est rattache automatiquement a l'entreprise,
        au type de piece et a la soumission. Les noms de fichiers restent
        purement informatifs.
      </p>

      <div className="passport__meter">
        <div className="passport__meter-head">
          <span>Pieces couvertes</span>
          <strong>{progress}%</strong>
        </div>
        <div className="passport__meter-track">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="passport__stats">
        <div>
          <span>Deposees</span>
          <strong>{completedCount}</strong>
        </div>
        <div>
          <span>A suivre</span>
          <strong>{Math.max(totalCount - completedCount, 0)}</strong>
        </div>
        <div>
          <span>Historique</span>
          <strong>{historyCount}</strong>
        </div>
      </div>

      <dl className="passport__rows">
        {buildPassportRows(context).map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="passport__tags">
        <span>{context.companyName}</span>
        {context.companyId ? <span>{context.companyId}</span> : null}
        {context.submissionId ? <span>{context.submissionId}</span> : null}
      </div>

      <div className="passport__support">
        <strong>Support depot</strong>
        <p>
          {context.supportEmail || context.supportPhone
            ? [context.supportEmail, context.supportPhone]
                .filter(Boolean)
                .join("  |  ")
            : "Utiliser le contact fourni dans l'invitation si besoin."}
        </p>
        <small>
          {lastSync
            ? `Derniere lecture SharePoint : ${lastSync}`
            : "Aucune synchronisation SharePoint pour l'instant."}
        </small>
      </div>
    </aside>
  );
}
