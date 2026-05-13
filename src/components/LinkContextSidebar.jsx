function displayValue(value, fallback = "-") {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text ? text : fallback;
}

function displayIso(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return displayValue(value);
  return date.toISOString().replace("T", " ").replace("Z", "");
}

function computeExpiryBadge(exp) {
  if (!exp) return { tone: "neutral", label: "Sans expiration" };
  const date = new Date(exp);
  if (Number.isNaN(date.getTime())) return { tone: "neutral", label: "Expiration inconnue" };
  return Date.now() > date.getTime()
    ? { tone: "danger", label: "Expire" }
    : { tone: "ok", label: "Valide" };
}

export default function LinkContextSidebar({ context }) {
  const decoded = context.link?.decoded || {};
  const expiry = computeExpiryBadge(decoded.exp);

  return (
    <aside className="portal-sidebar">
      <section className="side-panel">
        <div className="side-panel__head">
          <div>
            <p className="side-kicker">Lien</p>
            <h2 className="side-title">Contexte decode</h2>
          </div>
          <div className="pill-row">
            <span className={`pill pill--${expiry.tone}`}>{expiry.label}</span>
            {context.link?.signatureStatus ? (
              <span
                className={`pill ${
                  context.link.signatureStatus === "ok"
                    ? "pill--ok"
                    : context.link.signatureStatus === "invalid"
                    ? "pill--danger"
                    : "pill--neutral"
                }`}
              >
                Sig: {context.link.signatureStatus}
              </span>
            ) : null}
          </div>
        </div>

        <dl className="kv">
          <div>
            <dt>Entreprise</dt>
            <dd>{displayValue(decoded.companyName || context.companyName)}</dd>
          </div>
          <div>
            <dt>CompanyId</dt>
            <dd>{displayValue(decoded.companyId || context.companyId)}</dd>
          </div>
          <div>
            <dt>Soumission</dt>
            <dd>{displayValue(decoded.submissionId || context.submissionId)}</dd>
          </div>
          <div>
            <dt>Dossier</dt>
            <dd>{displayValue(decoded.dossierId || context.dossierId)}</dd>
          </div>
          <div>
            <dt>FolderPath</dt>
            <dd>{displayValue(decoded.folderPath || context.folderPath)}</dd>
          </div>
          <div>
            <dt>Nonce</dt>
            <dd>{displayValue(decoded.nonce)}</dd>
          </div>
          <div>
            <dt>IAT</dt>
            <dd>{displayIso(decoded.iat)}</dd>
          </div>
          <div>
            <dt>EXP</dt>
            <dd>{displayIso(decoded.exp)}</dd>
          </div>
        </dl>
      </section>

      <section className="side-panel">
        <div className="side-panel__head">
          <div>
            <p className="side-kicker">Backend</p>
            <h2 className="side-title">Serveur proxy</h2>
          </div>
        </div>

        <dl className="kv">
          <div>
            <dt>Acces depot</dt>
            <dd>{context.link?.rawCtx ? "Lien signe present" : "Lien signe absent"}</dd>
          </div>
          <div>
            <dt>Verification</dt>
            <dd>Controlee cote serveur</dd>
          </div>
          <div>
            <dt>Flows</dt>
            <dd>Masques au navigateur</dd>
          </div>
          <div>
            <dt>Signature</dt>
            <dd>{context.link?.sig ? "Transmise" : "Absente"}</dd>
          </div>
          <div>
            <dt>FolderPath</dt>
            <dd>{displayValue(context.folderPath || decoded.folderPath, "Manquant")}</dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}
