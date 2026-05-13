import { startTransition, useEffect, useMemo, useRef, useState } from "react";

import DocumentCard from "../components/DocumentCard";
import FilePreviewModal from "../components/FilePreviewModal";
import StatusBanner from "../components/StatusBanner";
import { portalEnv } from "../config/env";
import {
  fileMatchesAcceptedFormats,
  formatAcceptedFormats,
  formatBytes,
  formatDateTime,
  isPreviewableFileName,
} from "../lib/files";
import { resolveLinkContext } from "../lib/linkContext";
import { createPowerAutomateClient } from "../lib/powerAutomateClient";
import {
  buildDocumentState,
  normalizeSharePointRecords,
} from "../lib/sharePointDocuments";

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function getMailtoHref(value) {
  const email = String(value || "").trim();
  return isValidEmail(email) ? `mailto:${email}` : "";
}

function getSecureWebsiteUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function buildCompanyFacts(context, trustedContext) {
  if (!trustedContext) {
    return [
      {
        label: "Mode d'acces",
        value: "Invitation signee requise",
      },
      context.supportEmail
        ? {
            label: "Support",
            value: context.supportEmail,
          }
        : null,
    ].filter(Boolean);
  }

  return [
    context.companyId
      ? {
          label: "Reference entreprise",
          value: context.companyId,
        }
      : null,
    context.contactName
      ? {
          label: "Contact",
          value: context.contactName,
        }
      : null,
    context.companyEmail
      ? {
          label: "Email",
          value: context.companyEmail,
        }
      : null,
    context.contestName
      ? {
          label: "Consultation",
          value: context.contestName,
        }
      : null,
  ].filter(Boolean);
}

function AccessGateScreen({ status, title, message }) {
  // Defense-in-depth: when the link is missing/invalid/expired we render a
  // minimal, brand-less screen. No company info, no support email, no portal
  // shell. The prod server already returns a 403 before this code runs; this
  // is the last fallback if a stale HTML is served from cache or a future
  // regression reintroduces a bypass.
  const isChecking = status === "checking";
  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f6f7fb",
        color: "#182033",
        fontFamily: "Arial, sans-serif",
        padding: "2rem",
      }}
    >
      <main
        style={{
          maxWidth: 540,
          width: "100%",
          padding: "2rem",
          background: "#fff",
          borderRadius: 14,
          boxShadow: "0 14px 30px rgba(16, 24, 40, 0.1)",
          textAlign: "left",
        }}
      >
        <h1 style={{ margin: "0 0 0.75rem", fontSize: "1.4rem" }}>
          {isChecking ? "Verification en cours" : title}
        </h1>
        <p style={{ margin: 0, lineHeight: 1.5 }}>
          {isChecking
            ? "Controle du lien securise en cours."
            : message}
        </p>
      </main>
    </div>
  );
}

function accessFailureFromServer(error) {
  const message = String(error?.message || "");
  const lower = message.toLowerCase();

  if (lower.includes("missing_secret")) {
    return {
      label: "Signature indisponible",
      title: "Configuration serveur incomplete",
      message:
        "La signature serveur n'est pas configuree. Contactez l'administrateur du portail.",
    };
  }

  if (lower.includes("expired")) {
    return {
      label: "Lien expire",
      title: "Invitation expiree",
      message:
        "La validite de ce lien est depassee. Un nouveau lien signe est necessaire pour continuer.",
    };
  }

  if (lower.includes("deadline_passed")) {
    return {
      label: "Echeance depassee",
      title: "Date limite atteinte",
      message:
        "La date limite de depot est passee. Le portail n'est plus accessible pour cette invitation.",
    };
  }

  if (lower.includes("invalid_sig") || lower.includes("invalid signed")) {
    return {
      label: "Signature invalide",
      title: "Lien non valide",
      message:
        "Le serveur n'a pas confirme la signature de ce lien. Utilisez le lien complet transmis par l'administrateur.",
    };
  }

  return {
    label: "Verification refusee",
    title: "Acces non confirme",
    message:
      "Le serveur n'a pas confirme ce lien de depot. Utilisez le lien complet transmis par l'administrateur ou contactez le support.",
  };
}

