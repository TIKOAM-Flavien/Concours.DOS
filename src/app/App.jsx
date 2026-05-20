import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

import AccessGateScreen from "../components/AccessGateScreen";
import AppVersion from "../components/AppVersion";
import DocumentCard from "../components/DocumentCard";
import FilePreviewModal from "../components/FilePreviewModal";
import StatusBanner from "../components/StatusBanner";
import { portalEnv } from "../config/env";
import {
  buildCompanyFacts,
  getMailtoHref,
  getSecureWebsiteUrl,
} from "../lib/companyContext";
import {
  fileMatchesAcceptedFormats,
  formatAcceptedFormats,
  formatBytes,
  formatDateTime,
  isPreviewableFileName,
} from "../lib/files";
import { applyVerifiedInvitation, resolveLinkContext } from "../lib/linkContext";
import { createPowerAutomateClient } from "../lib/powerAutomateClient";
import {
  buildDocumentState,
  normalizeDocumentRecords,
} from "../lib/documentRecords";
import { assessAccess } from "../lib/portalAccess";

export default function App() {
  const [context, setContext] = useState(() => resolveLinkContext());
  const [client] = useState(() => createPowerAutomateClient());
  const contextRef = useRef(context);
  const recordsRequestIdRef = useRef(0);
  const recordsAbortRef = useRef(null);
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

  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  const refreshRecords = useCallback(async (options = {}) => {
    const quiet = Boolean(options.quiet);
    const activeContext = options.context || contextRef.current;
    const requestId = recordsRequestIdRef.current + 1;
    recordsRequestIdRef.current = requestId;

    if (recordsAbortRef.current) {
      recordsAbortRef.current.abort();
    }
    const controller = new AbortController();
    recordsAbortRef.current = controller;

    if (!quiet) setPageState("loading");
    setPageError("");

    try {
      const rows = await client.listDocuments(activeContext, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || requestId !== recordsRequestIdRef.current) {
        return;
      }
      const normalizedRecords = normalizeDocumentRecords(rows, activeContext);

      startTransition(() => {
        setRecords(normalizedRecords);
        setPageState("ready");
      });
    } catch (error) {
      if (error?.name === "AbortError" || requestId !== recordsRequestIdRef.current) {
        return;
      }
      setPageState("error");
      setPageError(error.message || "Lecture du stockage local impossible.");
    } finally {
      if (recordsAbortRef.current === controller) {
        recordsAbortRef.current = null;
      }
    }
  }, [client]);

  useEffect(() => {
    return () => {
      if (recordsAbortRef.current) {
        recordsAbortRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      const initialContext = contextRef.current;
      const resolvedAccess = await assessAccess(initialContext, client);
      if (!active) return;

      const workingContext = resolvedAccess.invitation
        ? applyVerifiedInvitation(initialContext, resolvedAccess.invitation)
        : initialContext;
      if (resolvedAccess.invitation) {
        setContext(workingContext);
      }

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

      await refreshRecords({ context: workingContext });
    }

    bootstrap();

    return () => {
      active = false;
    };
  }, [client, refreshRecords]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Poll for sync status while at least one record is non-terminal. The worker
  // finalise le depot sur le disque local apres le 202 ACK.
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
  }, [hasInFlightSync, accessState.status, refreshRecords]);

  useEffect(() => {
    return () => {
      if (preview?.blobUrl) URL.revokeObjectURL(preview.blobUrl);
    };
  }, [preview?.blobUrl]);

  const documentState = useMemo(
    () => buildDocumentState(context.documents, records),
    [context.documents, records]
  );
  const hasActiveDeposit = useCallback((item) => {
    const record = item.latest;
    if (!record) return false;
    return (record.reviewStatus || "pending") !== "rejected";
  }, []);
  const completedCount = documentState.filter(
    (item) => item.latest?.reviewStatus === "accepted"
  ).length;
  const totalCount = context.documents.length;
  const remainingCount = Math.max(totalCount - completedCount, 0);
  const trustedContext = accessState.trustedContext;

  const progressLabel = useMemo(
    () => `${completedCount} / ${totalCount}`,
    [completedCount, totalCount]
  );

  const pendingItems = useMemo(
    () => documentState.filter((item) => !hasActiveDeposit(item)),
    [documentState, hasActiveDeposit]
  );
  const doneItems = useMemo(
    () => documentState.filter((item) => hasActiveDeposit(item)),
    [documentState, hasActiveDeposit]
  );
  const [activeTab, setActiveTab] = useState("pending");
  const [activeCategory, setActiveCategory] = useState("Toutes");

  const activeItems = useMemo(
    () => (activeTab === "pending" ? pendingItems : doneItems),
    [activeTab, pendingItems, doneItems]
  );

  const categoryOptions = useMemo(() => {
    const countsByCategory = new Map();
    for (const item of activeItems) {
      const category = item.document.category || "Pieces";
      countsByCategory.set(category, (countsByCategory.get(category) || 0) + 1);
    }

    return [
      { label: "Toutes", count: activeItems.length },
      ...Array.from(countsByCategory.entries())
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([label, count]) => ({ label, count })),
    ];
  }, [activeItems]);

  const visibleItems = useMemo(() => {
    if (activeCategory === "Toutes") return activeItems;

    return activeItems.filter(
      (item) => (item.document.category || "Pieces") === activeCategory
    );
  }, [activeCategory, activeItems]);

  useEffect(() => {
    if (
      activeCategory !== "Toutes" &&
      !categoryOptions.some((category) => category.label === activeCategory)
    ) {
      setActiveCategory("Toutes");
    }
  }, [activeCategory, categoryOptions]);

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
              {categoryOptions.map((category) => (
                <button
                  key={category.label}
                  type="button"
                  className={
                    activeCategory === category.label
                      ? "cat-item cat-item--active"
                      : "cat-item"
                  }
                  onClick={() => setActiveCategory(category.label)}
                >
                  <span className="cat-item__label">{category.label}</span>
                  <span className="cat-item__count">{category.count}</span>
                </button>
              ))}
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
                const rejected = item.latest?.reviewStatus === "rejected";
                const rejectionNotice = rejected
                  ? { comment: item.latest?.reviewComment || "" }
                  : null;
                const primaryDisabled =
                  interactionsLocked ||
                  (!rejected &&
                    item.latest &&
                    (!item.latest.fileIdentifier || !item.latest.filePath));

                return (
                  <DocumentCard
                    key={item.document.id}
                    document={item.document}
                    record={rejected ? null : item.latest}
                    rejectionNotice={rejectionNotice}
                    busy={actionState.documentId === item.document.id}
                    primaryDisabled={primaryDisabled}
                    canDelete={
                      !interactionsLocked &&
                      !rejected &&
                      Boolean(item.latest?.fileIdentifier)
                    }
                    canPreview={
                      !interactionsLocked &&
                      !rejected &&
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
          <AppVersion className="app-version--inline" />
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