async function assessAccess(context, client) {
  const rawCtx = context.link?.rawCtx;
  const sig = context.link?.sig;
  const alg = String(context.link?.alg || "HS256").trim().toUpperCase();
  const exp = context.link?.decoded?.exp;
  const expDate = exp ? new Date(exp) : null;
  const expired =
    expDate instanceof Date &&
    !Number.isNaN(expDate.getTime()) &&
    Date.now() > expDate.getTime();
  // Second time gate (matches `isInvitationDeadlinePast` on the server):
  // deadline lives inside the signed payload, so an attacker cannot tamper
  // with it. When `now > deadline`, the portal is closed even if `exp` is
  // still in the future.
  const deadlineRaw = context.link?.decoded?.deadline || context.deadline;
  const deadlineDate = deadlineRaw ? new Date(deadlineRaw) : null;
  const deadlinePassed =
    deadlineDate instanceof Date &&
    !Number.isNaN(deadlineDate.getTime()) &&
    Date.now() > deadlineDate.getTime();
  const missingFields = [];

  if (!context.companyId) missingFields.push("identifiant entreprise");
  if (!context.submissionId) missingFields.push("identifiant de soumission");
  if (!context.folderPath) missingFields.push("dossier de depot");

  if (!rawCtx || !sig) {
    return {
      status: "blocked",
      tone: "error",
      label: "Lien securise requis",
      title: "Acces restreint",
      message:
        "Ce portail de production n'accepte que des invitations signees. Utilisez le lien complet transmis par l'administrateur.",
      trustedContext: false,
    };
  }

  if (alg !== "HS256") {
    return {
      status: "blocked",
      tone: "error",
      label: "Algorithme refuse",
      title: "Lien non conforme",
      message:
        "Le format de signature du lien n'est pas supporte. Demandez une nouvelle invitation.",
      trustedContext: false,
    };
  }

  let trustedContext = true;

  if (expired) {
    return {
      status: "blocked",
      tone: "error",
      label: "Lien expire",
      title: "Invitation expiree",
      message:
        "La validite de ce lien est depassee. Un nouveau lien signe est necessaire pour continuer.",
      trustedContext,
    };
  }

  if (deadlinePassed) {
    return {
      status: "blocked",
      tone: "error",
      label: "Echeance depassee",
      title: "Date limite atteinte",
      message:
        "La date limite de depot est passee. Le portail n'est plus accessible pour cette invitation.",
      trustedContext,
    };
  }

  if (missingFields.length) {
    return {
      status: "blocked",
      tone: "error",
      label: "Invitation incomplete",
      title: "Informations manquantes",
      message:
        "Le lien ne contient pas toutes les informations necessaires pour le depot. Contactez le support pour obtenir une invitation complete.",
      trustedContext,
    };
  }

  let serverVerification = null;
  try {
    serverVerification = await client.verifyInvitation(context);
  } catch (error) {
    const failure = accessFailureFromServer(error);
    return {
      status: "blocked",
      tone: "error",
      trustedContext: false,
      ...failure,
    };
  }

  return {
    status: "trusted",
    tone: "success",
    label: "Lien signe actif",
    title: "Acces securise",
    message:
      "Le lien signe a ete controle cote serveur. Les depots sont stockes sur le VPS puis synchronises en arriere-plan.",
    trustedContext: true,
    limits: serverVerification?.limits || {},
  };
}

export default function App() {
  const [context] = useState(() => resolveLinkContext());
  const [client] = useState(() => createPowerAutomateClient());
  const [records, setRecords] = useState([]);
  const [pageState, setPageState] = useState("ready");
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState(null);
  const [actionState, setActionState] = useState({
    documentId: "",
    action: "",
  });
  const [preview, setPreview] = useState(null);
  const previewRequestIdRef = useRef(0);
  const [accessState, setAccessState] = useState(() => ({
    status: "checking",
    tone: "warning",
    label: "Verification...",
    title: "Verification d'acces",
    message: "Controle du lien securise en cours.",
    trustedContext: false,
  }));
  const [uploadLimits, setUploadLimits] = useState(() => ({
    maxFileMb: portalEnv.maxFileMb,
  }));

  async function refreshRecords(options = {}) {
    const quiet = Boolean(options.quiet);

    if (!quiet) setPageState("loading");
    setPageError("");

    try {
      const rows = await client.listDocuments(context);
      const normalizedRecords = normalizeSharePointRecords(rows, context);

      startTransition(() => {
        setRecords(normalizedRecords);
        setPageState("ready");
      });
    } catch (error) {
      setPageState("error");
      setPageError(error.message || "Lecture du stockage local impossible.");
    }
  }

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      const resolvedAccess = await assessAccess(context, client);
      if (!active) return;

      setAccessState(resolvedAccess);
      if (resolvedAccess.limits?.maxFileMb) {
        setUploadLimits((current) => ({
          ...current,
          maxFileMb: resolvedAccess.limits.maxFileMb,
        }));
      }

      if (resolvedAccess.status === "blocked") {
        setPageState("ready");
        return;
      }

      await refreshRecords();
    }

    bootstrap();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Poll for sync status while at least one record is non-terminal. The
  // worker uploads to SharePoint asynchronously after the 202 ACK, so without
  // this the badge stays "Recu localement" until the visitor reloads.
  //
  // Polling rules:
  // - paused while the tab is hidden (no point spending requests on an
  //   unattended tab; we catch up on visibilitychange),
  // - exponential backoff (5s -> 10s -> 20s -> 40s, capped at 60s) so a job
  //   that retries every 15 minutes does not generate hundreds of polls,
  // - hard stop after ~10 minutes of continuous polling so a wedged job
  //   cannot DoS the server's general /api/portal limiter. After that, the
  //   user can refresh manually or reload the page.
  const hasInFlightSync = useMemo(
    () =>
      records.some((record) =>
        ["sync_pending", "syncing"].includes(record.syncStatus)
      ),
    [records]
  );
  useEffect(() => {
    if (!hasInFlightSync) return undefined;
    if (accessState.status !== "trusted") return undefined;
    if (typeof window === "undefined") return undefined;

    let cancelled = false;
    let timer = null;
    let delay = 5000;
    const maxDelay = 60000;
    const startedAt = Date.now();
    const maxRunMs = 10 * 60 * 1000;

    const isHidden = () =>
      typeof document !== "undefined" && document.visibilityState === "hidden";

    function tick() {
      if (cancelled) return;
      if (Date.now() - startedAt > maxRunMs) {
        cancelled = true;
        return;
      }
      if (isHidden()) {
        schedule(delay);
        return;
      }
      refreshRecords({ quiet: true });
      delay = Math.min(maxDelay, delay * 2);
      schedule(delay);
    }

    function schedule(ms) {
      if (cancelled) return;
      timer = window.setTimeout(tick, ms);
    }

    function onVisibility() {
      if (cancelled) return;
      if (!isHidden()) {
        if (timer) window.clearTimeout(timer);
        delay = 5000;
        tick();
      }
    }

    document.addEventListener("visibilitychange", onVisibility);
    schedule(delay);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasInFlightSync, accessState.status]);

  useEffect(() => {
    return () => {
      if (preview?.blobUrl) URL.revokeObjectURL(preview.blobUrl);
    };
  }, [preview?.blobUrl]);

  const documentState = buildDocumentState(context.documents, records);
  const completedCount = documentState.filter((item) => item.latest).length;
  const totalCount = context.documents.length;
  const remainingCount = Math.max(totalCount - completedCount, 0);
  const trustedContext = accessState.trustedContext;

  const progressLabel = useMemo(
    () => `${completedCount} / ${totalCount}`,
    [completedCount, totalCount]
  );

  const pendingItems = useMemo(
    () => documentState.filter((item) => !item.latest),
    [documentState]
  );
  const doneItems = useMemo(
    () => documentState.filter((item) => item.latest),
    [documentState]
  );
  const [activeTab, setActiveTab] = useState("pending");
  const [activeCategory, setActiveCategory] = useState("Toutes");

  const categories = useMemo(() => {
    const currentItems = activeTab === "pending" ? pendingItems : doneItems;
    const catSet = new Set(
      currentItems.map((item) => item.document.category || "Pieces")
    );
    return ["Toutes", ...Array.from(catSet).sort((a, b) => a.localeCompare(b))];
  }, [activeTab, pendingItems, doneItems]);

  const visibleItems = useMemo(() => {
    const currentItems = activeTab === "pending" ? pendingItems : doneItems;
    if (activeCategory === "Toutes") return currentItems;

    return currentItems.filter(
      (item) => (item.document.category || "Pieces") === activeCategory
    );
  }, [activeTab, activeCategory, pendingItems, doneItems]);

  useEffect(() => {
    if (activeCategory !== "Toutes" && !categories.includes(activeCategory)) {
      setActiveCategory("Toutes");
    }
  }, [activeCategory, categories]);

  const companyFacts = useMemo(
    () => buildCompanyFacts(context, trustedContext),
    [context, trustedContext]
  );
  const supportHref = useMemo(() => getMailtoHref(context.supportEmail), [context]);
  const companyEmailHref = useMemo(
    () => getMailtoHref(context.companyEmail),
    [context]
  );
  const websiteUrl = useMemo(() => getSecureWebsiteUrl(context.websiteUrl), [context]);
  const interactionsLocked =
    accessState.status === "checking" || accessState.status === "blocked";

  const displayCompanyName = trustedContext
    ? context.companyName
    : "Invitation securisee";
  const displaySummary = trustedContext
    ? context.portalSubtitle
    : "Les informations entreprise ne sont affichees qu'apres verification d'un lien signe valide.";
  const remainingLabel =
    remainingCount === 0
      ? "Dossier complet"
      : `${remainingCount} piece${remainingCount > 1 ? "s" : ""} restante${
          remainingCount > 1 ? "s" : ""
        }`;
  const deadlineLabel =
    trustedContext && context.deadline
      ? formatDateTime(context.deadline)
      : "Non definie";

  // Render NOTHING of the portal shell when access is not (yet) trusted.
  // The production server already gates HTML serving via requireSignedDepotLink
  // and the Vite dev plugin replicates that behaviour, so reaching this branch
  // means either:
  //   1. an out-of-band HTML was served (stale cache, regression);
  //   2. signature verification is still in flight on first paint.
  // In both cases we refuse to show the brand, company info, support contacts
  // or any portal structure to the visitor.
  if (accessState.status !== "trusted") {
    return (
      <AccessGateScreen
        status={accessState.status}
        title={accessState.title}
        message={accessState.message}
      />
    );
  }

  async function handleFileSelected(document, file) {
    if (!file) return;

    if (interactionsLocked) {
      setNotice({
        tone: "warning",
        title: "Acces verrouille",
        message:
          "Le depot est desactive tant que le lien n'est pas verifie ou complet.",
      });
      return;
    }

    if (!fileMatchesAcceptedFormats(file.name, document.acceptedFormats)) {
      setNotice({
        tone: "warning",
        title: "Format non autorise",
        message: `${document.label} attend: ${formatAcceptedFormats(
          document.acceptedFormats
        )}. Fichier selectionne: ${file.name || "sans nom"}.`,
      });
      return;
    }

    const maxFileMb = uploadLimits.maxFileMb || portalEnv.maxFileMb;
    const maxFileBytes = maxFileMb * 1024 * 1024;
    if (file.size > maxFileBytes) {
      setNotice({
        tone: "warning",
        title: "Fichier trop volumineux",
        message: `Le fichier pese ${formatBytes(file.size)}. Limite configuree: ${maxFileMb} Mo.`,
      });
      return;
    }

    const currentState = documentState.find(
      (item) => item.document.id === document.id
    );
    const record = currentState?.latest || null;
    const replacing = Boolean(record);

    if (!context.folderPath) {
      setNotice({
        tone: "warning",
        title: "Dossier cible manquant",
        message: "Impossible de deposer sans folderPath.",
      });
      return;
    }

    if (replacing && (!record.fileIdentifier || !record.filePath)) {
      setNotice({
        tone: "warning",
        title: "Remplacement impossible",
        message: "Metadonnees insuffisantes pour remplacer ce fichier.",
      });
      return;
    }

    setActionState({
      documentId: document.id,
      action: replacing ? "update" : "upload",
    });

    try {
      if (replacing) {
        await client.updateDocument({ context, document, file, record });
      } else {
        await client.uploadDocument({ context, document, file });
      }

      setNotice({
        tone: "success",
        title: replacing ? "Piece remplacee" : "Piece recue",
        message: `${document.label} recu localement. Synchronisation en arriere-plan.`,
      });

      await refreshRecords({ quiet: true });
    } catch (error) {
      setNotice({
        tone: "error",
        title: "Echec",
        message: error.message || "Le depot a echoue.",
      });
    } finally {
      setActionState({ documentId: "", action: "" });
    }
  }

  async function handleDelete(document) {
    if (interactionsLocked) return;

    const currentState = documentState.find(
      (item) => item.document.id === document.id
    );
    const record = currentState?.latest || null;
    if (!record || !record.fileIdentifier) return;

    const confirmed = window.confirm(`Supprimer ${document.label} ?`);
    if (!confirmed) return;

    setActionState({ documentId: document.id, action: "delete" });

    try {
      await client.deleteDocument({ context, document, record });
      setNotice({
        tone: "success",
        title: "Supprime",
        message: `${document.label} retire.`,
      });
      await refreshRecords({ quiet: true });
    } catch (error) {
      setNotice({
        tone: "error",
        title: "Echec suppression",
        message: error.message || "Suppression impossible.",
      });
    } finally {
      setActionState({ documentId: "", action: "" });
    }
  }

  async function handlePreview(document, record) {
    if (interactionsLocked || !record || !record.filePath) return;

    const requestId = ++previewRequestIdRef.current;

    setPreview((prev) => {
      if (prev?.blobUrl) URL.revokeObjectURL(prev.blobUrl);
      return {
        fileName: record.fileName,
        blobUrl: null,
        loading: true,
        error: null,
      };
    });

    try {
      const result = await client.downloadDocument({ context, record });

      if (requestId !== previewRequestIdRef.current) {
        if (result?.blobUrl) URL.revokeObjectURL(result.blobUrl);
        return;
      }

      setPreview({
        fileName: result.fileName || record.fileName,
        blobUrl: result.blobUrl,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (requestId !== previewRequestIdRef.current) return;
      setPreview((prev) => ({
        ...prev,
        loading: false,
        error: error.message || "Impossible de charger le fichier.",
      }));
    }
  }

  return (
    <div className="portal portal--admin-ui admin-shell">
      <header className="portal-header admin-header">
        <div className="portal-header__left admin-header__main">
          <span className="portal-brand">{context.brandName}</span>
          <h1 className="portal-title">{context.portalTitle}</h1>
          <p className="portal-header__copy admin-header__copy">
            Portail de depot documentaire a destination des entreprises invitees.
          </p>
        </div>

        <div className="portal-header__right admin-header__status">
          <div className="summary-card">
            <span className="summary-card__label">Acces</span>
            <strong className="summary-card__value summary-card__value--small">
              {accessState.label}
            </strong>
          </div>

          <div className="summary-card">
            <span className="summary-card__label">Progression</span>
            <strong className="summary-card__value summary-card__value--small">
              {progressLabel}
            </strong>
          </div>
        </div>
      </header>

      <section
        className="admin-summary-grid portal-summary-grid"
        aria-label="Etat du depot"
      >
        <article className="summary-card summary-card--admin-kpi summary-card--portal-total">
          <header className="summary-card__kpi-head">
            <span className="summary-card__label">Pieces attendues</span>
          </header>
          <div
            className="summary-card__kpi-metric"
            aria-label={`${totalCount} pieces attendues`}
          >
            <span className="summary-card__kpi-number">{totalCount}</span>
            <span className="summary-card__kpi-unit">pieces</span>
          </div>
          <p className="summary-card__kpi-hint">
            Liste definie depuis l'invitation signee.
          </p>
        </article>

        <article className="summary-card summary-card--admin-kpi summary-card--portal-complete">
          <header className="summary-card__kpi-head">
            <span className="summary-card__label">Pieces deposees</span>
          </header>
          <div
            className="summary-card__kpi-metric"
            aria-label={`${completedCount} pieces deposees`}
          >
            <span className="summary-card__kpi-number">{completedCount}</span>
            <span className="summary-card__kpi-unit">recues</span>
          </div>
          <p className="summary-card__kpi-hint">
            Documents disponibles dans le dossier de depot.
          </p>
        </article>

        <article className="summary-card summary-card--admin-kpi summary-card--portal-missing">
          <header className="summary-card__kpi-head">
            <span className="summary-card__label">Restantes</span>
          </header>
          <div
            className="summary-card__kpi-metric"
            aria-label={`${remainingCount} pieces restantes`}
          >
            <span className="summary-card__kpi-number">{remainingCount}</span>
            <span className="summary-card__kpi-unit">
              {remainingCount > 1 ? "pieces" : "piece"}
            </span>
          </div>
          <p className="summary-card__kpi-hint">{remainingLabel}</p>
        </article>

        <article className="summary-card summary-card--admin-kpi summary-card--portal-deadline">
          <header className="summary-card__kpi-head">
            <span className="summary-card__label">Date limite</span>
          </header>
          <div className="summary-card__kpi-active-body">
            <p className="summary-card__kpi-title">{deadlineLabel}</p>
            <div className="summary-card__kpi-meta-row">
              <span className="summary-card__kpi-progress">
                {accessState.title}
              </span>
              <span
                className={
                  remainingCount === 0
                    ? "summary-card__status-chip summary-card__status-chip--ok"
                    : "summary-card__status-chip summary-card__status-chip--pending"
                }
              >
                {remainingCount === 0 ? "Complet" : "En cours"}
              </span>
            </div>
          </div>
        </article>
      </section>

      <section className="company-panel admin-panel portal-company-panel">
        <div className="company-panel__main">
          <p className="section-kicker">Entreprise invitee</p>
          <h2 className="company-panel__name">{displayCompanyName}</h2>
          {trustedContext && context.submissionId ? (
            <p className="company-panel__subtitle">
              Reference invitation : <span>{context.submissionId}</span>
            </p>
          ) : null}
          <p className="company-panel__summary">{displaySummary}</p>

          <dl className="company-facts">
            {companyFacts.map((fact) => (
              <div key={fact.label} className="company-fact">
                <dt>{fact.label}</dt>
                <dd>
                  {fact.label === "Email" && companyEmailHref ? (
                    <a href={companyEmailHref}>{fact.value}</a>
                  ) : (
                    fact.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {accessState.status !== "checking" && accessState.tone === "error" ? (
        <StatusBanner tone={accessState.tone} title={accessState.title}>
          <p>{accessState.message}</p>
        </StatusBanner>
      ) : null}

      {notice ? (
        <StatusBanner tone={notice.tone} title={notice.title}>
          <p>{notice.message}</p>
        </StatusBanner>
      ) : null}

      {pageState === "error" ? (
        <StatusBanner tone="error" title="Erreur">
          <p>{pageError}</p>
        </StatusBanner>
      ) : null}

      <main className="portal-content admin-layout admin-layout--single">
        <div className="admin-content">
        <section className="portal-main admin-panel">
          <div className="admin-panel__header portal-main__header">
            <div>
              <p className="section-kicker">Documents</p>
              <h2 className="admin-panel__title">Pieces a transmettre</h2>
              <p className="admin-sidebar__hint">
                Filtrez les pieces par statut ou categorie, puis deposez les
                fichiers attendus.
              </p>
            </div>
            <div className="tabs" role="tablist" aria-label="Statut">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "pending"}
                className={activeTab === "pending" ? "tab tab--active" : "tab"}
                onClick={() => setActiveTab("pending")}
              >
                A deposer ({pendingItems.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "done"}
                className={activeTab === "done" ? "tab tab--active" : "tab"}
                onClick={() => setActiveTab("done")}
              >
                Deposees ({doneItems.length})
              </button>
            </div>
          </div>

          <div className="portal-toolbar">
            <div className="category-strip" aria-label="Filtrer par categorie">
              {categories.map((category) => {
                const currentItems =
                  activeTab === "pending" ? pendingItems : doneItems;
                const count =
                  category === "Toutes"
                    ? currentItems.length
                    : currentItems.filter(
                        (item) =>
                          (item.document.category || "Pieces") === category
                      ).length;

                return (
                  <button
                    key={category}
                    type="button"
                    className={
                      activeCategory === category
                        ? "cat-item cat-item--active"
                        : "cat-item"
                    }
                    onClick={() => setActiveCategory(category)}
                  >
                    <span className="cat-item__label">{category}</span>
                    <span className="cat-item__count">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="upload-grid">
            {accessState.status === "checking" ? (
              <div className="empty-state">Verification du lien securise...</div>
            ) : accessState.status === "blocked" ? (
              <div className="empty-state">
                Acces securise requis avant affichage des pieces.
              </div>
            ) : pageState === "loading" ? (
              <div className="empty-state">Chargement des pieces...</div>
            ) : visibleItems.length === 0 ? (
              <div className="empty-state">
                {activeTab === "pending"
                  ? "Toutes les pieces attendues ont ete deposees."
                  : "Aucune piece deposee pour le moment."}
              </div>
            ) : (
              visibleItems.map((item, index) => {
                const primaryDisabled =
                  interactionsLocked ||
                  (item.latest
                    ? !item.latest.fileIdentifier || !item.latest.filePath
                    : !context.folderPath);

                return (
                  <DocumentCard
                    key={item.document.id}
                    document={item.document}
                    record={item.latest}
                    busy={actionState.documentId === item.document.id}
                    primaryDisabled={primaryDisabled}
                    canDelete={
                      !interactionsLocked && Boolean(item.latest?.fileIdentifier)
                    }
                    canPreview={
                      !interactionsLocked &&
                      Boolean(
                        item.latest?.filePath &&
                          isPreviewableFileName(item.latest?.fileName)
                      )
                    }
                    onFileSelected={handleFileSelected}
                    onDelete={handleDelete}
                    onPreview={handlePreview}
                    index={index}
                  />
                );
              })
            )}
          </div>
        </section>
        </div>
      </main>

      <footer className="portal-footer">
        <div className="portal-footer__links">
          {supportHref ? <a href={supportHref}>{context.supportEmail}</a> : null}
          {websiteUrl ? (
            <a href={websiteUrl} target="_blank" rel="noopener noreferrer">
              Site institutionnel
            </a>
          ) : null}
        </div>
        <span className="portal-footer__copy">
          {context.brandName} | Portail entreprise securise
        </span>
      </footer>

      {preview ? (
        <FilePreviewModal
          fileName={preview.fileName}
          blobUrl={preview.blobUrl}
          loading={preview.loading}
          error={preview.error}
          onClose={() => {
            previewRequestIdRef.current += 1;
            if (preview.blobUrl) URL.revokeObjectURL(preview.blobUrl);
            setPreview(null);
          }}
        />
      ) : null}
    </div>
  );
}
